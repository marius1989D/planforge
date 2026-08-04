// ============================================================
// Geometry primitives shared by the 2D editor and 3D engine,
// plus the room auto-detection (planar-graph face extraction)
// and the wall segment decomposition used by the 3D extruder.
// This module is dependency-free so it can be unit-tested with
// plain `node src/geometry/geo.test.mjs`.
// ============================================================

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)

export const wallLength = (w) => dist(w.start, w.end)

export const wallAngle = (w) => Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x)

export const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export const snap = (v, grid) => Math.round(v / grid) * grid

export const snapPoint = (p, grid) => ({ x: snap(p.x, grid), y: snap(p.y, grid) })

// Point along a wall at `offset` mm from its start
export function pointAlongWall(wall, offset) {
  const len = wallLength(wall)
  if (len === 0) return { ...wall.start }
  const t = offset / len
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    y: wall.start.y + (wall.end.y - wall.start.y) * t,
  }
}

// Shoelace formula — signed area in mm².
// NOTE: plan coordinates are y-DOWN (screen space). With the
// traversal rule used in detectRooms(), interior faces come out
// with POSITIVE signed area. Verified by geo.test.mjs.
export function signedAreaMm2(polygon) {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

export const polygonAreaM2 = (polygon) =>
  Math.abs(signedAreaMm2(polygon)) / 1_000_000

export function polygonCentroid(polygon) {
  let cx = 0, cy = 0
  for (const p of polygon) { cx += p.x; cy += p.y }
  return { x: cx / polygon.length, y: cy / polygon.length }
}

// ---- deterministic room ids --------------------------------
// Hash of the sorted wall-id set. Same wall loop → same room id
// across recomputes, so user renames survive wall edits.
function loopHash(wallIds) {
  const s = wallIds.slice().sort().join('|')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

// ============================================================
// detectRooms(walls) — auto room detection
// ------------------------------------------------------------
// 1. Merge wall endpoints into graph nodes (within tolerance).
// 2. Build unique undirected edges.
// 3. Extract planar faces: every directed half-edge is walked
//    exactly once; at each node we turn to the next edge in
//    clockwise order from the reverse edge ("clockwise-next").
// 4. Interior faces have positive shoelace area (y-down coords);
//    the unbounded outer face per component is negative → drop.
// Limitations (by design for now): walls that CROSS without a
// shared endpoint don't create an intersection node — step 2's
// drawing tools will auto-split walls at junctions.
// ============================================================
const MIN_ROOM_AREA_MM2 = 100_000 // 0.1 m² — ignores slivers

// Shared planar-graph face traversal. Returns ALL faces:
// interior faces have positive signed area (y-down coords), the
// unbounded outer face of each connected component is negative.
export function extractFaces(walls, { tolerance = 10 } = {}) {
  if (!walls || walls.length < 3) return []

  // -- nodes (merged endpoints) --
  const nodes = []
  const findNode = (p) => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x - p.x, nodes[i].y - p.y) <= tolerance) return i
    }
    nodes.push({ x: p.x, y: p.y })
    return nodes.length - 1
  }

  // -- unique undirected edges --
  const edges = []
  const seen = new Set()
  for (const w of walls) {
    const a = findNode(w.start)
    const b = findNode(w.end)
    if (a === b) continue // zero-length after merge
    const k = a < b ? `${a}|${b}` : `${b}|${a}`
    if (seen.has(k)) continue // duplicate wall on same segment
    seen.add(k)
    edges.push({ a, b, wallId: w.id })
  }
  if (edges.length < 3) return []

  // -- adjacency, sorted by outgoing angle --
  const adj = nodes.map(() => [])
  edges.forEach((e, i) => {
    adj[e.a].push({ to: e.b, edge: i })
    adj[e.b].push({ to: e.a, edge: i })
  })
  const angleOf = (from, to) =>
    Math.atan2(nodes[to].y - nodes[from].y, nodes[to].x - nodes[from].x)
  adj.forEach((list, v) => list.sort((p, q) => angleOf(v, p.to) - angleOf(v, q.to)))

  // -- face traversal --
  const visited = new Set()
  const faces = []
  const GUARD = 4 * edges.length + 8

  for (const e of edges) {
    for (const [u0, v0] of [[e.a, e.b], [e.b, e.a]]) {
      if (visited.has(`${u0}>${v0}`)) continue
      const faceNodes = []
      const faceWalls = []
      let u = u0
      let v = v0
      let steps = 0
      let closed = false
      while (steps++ < GUARD) {
        visited.add(`${u}>${v}`)
        faceNodes.push(u)
        const cur = adj[u].find((r) => r.to === v)
        if (cur) faceWalls.push(edges[cur.edge].wallId)
        const list = adj[v]
        const idx = list.findIndex((r) => r.to === u)
        const next = list[(idx - 1 + list.length) % list.length] // clockwise-next
        u = v
        v = next.to
        if (u === u0 && v === v0) { closed = true; break }
      }
      if (!closed) continue
      const polygon = faceNodes.map((i) => ({ x: nodes[i].x, y: nodes[i].y }))
      const area = signedAreaMm2(polygon)
      faces.push({ polygon, area, wallIds: [...new Set(faceWalls)] })
    }
  }

  return faces
}

export function detectRooms(walls, { tolerance = 10 } = {}) {
  const faces = extractFaces(walls, { tolerance })
  // -- keep interior faces only --
  const interior = faces.filter(
    (f) => f.area > 0 && f.area > MIN_ROOM_AREA_MM2,
  )

  // stable ordering: top-left rooms first → stable default names
  interior.sort((f1, f2) => {
    const c1 = polygonCentroid(f1.polygon)
    const c2 = polygonCentroid(f2.polygon)
    return c1.y - c2.y || c1.x - c2.x
  })

  return interior.map((f, i) => ({
    id: `room_auto_${loopHash(f.wallIds)}`,
    name: `Room ${i + 1}`,
    source: 'auto',
    wallIds: f.wallIds,
    polygon: f.polygon,
    area: f.area / 1_000_000, // m²
  }))
}

// ============================================================
// wallSegments(wall, openings) — segment decomposition
// ------------------------------------------------------------
// Splits a wall (with its door/window openings) into solid
// axis-aligned pieces in wall-local coordinates:
//   { from, to }  → span along the wall (mm from start)
//   { y0, y1 }    → vertical extent (mm from floor)
// Full segments between openings, lintels above doors, and
// sill + lintel around windows. The 3D engine turns each into
// a box. No CSG needed, no shape-hole artifacts.
// ============================================================
export function wallSegments(wall, openings = []) {
  const len = wallLength(wall)
  const H = wall.height
  const ops = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({
      ...o,
      from: Math.max(0, Math.min(o.offset, len)),
      to: Math.max(0, Math.min(o.offset + o.width, len)),
    }))
    .filter((o) => o.to > o.from)
    .sort((a, b) => a.from - b.from)

  const segs = []
  let cursor = 0
  for (const o of ops) {
    if (o.from > cursor) segs.push({ from: cursor, to: o.from, y0: 0, y1: H })
    const top = o.type === 'door' ? o.height : o.sillHeight + o.height
    if (o.type === 'window' && o.sillHeight > 0) {
      segs.push({ from: o.from, to: o.to, y0: 0, y1: Math.min(o.sillHeight, H) })
    }
    if (top < H) segs.push({ from: o.from, to: o.to, y0: Math.min(top, H), y1: H })
    cursor = Math.max(cursor, o.to)
  }
  if (cursor < len) segs.push({ from: cursor, to: len, y0: 0, y1: H })
  return segs
}

// ============================================================
// Step 2 — interactive editing geometry
// ============================================================

export function pointToSegmentDist(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return dist(p, a)
  let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2
  t = Math.max(0, Math.min(1, t))
  return dist(p, { x: a.x + t * abx, y: a.y + t * aby })
}

export function pointInPolygon(p, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if ((a.y > p.y) !== (b.y > p.y) &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

// Proper segment intersection. Returns { t, u, point } where t is the
// parameter along a1→a2 and u along b1→b2, or null if no crossing.
// Parallel/collinear pairs return null (drawing tools handle those by
// endpoint snapping instead).
export function segmentIntersection(a1, a2, b1, b2) {
  const d1x = a2.x - a1.x, d1y = a2.y - a1.y
  const d2x = b2.x - b1.x, d2y = b2.y - b1.y
  const denom = d1x * d2y - d1y * d2x
  if (Math.abs(denom) < 1e-9) return null
  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denom
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denom
  const EPS = 1e-9
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null
  return { t, u, point: { x: a1.x + t * d1x, y: a1.y + t * d1y } }
}

// Cursor snapping for the drawing tools. Priority:
//   1. existing wall endpoint  2. projection onto a wall  3. grid
// `radius` is in plan units (mm).
export function snapToGeometry(p, walls, grid, radius) {
  let best = null
  for (const w of walls) {
    for (const pt of [w.start, w.end]) {
      const d = dist(p, pt)
      if (d <= radius && (!best || d < best.d)) {
        best = { d, point: { ...pt }, kind: 'endpoint' }
      }
    }
  }
  if (best) return best
  for (const w of walls) {
    const abx = w.end.x - w.start.x, aby = w.end.y - w.start.y
    const len2 = abx * abx + aby * aby
    if (len2 === 0) continue
    let t = ((p.x - w.start.x) * abx + (p.y - w.start.y) * aby) / len2
    t = Math.max(0, Math.min(1, t))
    const proj = { x: w.start.x + t * abx, y: w.start.y + t * aby }
    const d = dist(p, proj)
    if (d <= radius && (!best || d < best.d)) {
      best = { d, point: proj, kind: 'wall' }
    }
  }
  if (best) return best
  return { d: 0, point: snapPoint(p, grid), kind: 'grid' }
}

// ============================================================
// splitPlanWalls — junction handling when committing a new wall
// ------------------------------------------------------------
// Finds every crossing / T-junction between the new wall and the
// existing walls, splits existing walls at those points (first half
// keeps the original id so openings on it stay valid; openings past
// the split move to the new half with adjusted offset; openings
// straddling the split are dropped), and splits the new wall into
// segments at each junction. `makeWall` is a factory (injected so
// this module stays dependency-free).
// Returns { walls, openings, newWallIds }.
// ============================================================
export function splitPlanWalls(walls, openings, newWallProps, makeWall, { tolerance = 10 } = {}) {
  const nStart = newWallProps.start
  const nEnd = newWallProps.end
  const newLen = dist(nStart, nEnd)
  if (newLen <= tolerance) return { walls, openings, newWallIds: [] }

  let outWalls = []
  let outOpenings = [...openings]
  const newWallCuts = [] // t values along the new wall

  for (const w of walls) {
    const wLen = wallLength(w)
    const hit = wLen > 0 && segmentIntersection(nStart, nEnd, w.start, w.end)
    const uInterior = hit && hit.u * wLen > tolerance && (1 - hit.u) * wLen > tolerance
    const tInterior = hit && hit.t * newLen > tolerance && (1 - hit.t) * newLen > tolerance

    if (hit && tInterior) newWallCuts.push(hit.t)

    if (hit && uInterior) {
      // split existing wall at hit.point
      const splitOffset = hit.u * wLen
      const first = { ...w, end: { ...hit.point } } // keeps original id
      const second = makeWall({
        start: { ...hit.point }, end: { ...w.end },
        thickness: w.thickness, height: w.height,
      })
      outWalls.push(first, second)
      outOpenings = outOpenings.flatMap((o) => {
        if (o.wallId !== w.id) return [o]
        if (o.offset + o.width <= splitOffset + tolerance) return [o]
        if (o.offset >= splitOffset - tolerance) {
          return [{ ...o, wallId: second.id, offset: o.offset - splitOffset }]
        }
        return [] // straddles the junction → invalid, drop
      })
    } else {
      outWalls.push(w)
    }
  }

  // split the new wall at its junction points
  const ts = [...new Set(newWallCuts)].sort((a, b) => a - b)
  const stops = [0, ...ts, 1]
  const lerp = (t) => ({
    x: nStart.x + (nEnd.x - nStart.x) * t,
    y: nStart.y + (nEnd.y - nStart.y) * t,
  })
  const newWallIds = []
  for (let i = 0; i < stops.length - 1; i++) {
    const a = lerp(stops[i])
    const b = lerp(stops[i + 1])
    if (dist(a, b) <= tolerance) continue
    const w = makeWall({
      start: a, end: b,
      thickness: newWallProps.thickness, height: newWallProps.height,
    })
    outWalls.push(w)
    newWallIds.push(w.id)
  }

  return { walls: outWalls, openings: outOpenings, newWallIds }
}

// ============================================================
// Step-2-followup — whole room/zone dragging support
// ------------------------------------------------------------
// A room is just a set of walls (wallIds). Some of its corner/
// endpoint nodes may be SHARED with walls outside the room (a
// dividing wall between two rooms, or a corner three rooms meet
// at). Those shared nodes must NOT move with a naive drag, or
// the shared wall tears away from its other side.
//
// classifyRoomNodes(room, allWalls) returns, for every distinct
// endpoint used by the room's walls:
//   { point, free: true }   → only touched by this room's walls,
//                              safe to translate freely
//   { point, free: false }  → also touched by a wall outside the
//                              room, must stay put (shared wall
//                              stretches to follow, same as single
//                              wall dragging already does)
// ============================================================
export function classifyRoomNodes(room, allWalls, tolerance = 10) {
  const roomWallIds = new Set(room.wallIds || [])
  const roomWalls = allWalls.filter((w) => roomWallIds.has(w.id))
  const outsideWalls = allWalls.filter((w) => !roomWallIds.has(w.id))

  const isTouchedByOutside = (p) =>
    outsideWalls.some(
      (w) => dist(w.start, p) <= tolerance || dist(w.end, p) <= tolerance,
    )

  const seen = []
  for (const w of roomWalls) {
    for (const p of [w.start, w.end]) {
      if (seen.some((q) => dist(q.point, p) <= tolerance)) continue
      seen.push({ point: { ...p }, free: !isTouchedByOutside(p) })
    }
  }
  return seen
}

// Translate a polygon (zone) by a fixed delta — every vertex moves.
export function translatePolygon(polygon, dx, dy) {
  return polygon.map((p) => ({ x: p.x + dx, y: p.y + dy }))
}

// ============================================================
// wallPlanSpans — flattened top-down wall geometry for print/PDF
// ------------------------------------------------------------
// Unlike wallSegments() (which splits by height for the 3D engine),
// this only needs horizontal spans: solid wall spans, and separately
// the opening spans tagged by type, for drawing gaps + door/window
// symbols in a 2D plan view.
// ============================================================
export function wallPlanSpans(wall, openings = []) {
  const len = wallLength(wall)
  const ops = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({
      ...o,
      from: Math.max(0, Math.min(o.offset, len)),
      to: Math.max(0, Math.min(o.offset + o.width, len)),
    }))
    .filter((o) => o.to > o.from)
    .sort((a, b) => a.from - b.from)

  const solid = []
  let cursor = 0
  for (const o of ops) {
    if (o.from > cursor) solid.push({ from: cursor, to: o.from })
    cursor = Math.max(cursor, o.to)
  }
  if (cursor < len) solid.push({ from: cursor, to: len })
  return { solid, openings: ops }
}

// Axis-aligned-agnostic rectangle for a straight segment of given
// thickness — used to render walls as filled quads (2D print/PDF,
// or any other exact-geometry renderer).
export function thickSegmentQuad(a, b, thickness) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return null
  const nx = (-dy / len) * (thickness / 2)
  const ny = (dx / len) * (thickness / 2)
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ]
}

// Bounding box of the whole plan (walls + manual zone polygons) in mm.
export function planBounds(plan) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const visit = (p) => {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  for (const w of plan.walls) { visit(w.start); visit(w.end) }
  for (const r of plan.rooms) for (const p of r.polygon || []) visit(p)
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  return { minX, minY, maxX, maxY }
}

// ============================================================
// healPlanWalls — global wall-graph normalization
// ------------------------------------------------------------
// Fixes every junction the pairwise "new wall" splitting can't see:
//   • collinear overlaps (drawing a room's wall ALONG an existing
//     wall — segmentIntersection returns null for parallels, which
//     is how rooms were vanishing when joined)
//   • junctions formed by DRAGGING rooms/walls against each other
//     (moveNodes never split anything)
// Strategy, repeated until stable:
//   1. any wall endpoint lying on another wall's interior → split
//      that wall there (covers T-junctions AND collinear overlaps,
//      since overlapping parallels get cut at each other's ends)
//   2. proper X crossings → split
// Then: drop near-zero-length walls, dedupe coincident segments
// (openings remapped to the kept wall, offsets flipped if the
// duplicate ran the opposite direction).
// ============================================================
export function healPlanWalls(walls, openings, makeWall, { tolerance = 10 } = {}) {
  let W = walls.map((w) => ({ ...w }))
  let O = [...openings]

  // offset (mm) along `wall` where p lies, if p is on the wall's
  // interior within tolerance; null otherwise
  const paramOn = (wall, p) => {
    const len = wallLength(wall)
    if (len <= tolerance) return null
    const abx = wall.end.x - wall.start.x
    const aby = wall.end.y - wall.start.y
    const t = ((p.x - wall.start.x) * abx + (p.y - wall.start.y) * aby) / (len * len)
    const proj = { x: wall.start.x + t * abx, y: wall.start.y + t * aby }
    if (dist(p, proj) > tolerance) return null
    const off = t * len
    if (off < tolerance || off > len - tolerance) return null
    return off
  }

  const doSplit = (idx, offset) => {
    const w = W[idx]
    const point = pointAlongWall(w, offset)
    const first = { ...w, end: { x: point.x, y: point.y } } // keeps id → openings before split stay valid
    const second = makeWall({
      start: { x: point.x, y: point.y }, end: { ...w.end },
      thickness: w.thickness, height: w.height,
    })
    O = O.flatMap((o) => {
      if (o.wallId !== w.id) return [o]
      if (o.offset + o.width <= offset + tolerance) return [o]
      if (o.offset >= offset - tolerance) {
        return [{ ...o, wallId: second.id, offset: o.offset - offset }]
      }
      return [] // straddles the new junction → invalid, drop
    })
    W.splice(idx, 1, first, second)
  }

  let guard = 0
  let changed = true
  while (changed && guard++ < 400) {
    changed = false
    outer:
    for (let i = 0; i < W.length; i++) {
      // 1) endpoints of other walls on W[i]'s interior
      for (let j = 0; j < W.length; j++) {
        if (i === j) continue
        for (const p of [W[j].start, W[j].end]) {
          const off = paramOn(W[i], p)
          if (off !== null) {
            doSplit(i, off)
            changed = true
            break outer
          }
        }
      }
      // 2) proper crossings
      for (let j = i + 1; j < W.length; j++) {
        const hit = segmentIntersection(W[i].start, W[i].end, W[j].start, W[j].end)
        if (!hit) continue
        const li = wallLength(W[i])
        const lj = wallLength(W[j])
        const iInt = hit.t * li > tolerance && (1 - hit.t) * li > tolerance
        const jInt = hit.u * lj > tolerance && (1 - hit.u) * lj > tolerance
        if (iInt && jInt) {
          doSplit(i, hit.t * li)
          changed = true
          break outer
        }
      }
    }
  }

  // drop degenerate walls (and their openings)
  const tooShort = new Set(W.filter((w) => wallLength(w) <= tolerance).map((w) => w.id))
  if (tooShort.size) {
    W = W.filter((w) => !tooShort.has(w.id))
    O = O.filter((o) => !tooShort.has(o.wallId))
  }

  // dedupe coincident segments; remap their openings to the kept wall
  const kept = []
  for (const w of W) {
    const dup = kept.find(
      (k) =>
        (dist(k.start, w.start) <= tolerance && dist(k.end, w.end) <= tolerance) ||
        (dist(k.start, w.end) <= tolerance && dist(k.end, w.start) <= tolerance),
    )
    if (!dup) {
      kept.push(w)
      continue
    }
    const reversed = dist(dup.start, w.end) <= tolerance && dist(dup.end, w.start) <= tolerance
    const dupLen = wallLength(dup)
    O = O.map((o) => {
      if (o.wallId !== w.id) return o
      const offset = reversed ? dupLen - o.offset - o.width : o.offset
      return { ...o, wallId: dup.id, offset: Math.max(0, offset) }
    })
  }

  return { walls: kept, openings: O }
}

// Clamped offset (mm along the wall from its start) of p's projection —
// used for placing and dragging openings along a wall.
export function offsetOnWall(wall, p) {
  const abx = wall.end.x - wall.start.x
  const aby = wall.end.y - wall.start.y
  const len2 = abx * abx + aby * aby
  if (len2 === 0) return 0
  let t = ((p.x - wall.start.x) * abx + (p.y - wall.start.y) * aby) / len2
  t = Math.max(0, Math.min(1, t))
  return t * Math.sqrt(len2)
}

// Point-in-rotated-rectangle: center-based, rotation in degrees
// (Konva convention, clockwise in y-down screen space).
export function pointInRotRect(p, center, w, d, rotationDeg) {
  const r = (-rotationDeg * Math.PI) / 180
  const dx = p.x - center.x
  const dy = p.y - center.y
  const lx = dx * Math.cos(r) - dy * Math.sin(r)
  const ly = dx * Math.sin(r) + dy * Math.cos(r)
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= d / 2
}

// ============================================================
// Building footprints & dimension lines
// ============================================================

// Outer boundary polygon(s) of the building(s): the negative faces
// of the planar graph, one per connected component, reversed to
// positive (screen-clockwise) orientation so "interior on the right,
// outward normal on the left" holds for every edge.
// Drop vertices that lie (within tolerance) on the line between their
// neighbors — junction nodes from healing are graph vertices but not
// geometric corners, and they'd split dimension lines / noise up roofs.
export function simplifyCollinear(polygon, tolerance = 1) {
  if (polygon.length <= 3) return polygon
  const out = []
  for (let i = 0; i < polygon.length; i++) {
    const prev = polygon[(i - 1 + polygon.length) % polygon.length]
    const cur = polygon[i]
    const next = polygon[(i + 1) % polygon.length]
    if (pointToSegmentDist(cur, prev, next) > tolerance) out.push(cur)
  }
  return out.length >= 3 ? out : polygon
}

export function extractFootprints(walls, { tolerance = 10, minArea = 1_000_000 } = {}) {
  return extractFaces(walls, { tolerance })
    .filter((f) => f.area < -minArea)
    .map((f) => simplifyCollinear([...f.polygon].reverse()))
}

// Architectural dimension lines for a footprint's exterior edges.
// Polygon must be positively oriented (extractFootprints guarantees
// this). Returns one entry per edge >= minLength with the dimension
// line offset OUTWARD by `offset` mm plus a label anchor.
export function footprintDimensions(polygon, { offset = 600, minLength = 300 } = {}) {
  const poly = signedAreaMm2(polygon) < 0 ? [...polygon].reverse() : polygon
  const dims = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const len = dist(a, b)
    if (len < minLength) continue
    // outward normal for a positive-shoelace (screen-CW) polygon:
    // rotate the direction -90° → (dy, -dx)
    const nx = (b.y - a.y) / len
    const ny = -(b.x - a.x) / len
    const pa = { x: a.x + nx * offset, y: a.y + ny * offset }
    const pb = { x: b.x + nx * offset, y: b.y + ny * offset }
    dims.push({
      a, b, pa, pb, len,
      nx, ny,
      label: { x: (pa.x + pb.x) / 2 + nx * 320, y: (pa.y + pb.y) / 2 + ny * 320 },
    })
  }
  return dims
}
