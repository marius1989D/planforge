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

// theme-driven materials; zone overlay colors reuse the plan zone ramp
const materialsFor = (T) => ({
  wall: T.three.wall,
  floor: T.three.floor,
  glass: T.three.glass,
  roof: T.three.roof,
  zone: T.plan.zoneColors,
})

// Camera fly-in: starts top-down over the plan (echoing the 2D view)
// and eases into the standard orbit pose over ~700ms — the signature
// "the plan and the model are one object" moment. Controls unlock when
// it lands. Skipped entirely under prefers-reduced-motion.
function FlyIn({ target, flownRef }) {
  const { camera, controls } = useThree()
  const startTime = React.useRef(null)
  const done = React.useRef(
    flownRef.current ||
    (typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches),
  )
  useFrame((state) => {
    if (done.current) return
    if (startTime.current == null) startTime.current = state.clock.elapsedTime
    const k = Math.min(1, (state.clock.elapsedTime - startTime.current) / 0.7)
    const e = 1 - Math.pow(1 - k, 3) // ease-out cubic
    const sx = target[0], sy = 16, sz = target[2] + 0.02
    const ex = target[0] + 9, ey = 8, ez = target[2] + 9
    camera.position.set(sx + (ex - sx) * e, sy + (ey - sy) * e, sz + (ez - sz) * e)
    camera.lookAt(target[0], 0, target[2])
    if (controls) controls.enabled = false
    if (k >= 1) {
      done.current = true
      flownRef.current = true
      if (controls) {
        controls.target.set(target[0], 0, target[2])
        controls.update()
        controls.enabled = true
      }
    }
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
function WalkMode({ plan, elevations, onExit }) {
  const { camera } = useThree()
  const controlsRef = React.useRef(null)
  const keys = React.useRef({})
  const feet = React.useRef(0)
  const floorIdx = React.useRef(0)

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
    const t = setTimeout(() => controlsRef.current?.lock?.(), 60)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', dn)
      window.removeEventListener('keyup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame((_, delta) => {
    const k = keys.current
    const run = k.ShiftLeft || k.ShiftRight
    const step = (run ? 4.2 : 2.2) * Math.min(delta, 0.05)
    const fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0)
    const strafe = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0)
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

  return <PointerLockControls ref={controlsRef} onUnlock={onExit} />
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
        {!walkMode && <FlyIn target={target} flownRef={flownRef} />}
        {walkMode && (
          <WalkMode
            plan={plan}
            elevations={elevations}
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
      {walkMode && (
        <div className="walk-pill walk-hint glass">
          WASD move · Shift run · mouse look · Esc exits
        </div>
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
