import React, { useMemo } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, PointerLockControls, Grid } from '@react-three/drei'
import { usePlanStore } from '../store/planStore'
import { wallLength, wallAngle, midpoint, pointAlongWall, wallSegments } from '../geometry/geo'
import { FURNITURE_BY_TYPE } from '../model/furnitureLibrary'
import { getTheme } from '../model/themes'
import { extractFootprints } from '../geometry/geo'
import {
  computeElevationsM, supportHeightAtM, resolveCollisionMm,
  startPoseMm, EYE_M,
} from '../geometry/walkGeo'
import { solarPosition, sunVector, SUN_DEFAULTS } from '../geometry/sunGeo'
import { buildHipRoofGeometry } from '../geometry/roofGeo'

// mm → metres. Plan is y-down screen space; world maps plan y → +z.
const M = 1 / 1000

// Distance at which a bounding sphere of `radius` fits inside the view.
// three's PerspectiveCamera fov is vertical, so on a tall (portrait) screen
// the horizontal fov is the tighter constraint — fit to whichever is smaller
// so the model is never cropped off the sides on a phone.
function fitDistance(radius, aspect, fovDeg) {
  const vFov = (fovDeg * Math.PI) / 180
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
  const fovMin = Math.min(vFov, hFov)
  return (radius / Math.sin(fovMin / 2)) * 1.15 // 15% breathing room
}

// Show touch walk-mode controls on devices without a mouse. Some report a
// coarse pointer, others only expose touch points — accept either.
const isCoarsePointer = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0)

// theme-driven materials; zone overlay colors reuse the plan zone ramp
const materialsFor = (T) => ({
  wall: T.three.wall,
  floor: T.three.floor,
  glass: T.three.glass,
  roof: T.three.roof,
  zone: T.plan.zoneColors,
})

// Frames the model in the orbit view. The end pose is computed from the
// model's bounding radius and the *current* viewport aspect, so the house
// fits whether the screen is a wide desktop or a tall phone. It still fly-ins
// from a top-down pose (echoing the 2D view) unless reduced-motion is set or
// we've already flown in this mount, in which case it snaps.
function FrameCamera({ target, radius, flownRef }) {
  const { camera, controls, size } = useThree()
  const startTime = React.useRef(null)
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const done = React.useRef(false)

  // fitted orbit pose for this aspect ratio
  const end = React.useMemo(() => {
    const aspect = size.width / Math.max(1, size.height)
    const d = fitDistance(radius, aspect, camera.fov)
    const u = new THREE.Vector3(1, 0.85, 1).normalize()
    return { x: target[0] + u.x * d, y: u.y * d, z: target[2] + u.z * d, d }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, radius, size.width, size.height, camera.fov])

  const land = () => {
    done.current = true
    flownRef.current = true
    if (controls) {
      controls.target.set(target[0], 0, target[2])
      controls.update()
      controls.enabled = true
    }
  }

  useFrame((state) => {
    if (done.current) return
    // snap (no animation) when reduced-motion, or when this mount already flew
    if (reduced || flownRef.current) {
      camera.position.set(end.x, end.y, end.z)
      camera.lookAt(target[0], 0, target[2])
      land()
      return
    }
    if (startTime.current == null) startTime.current = state.clock.elapsedTime
    const k = Math.min(1, (state.clock.elapsedTime - startTime.current) / 0.7)
    const e = 1 - Math.pow(1 - k, 3) // ease-out cubic
    const sx = target[0], sy = Math.max(16, end.y * 1.8), sz = target[2] + 0.02
    camera.position.set(sx + (end.x - sx) * e, sy + (end.y - sy) * e, sz + (end.z - sz) * e)
    camera.lookAt(target[0], 0, target[2])
    if (controls) controls.enabled = false
    if (k >= 1) land()
  })
  return null
}

// ---- one wall = N solid boxes from segment decomposition ----
function Wall({ wall, openings, wallColor, mat }) {
  const segs = useMemo(() => wallSegments(wall, openings), [wall, openings])
  const angle = -wallAngle(wall)

  return (
    <group>
      {segs.map((s, i) => {
        const segLen = (s.to - s.from) * M
        const segH = (s.y1 - s.y0) * M
        const mid = pointAlongWall(wall, (s.from + s.to) / 2)
        return (
          <mesh
            key={i}
            position={[mid.x * M, (s.y0 * M) + segH / 2, mid.y * M]}
            rotation={[0, angle, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[segLen, segH, wall.thickness * M]} />
            <meshStandardMaterial color={wallColor || mat.wall} />
          </mesh>
        )
      })}
      {/* translucent panes for windows */}
      {openings
        .filter((o) => o.wallId === wall.id && o.type === 'window')
        .map((o) => {
          const mid = pointAlongWall(wall, o.offset + o.width / 2)
          return (
            <mesh
              key={o.id}
              position={[mid.x * M, (o.sillHeight + o.height / 2) * M, mid.y * M]}
              rotation={[0, angle, 0]}
            >
              <boxGeometry args={[o.width * M, o.height * M, 0.03]} />
              <meshStandardMaterial
                color={mat.glass}
                transparent
                opacity={0.35}
                depthWrite={false}
              />
            </mesh>
          )
        })}
    </group>
  )
}

// ---- flat geometry from a plan polygon (y-down → world XZ) ----
function usePolygonGeometry(polygon) {
  return useMemo(() => {
    if (!polygon || polygon.length < 3) return null
    const shape = new THREE.Shape(
      polygon.map((p) => new THREE.Vector2(p.x * M, p.y * M)),
    )
    const geo = new THREE.ShapeGeometry(shape)
    geo.rotateX(Math.PI / 2) // shape (x, y) → world (x, z); plan y → +z
    return geo
  }, [polygon])
}

function RoomFloor({ room, color, mat }) {
  const geo = usePolygonGeometry(room.polygon)
  if (!geo) return null
  return (
    <mesh geometry={geo} position={[0, 0.005, 0]} receiveShadow>
      <meshStandardMaterial color={color || mat.floor} side={THREE.DoubleSide} />
    </mesh>
  )
}

// Manual open-plan zones render as tinted floor overlays, not walls.
function ZoneOverlay({ room, index, mat }) {
  const geo = usePolygonGeometry(room.polygon)
  if (!geo) return null
  return (
    <mesh geometry={geo} position={[0, 0.02, 0]}>
      <meshStandardMaterial
        color={mat.zone[index % mat.zone.length]}
        transparent
        opacity={0.28}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  )
}

// Pitched hip roof over a building footprint (see roofGeo.js).
function HipRoof({ footprint, pitchDeg, height, mat }) {
  const built = useMemo(
    () => buildHipRoofGeometry(footprint, { pitchDeg }),
    [footprint, pitchDeg],
  )
  if (!built) return null
  return (
    <mesh geometry={built.geometry} position={[0, height, 0]} castShadow>
      <meshStandardMaterial color={mat.roof} side={THREE.DoubleSide} flatShading />
    </mesh>
  )
}

// Flat roof: a 200mm slab over each auto room's polygon at wall height.
function RoofSlab({ room, height, mat }) {
  const geo = useMemo(() => {
    if (!room.polygon || room.polygon.length < 3) return null
    const shape = new THREE.Shape(
      room.polygon.map((p) => new THREE.Vector2(p.x * M, p.y * M)),
    )
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false })
    g.rotateX(Math.PI / 2) // extrusion now points downward (-y)
    return g
  }, [room.polygon])
  if (!geo) return null
  return (
    <mesh geometry={geo} position={[0, height + 0.2, 0]} castShadow>
      <meshStandardMaterial color={mat.roof} side={THREE.DoubleSide} />
    </mesh>
  )
}

// 3D staircase: solid stepped boxes rising `riseM` over the stair's
// length, climbing toward the 2D arrow (local -y / "UP") direction.
function Stair3D({ stair, riseM, mat }) {
  const rad = (stair.rotation * Math.PI) / 180
  const wM = stair.width * M
  const lM = stair.length * M
  const n = Math.max(3, Math.ceil((riseM * 1000) / 180))
  const stepD = lM / n
  const steps = []
  for (let k = 0; k < n; k++) {
    const topH = ((k + 1) / n) * riseM
    const yLocal = lM / 2 - (k + 0.5) * stepD
    steps.push(
      <mesh key={k} position={[0, topH / 2, yLocal]} castShadow receiveShadow>
        <boxGeometry args={[wM, topH, stepD]} />
        <meshStandardMaterial color={mat.roof} />
      </mesh>,
    )
  }
  return (
    <group
      position={[stair.position.x * M, 0, stair.position.y * M]}
      rotation={[0, -rad, 0]}
    >
      {steps}
    </group>
  )
}

// First-person walk mode: pointer-lock look, WASD/arrows move (Shift
// runs), pure-geometry ground-follow (slabs + stair steps) and wall
// collision with door pass-through — all from walkGeo, test-covered.
function WalkMode({ plan, elevations, input, mobile, onExit }) {
  const { camera } = useThree()
  const controlsRef = React.useRef(null)
  const keys = React.useRef({})
  const feet = React.useRef(0)
  const floorIdx = React.useRef(0)
  // yaw/pitch we drive ourselves on touch (PointerLockControls needs a mouse)
  const yaw = React.useRef(0)
  const pitch = React.useRef(0)

  React.useEffect(() => {
    const dn = (e) => { keys.current[e.code] = true }
    const up = (e) => { keys.current[e.code] = false }
    window.addEventListener('keydown', dn)
    window.addEventListener('keyup', up)
    const pose = startPoseMm(plan)
    feet.current = 0
    floorIdx.current = 0
    camera.position.set(pose.x * M, EYE_M, pose.y * M)
    camera.lookAt(pose.x * M + pose.dirX, EYE_M, pose.y * M + pose.dirY)
    // seed our manual yaw/pitch from the look-at orientation for touch mode
    const e0 = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ')
    yaw.current = e0.y
    pitch.current = e0.x
    const t = mobile ? null : setTimeout(() => controlsRef.current?.lock?.(), 60)
    return () => {
      if (t) clearTimeout(t)
      window.removeEventListener('keydown', dn)
      window.removeEventListener('keyup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((_, delta) => {
    const k = keys.current
    // touch look: right stick turns the camera; clamp pitch to avoid flipping
    if (mobile) {
      const look = input.current.look
      const lookSpeed = 2.4
      yaw.current -= look.x * lookSpeed * Math.min(delta, 0.05)
      pitch.current -= look.y * lookSpeed * Math.min(delta, 0.05)
      pitch.current = Math.max(-1.3, Math.min(1.3, pitch.current))
      camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ')
    }
    const run = k.ShiftLeft || k.ShiftRight
    const step = (run ? 4.2 : 2.2) * Math.min(delta, 0.05)
    const mv = input.current.move
    const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0)
      + (mobile ? -mv.y : 0)
    const strafe = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0)
      + (mobile ? mv.x : 0)
    if (fwd || strafe) {
      const dir = new THREE.Vector3()
      camera.getWorldDirection(dir)
      dir.y = 0
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1)
      dir.normalize()
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0))
      const move = dir.multiplyScalar(fwd).add(right.multiplyScalar(strafe))
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(step)
        const fl = plan.floors[floorIdx.current] || plan.floors[0]
        const q = resolveCollisionMm(
          fl.walls, fl.openings,
          { x: (camera.position.x + move.x) / M, y: (camera.position.z + move.z) / M },
          250,
        )
        camera.position.x = q.x * M
        camera.position.z = q.y * M
      }
    }
    const sup = supportHeightAtM(
      plan,
      { x: camera.position.x / M, y: camera.position.z / M },
      feet.current,
      elevations,
    )
    floorIdx.current = sup.floorIdx
    feet.current += (sup.feetM - feet.current) * Math.min(1, delta * 12)
    if (Math.abs(sup.feetM - feet.current) < 0.003) feet.current = sup.feetM
    camera.position.y = feet.current + EYE_M
  })

  // desktop = pointer-lock mouse look; touch = manual look (joysticks), so no
  // pointer-lock control at all there.
  if (mobile) return null
  return <PointerLockControls ref={controlsRef} onUnlock={onExit} />
}

// On-screen analog stick for touch walk mode. Reports a normalised vector
// (−1..1 on each axis, y-down) while dragged and {0,0} on release.
function Joystick({ side, label, onChange }) {
  const baseRef = React.useRef(null)
  const touchId = React.useRef(null)
  const [knob, setKnob] = React.useState({ x: 0, y: 0 })

  const apply = (clientX, clientY) => {
    const r = baseRef.current.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const max = r.width / 2
    let dx = clientX - cx, dy = clientY - cy
    const d = Math.hypot(dx, dy)
    if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max }
    setKnob({ x: dx, y: dy })
    onChange({ x: dx / max, y: dy / max })
  }
  const start = (e) => {
    const t = e.changedTouches[0]
    touchId.current = t.identifier
    apply(t.clientX, t.clientY)
  }
  const move = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchId.current) { apply(t.clientX, t.clientY); e.preventDefault() }
    }
  }
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchId.current) {
        touchId.current = null
        setKnob({ x: 0, y: 0 })
        onChange({ x: 0, y: 0 })
      }
    }
  }
  return (
    <div
      ref={baseRef}
      className={`joystick joystick-${side}`}
      onTouchStart={start}
      onTouchMove={move}
      onTouchEnd={end}
      onTouchCancel={end}
      aria-label={label}
    >
      <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  )
}

// Lighting rig: default studio light, or — with the sun simulation
// on — a directional sun positioned by real solar geometry (plan top
// = North). Low sun goes warm; below the horizon goes dim and cool.
// Window glazing doesn't cast shadows, so light falls through them.
function Lighting({ sun, target }) {
  const s = { ...SUN_DEFAULTS, ...(sun || {}) }
  if (!s.enabled) {
    return (
      <>
        <ambientLight intensity={0.55} />
        <directionalLight position={[12, 18, 6]} intensity={1.1}
          castShadow shadow-mapSize={[2048, 2048]} />
      </>
    )
  }
  const pos = solarPosition(s)
  if (pos.elevationDeg <= 0) {
    return (
      <>
        <ambientLight intensity={0.14} color="#7a8db0" />
        <directionalLight position={[10, 14, 8]} intensity={0.18} color="#9db3d8" />
      </>
    )
  }
  const v = sunVector(pos)
  const el = pos.elevationDeg
  const color = el < 12 ? '#ffb27a' : el < 25 ? '#ffd9ad' : '#fff7ec'
  const intensity = 0.45 + 1.05 * Math.sin((el * Math.PI) / 180)
  return (
    <>
      <ambientLight intensity={0.26} />
      <directionalLight
        position={[target[0] + v.x * 35, v.y * 35, target[2] + v.z * 35]}
        intensity={intensity}
        color={color}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-25}
        shadow-camera-right={25}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-camera-far={90}
      />
    </>
  )
}

const floorHeightMm = (floor) =>
  floor.walls.length ? Math.max(...floor.walls.map((w) => w.height), 2400) : 2400

export default function View3D() {
  const plan = usePlanStore((s) => s.plan)
  const T = getTheme(usePlanStore((s) => s.theme))
  const mat = useMemo(() => materialsFor(T), [T])
  const walkMode = usePlanStore((s) => s.walkMode)
  const setWalkMode = usePlanStore((s) => s.setWalkMode)
  const flownRef = React.useRef(false)
  const savedCam = React.useRef(null)
  const camProbe = React.useRef(null) // set by CamProbe inside the canvas

  React.useEffect(() => {
    if (!walkMode && savedCam.current && camProbe.current) {
      camProbe.current.position.copy(savedCam.current.p)
      camProbe.current.quaternion.copy(savedCam.current.q)
      savedCam.current = null
    }
  }, [walkMode])

  // stacked elevations: floor i sits on the walls of everything below
  const elevations = useMemo(() => computeElevationsM(plan), [plan.floors])

  const topFloor = plan.floors[plan.floors.length - 1]
  const topElev = elevations.starts[plan.floors.length - 1]
  const topHeightM = floorHeightMm(topFloor) * M

  // frame the camera on the ground floor's extent
  const ground = plan.floors[0]
  const target = useMemo(() => {
    if (ground.walls.length === 0) return [0, 0, 0]
    let cx = 0, cy = 0
    for (const w of ground.walls) {
      const m = midpoint(w.start, w.end)
      cx += m.x; cy += m.y
    }
    cx /= ground.walls.length; cy /= ground.walls.length
    return [cx * M, 0, cy * M]
  }, [ground.walls])

  // bounding radius (metres) of the whole footprint, used to fit the camera
  const radius = useMemo(() => {
    if (ground.walls.length === 0) return 6
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const w of ground.walls) {
      for (const pt of [w.start, w.end]) {
        minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x)
        minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y)
      }
    }
    const wM = (maxX - minX) * M, dM = (maxY - minY) * M
    // include wall height so a tall build isn't cropped top/bottom either
    return 0.5 * Math.hypot(wM, dM, topHeightM) + 0.5
  }, [ground.walls, topHeightM])

  const isTouch = useMemo(() => isCoarsePointer(), [])
  // shared control input for touch walk mode: left stick moves, right looks
  const walkInput = React.useRef({ move: { x: 0, y: 0 }, look: { x: 0, y: 0 } })

  return (
    <div className="view3d" style={{ background: T.three.bg }}>
      <Canvas
        shadows
        camera={{ position: [target[0] + 9, 8, target[2] + 9], fov: 50 }}
      >
        <Lighting sun={plan.sun} target={target} />
        <Grid
          args={[60, 60]}
          cellColor={T.three.gridCell}
          sectionColor={T.three.gridSection}
          fadeDistance={40}
        />
        {plan.floors.map((f, fi) => {
          const autoRooms = f.rooms.filter((r) => r.source === 'auto')
          const zones = f.rooms.filter((r) => r.source === 'manual')
          const riseM =
            fi < plan.floors.length - 1
              ? elevations.starts[fi + 1] - elevations.starts[fi]
              : floorHeightMm(f) * M
          return (
            <group key={f.id} position={[0, elevations.starts[fi], 0]}>
              {autoRooms.map((r) => (
                <RoomFloor key={r.id} room={r} color={plan.floorColor} mat={mat} />
              ))}
              {zones.map((r, i) => <ZoneOverlay key={r.id} room={r} index={i} mat={mat} />)}
              {f.walls.map((w) => (
                <Wall key={w.id} wall={w} openings={f.openings} wallColor={plan.wallColor} mat={mat} />
              ))}
              {f.stairs.map((st) => (
                <Stair3D key={st.id} stair={st} riseM={riseM} mat={mat} />
              ))}
              {f.furniture.map((furn) => {
                const rad = (furn.rotation * Math.PI) / 180
                return (
                  <mesh
                    key={furn.id}
                    position={[furn.position.x * M, (furn.dimensions.h * M) / 2, furn.position.y * M]}
                    rotation={[0, -rad, 0]}
                    castShadow
                  >
                    <boxGeometry args={[furn.dimensions.w * M, furn.dimensions.h * M, furn.dimensions.d * M]} />
                    <meshStandardMaterial color={T.plan.furnitureMono || FURNITURE_BY_TYPE[furn.type]?.color || '#8d99ae'} />
                  </mesh>
                )
              })}
            </group>
          )
        })}
        {/* roof caps the TOP floor at the building's total height */}
        {plan.roof === 'flat' &&
          topFloor.rooms.filter((r) => r.source === 'auto').map((r) => (
            <RoofSlab key={'roof-' + r.id} room={r} height={topElev + topHeightM} mat={mat} />
          ))}
        {plan.roof === 'pitched' &&
          extractFootprints(topFloor.walls).map((fp, i) => (
            <HipRoof key={'hip-' + i} footprint={fp}
              pitchDeg={plan.roofPitch || 30} height={topElev + topHeightM} mat={mat} />
          ))}
        {!walkMode && <OrbitControls makeDefault target={target} />}
        {!walkMode && <FrameCamera target={target} radius={radius} flownRef={flownRef} />}
        {walkMode && (
          <WalkMode
            plan={plan}
            elevations={elevations}
            input={walkInput}
            mobile={isTouch}
            onExit={() => setWalkMode(false)}
          />
        )}
        <CamProbe probe={camProbe} />
      </Canvas>
      {!walkMode && plan.floors[0].walls.length > 0 && (
        <button
          className="walk-pill glass"
          onClick={() => {
            const c = camProbe.current
            if (c) savedCam.current = { p: c.position.clone(), q: c.quaternion.clone() }
            setWalkMode(true)
          }}
        >
          🚶 Walk through
        </button>
      )}
      {walkMode && !isTouch && (
        <div className="walk-pill walk-hint glass">
          WASD move · Shift run · mouse look · Esc exits
        </div>
      )}
      {walkMode && isTouch && (
        <>
          <Joystick side="left" label="Move"
            onChange={(v) => { walkInput.current.move = v }} />
          <Joystick side="right" label="Look"
            onChange={(v) => { walkInput.current.look = v }} />
          <button className="walk-exit glass" onClick={() => setWalkMode(false)}>
            ✕ Exit
          </button>
        </>
      )}
    </div>
  )
}

// tiny helper: exposes the canvas camera to the DOM layer for
// save/restore around walk mode
function CamProbe({ probe }) {
  const { camera } = useThree()
  React.useEffect(() => { probe.current = camera }, [camera, probe])
  React.useEffect(() => () => { probe.current = null }, [probe])
  return null
}
