// ============================================================
// PlanForge — door-swing clearance checks (pure, testable)
// ------------------------------------------------------------
// A swinging door needs its quarter-circle swing area free.
// This module builds the swing sector(s) for a door (single =
// one full-width quarter, double = two half-width quarters,
// sliding = none) and reports furniture standing in the way.
// Sector-vs-rotated-rect intersection uses dense boundary
// sampling both ways — robust and plenty accurate for warnings.
// ============================================================
import { pointAlongWall, pointInRotRect, dist } from './geo.js'

const TAU = Math.PI * 2
const norm = (a) => ((a % TAU) + TAU) % TAU

// Swing sectors for a door opening. Angles in radians; the sector
// spans 90° counter-clockwise-or-clockwise from `a0` to `a1`
// (stored normalized so a1 = a0 + π/2).
export function doorSwingSectors(wall, o) {
  if (o.type !== 'door') return []
  const variant = o.variant || 'single'
  if (variant === 'sliding') return []
  const len = dist(wall.start, wall.end) || 1
  const swing = o.swingSide || 1
  const nx = ((wall.end.y - wall.start.y) / len) * swing
  const ny = (-(wall.end.x - wall.start.x) / len) * swing

  const sectorAt = (hingeT, otherT, radius) => {
    const h = pointAlongWall(wall, hingeT)
    const q = pointAlongWall(wall, otherT)
    const aLeaf = Math.atan2(ny, nx)
    const aJamb = Math.atan2(q.y - h.y, q.x - h.x)
    // the quarter sweeps between the leaf direction and the jamb
    // direction; order them so a1 = a0 + 90°
    let a0 = aLeaf
    const d = norm(aJamb - aLeaf)
    if (Math.abs(d - Math.PI / 2) > 0.01) a0 = aJamb
    return { hinge: h, radius, a0: norm(a0) }
  }

  if (variant === 'double') {
    const half = o.width / 2
    return [
      sectorAt(o.offset, o.offset + o.width, half),
      sectorAt(o.offset + o.width, o.offset, half),
    ]
  }
  const hingeT = o.hinge === 'end' ? o.offset + o.width : o.offset
  const otherT = o.hinge === 'end' ? o.offset : o.offset + o.width
  return [sectorAt(hingeT, otherT, o.width)]
}

const inSector = (sec, p) => {
  const dx = p.x - sec.hinge.x
  const dy = p.y - sec.hinge.y
  if (Math.hypot(dx, dy) > sec.radius) return false
  const rel = norm(Math.atan2(dy, dx) - sec.a0)
  return rel <= Math.PI / 2 + 1e-9
}

export function sectorIntersectsRect(sec, rect) {
  // rect corners inside the sector
  const r = (rect.rot * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({
    x: rect.cx + (sx * rect.w / 2) * c - (sy * rect.d / 2) * s,
    y: rect.cy + (sx * rect.w / 2) * s + (sy * rect.d / 2) * c,
  }))
  if (corners.some((p) => inSector(sec, p))) return true
  // sector boundary samples inside the rect: hinge, both radii
  // (several points each), and the arc every ~9°
  const samples = [sec.hinge]
  for (const ang of [sec.a0, sec.a0 + Math.PI / 2]) {
    for (let f = 0.25; f <= 1.001; f += 0.25) {
      samples.push({
        x: sec.hinge.x + Math.cos(ang) * sec.radius * f,
        y: sec.hinge.y + Math.sin(ang) * sec.radius * f,
      })
    }
  }
  for (let k = 0; k <= 10; k++) {
    const ang = sec.a0 + (Math.PI / 2) * (k / 10)
    samples.push({
      x: sec.hinge.x + Math.cos(ang) * sec.radius,
      y: sec.hinge.y + Math.sin(ang) * sec.radius,
    })
  }
  return samples.some((p) => pointInRotRect(p, { x: rect.cx, y: rect.cy }, rect.w, rect.d, rect.rot))
}

// Scan a floor: for every swinging door, which furniture blocks it?
// Returns [{ openingId, furnitureIds }] — only doors with issues.
export function doorClearanceIssues(floor) {
  const out = []
  for (const o of floor.openings) {
    if (o.type !== 'door') continue
    const wall = floor.walls.find((w) => w.id === o.wallId)
    if (!wall) continue
    const sectors = doorSwingSectors(wall, o)
    if (!sectors.length) continue
    const blocked = []
    for (const f of floor.furniture) {
      const rect = { cx: f.position.x, cy: f.position.y, w: f.dimensions.w, d: f.dimensions.d, rot: f.rotation }
      if (sectors.some((sec) => sectorIntersectsRect(sec, rect))) blocked.push(f.id)
    }
    if (blocked.length) out.push({ openingId: o.id, furnitureIds: blocked })
  }
  return out
}
