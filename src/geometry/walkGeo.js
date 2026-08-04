// ============================================================
// PlanForge — first-person walkthrough geometry (pure, no three)
// ------------------------------------------------------------
// All inputs in plan mm (y-down); heights in metres.
//   • computeElevationsM: stacked floor elevations (shared w/ View3D)
//   • stairHeightAtM: step-top height under a point on a stair
//   • supportHeightAtM: what the player stands on — highest support
//     reachable with a ≤0.35m step-up (slabs of floors whose rooms
//     contain the point, stair steps, always ground 0)
//   • resolveCollisionMm: circle-vs-wall push-out, doors pass through
//   • startPoseMm: spawn just inside the entrance door, facing in
// ============================================================
import { pointInRotRect, pointInPolygon, pointAlongWall } from './geo.js'

const M = 1 / 1000
export const STEP_UP_M = 0.35
export const EYE_M = 1.6

export const floorHeightMm = (floor) =>
  floor.walls.length ? Math.max(...floor.walls.map((w) => w.height), 2400) : 2400

export function computeElevationsM(plan) {
  const starts = []
  let y = 0
  for (const f of plan.floors) {
    starts.push(y)
    y += floorHeightMm(f) * M
  }
  return { starts, total: y }
}

export const stairStepCount = (riseM) => Math.max(3, Math.ceil((riseM * 1000) / 180))

// Height (m) of the step top under p, or null if p is off the stair.
// Treads climb toward local -y (the 2D "UP" arrow end). Matches the
// 3D render exactly (same n, same step spans).
export function stairHeightAtM(stair, p, riseM) {
  if (!pointInRotRect(p, stair.position, stair.width, stair.length, stair.rotation)) return null
  const rad = (-stair.rotation * Math.PI) / 180
  const dx = p.x - stair.position.x
  const dy = p.y - stair.position.y
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad) // local y, mm
  const n = stairStepCount(riseM)
  const stepD = stair.length / n // mm
  let k = Math.floor((stair.length / 2 - ly) / stepD)
  k = Math.max(0, Math.min(n - 1, k))
  return ((k + 1) / n) * riseM
}

// The support under the player's feet. Later floors win height ties so
// topping out on a stair hands you to the upper slab (floor switch).
export function supportHeightAtM(plan, p, feetM, elevations) {
  let best = 0
  let bestFloor = 0
  const consider = (h, i) => {
    if (h <= feetM + STEP_UP_M && h >= best - 1e-9) {
      best = h
      bestFloor = i
    }
  }
  plan.floors.forEach((f, i) => {
    const e = elevations.starts[i]
    if (i > 0 && f.rooms.some((r) => r.source === 'auto' && pointInPolygon(p, r.polygon))) {
      consider(e, i)
    }
    const riseM = i < plan.floors.length - 1
      ? elevations.starts[i + 1] - e
      : floorHeightMm(f) * M
    for (const st of f.stairs) {
      const h = stairHeightAtM(st, p, riseM)
      if (h != null) consider(e + h, i)
    }
  })
  return { feetM: best, floorIdx: bestFloor }
}

// Push a circle (radius mm) out of every wall on the floor, except
// where a door opening spans the contact point. Two passes settle
// corner cases where the first push slides into a neighboring wall.
export function resolveCollisionMm(walls, openings, p, radiusMm = 250) {
  let q = { x: p.x, y: p.y }
  for (let pass = 0; pass < 2; pass++) {
    for (const w of walls) {
      const dxw = w.end.x - w.start.x
      const dyw = w.end.y - w.start.y
      const len = Math.hypot(dxw, dyw)
      if (len < 1) continue
      const ux = dxw / len
      const uy = dyw / len
      const t = Math.max(0, Math.min(len, (q.x - w.start.x) * ux + (q.y - w.start.y) * uy))
      const cx = w.start.x + ux * t
      const cy = w.start.y + uy * t
      let d = Math.hypot(q.x - cx, q.y - cy)
      const clearance = radiusMm + w.thickness / 2
      if (d >= clearance) continue
      const doors = openings.filter((o) => o.wallId === w.id && o.type === 'door')
      if (doors.some((o) => t >= o.offset + 80 && t <= o.offset + o.width - 80)) continue
      let nx
      let ny
      if (d < 1e-6) {
        nx = uy
        ny = -ux
        d = 1
        q = { x: cx + nx * clearance, y: cy + ny * clearance }
      } else {
        nx = (q.x - cx) / d
        ny = (q.y - cy) / d
        q = { x: cx + nx * clearance, y: cy + ny * clearance }
      }
    }
  }
  return q
}

// Spawn: just inside the first ground-floor door, facing into the room
// (door swing side points at the room). Falls back to the largest
// ground room's centroid, then the origin.
export function startPoseMm(plan) {
  const g = plan.floors[0]
  for (const o of g.openings) {
    if (o.type !== 'door') continue
    const wall = g.walls.find((w) => w.id === o.wallId)
    if (!wall) continue
    const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
    if (len < 1) continue
    const mid = pointAlongWall(wall, o.offset + o.width / 2)
    const s = o.swingSide || 1
    const nx = ((wall.end.y - wall.start.y) / len) * s
    const ny = (-(wall.end.x - wall.start.x) / len) * s
    return { x: mid.x + nx * 900, y: mid.y + ny * 900, dirX: nx, dirY: ny }
  }
  const rooms = g.rooms.filter((r) => r.source === 'auto')
  if (rooms.length) {
    const biggest = rooms.reduce((a, b) => (b.area > a.area ? b : a))
    const c = biggest.polygon.reduce(
      (acc, pt) => ({ x: acc.x + pt.x / biggest.polygon.length, y: acc.y + pt.y / biggest.polygon.length }),
      { x: 0, y: 0 },
    )
    return { x: c.x, y: c.y, dirX: 1, dirY: 0 }
  }
  return { x: 0, y: 0, dirX: 1, dirY: 0 }
}
