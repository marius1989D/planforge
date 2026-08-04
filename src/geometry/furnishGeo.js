// ============================================================
// PlanForge — auto-furnish engine (pure, node-testable)
// ------------------------------------------------------------
// Given a room (polygon + its walls/openings) and a room kind,
// produce furniture placements that respect:
//   • wall faces (items back onto the inner wall face)
//   • door keep-outs (swing arcs / passage strips stay clear)
//   • windows (TALL items never block a window span)
//   • pairwise collision (rotated-rect SAT) + front clearances
// Deterministic: no randomness, greedy with scored candidates.
// ============================================================
import { pointInPolygon, pointAlongWall, pointToSegmentDist, dist } from './geo.js'
import { FURNITURE_BY_TYPE } from '../model/furnitureLibrary.js'

const TALL_MM = 1100 // items at/above this height must not block windows
const FRONT_CLEAR = 650 // walkway in front of an item
const EDGE_MARGIN = 80 // breathing room between items along a wall

// ---------- rotated-rect SAT ---------------------------------
const rectCorners = ({ cx, cy, w, d, rot }) => {
  const r = (rot * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
    .map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }))
}
export function rotRectsOverlap(A, B) {
  const ca = rectCorners(A)
  const cb = rectCorners(B)
  for (const corners of [ca, cb]) {
    for (let i = 0; i < 4; i++) {
      const p1 = corners[i]
      const p2 = corners[(i + 1) % 4]
      const ax = p2.y - p1.y
      const ay = -(p2.x - p1.x)
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity
      for (const p of ca) { const v = p.x * ax + p.y * ay; minA = Math.min(minA, v); maxA = Math.max(maxA, v) }
      for (const p of cb) { const v = p.x * ax + p.y * ay; minB = Math.min(minB, v); maxB = Math.max(maxB, v) }
      if (maxA < minB + 0.5 || maxB < minA + 0.5) return false // separating axis (0.5mm: exact adjacency is legal)
    }
  }
  return true
}

// ---------- room edge analysis --------------------------------
// Each polygon edge gets: inward unit normal (probed, so polygon
// orientation never matters), the matching wall's thickness, and
// opening spans projected into edge parameters.
export function analyzeRoomEdges(room, walls, openings) {
  const poly = room.polygon
  const edges = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const len = dist(a, b)
    if (len < 200) continue
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    let inX = uy
    let inY = -ux
    const probe = { x: (a.x + b.x) / 2 + inX * 15, y: (a.y + b.y) / 2 + inY * 15 }
    if (!pointInPolygon(probe, poly)) { inX = -inX; inY = -inY }

    // matching wall: midpoint sits on its segment
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const wall = walls.find((w) => pointToSegmentDist(mid, w.start, w.end) < 20)
    const thickness = wall?.thickness ?? 150

    const doorSpans = []
    const windowSpans = []
    if (wall) {
      const tOf = (p) => (p.x - a.x) * ux + (p.y - a.y) * uy
      for (const o of openings.filter((x) => x.wallId === wall.id)) {
        const p0 = pointAlongWall(wall, o.offset)
        const p1 = pointAlongWall(wall, o.offset + o.width)
        let t0 = tOf(p0)
        let t1 = tOf(p1)
        if (t1 < t0) [t0, t1] = [t1, t0]
        if (t1 < 0 || t0 > len) continue
        t0 = Math.max(0, t0)
        t1 = Math.min(len, t1)
        if (o.type === 'window') {
          windowSpans.push({ t0, t1 })
        } else {
          // keep-out depth: full leaf for an inward swing, passage
          // strip otherwise (never park furniture in a doorway)
          const wlen = dist(wall.start, wall.end) || 1
          const wnx = ((wall.end.y - wall.start.y) / wlen) * (o.swingSide || 1)
          const wny = (-(wall.end.x - wall.start.x) / wlen) * (o.swingSide || 1)
          const swingInward = wnx * inX + wny * inY > 0
          const variant = o.variant || 'single'
          const depth = variant === 'sliding' ? 600
            : variant === 'double' ? (swingInward ? o.width / 2 : 600)
            : swingInward ? o.width : 600
          doorSpans.push({ t0, t1, depth })
        }
      }
    }
    edges.push({ a, b, len, ux, uy, inX, inY, thickness, doorSpans, windowSpans })
  }
  return edges
}

// door keep-out rects for the whole room (checked against every item)
const doorKeepOuts = (edges) => {
  const outs = []
  for (const e of edges) {
    for (const dsp of e.doorSpans) {
      const tc = (dsp.t0 + dsp.t1) / 2
      const w = dsp.t1 - dsp.t0
      outs.push({
        cx: e.a.x + e.ux * tc + e.inX * (e.thickness / 2 + dsp.depth / 2),
        cy: e.a.y + e.uy * tc + e.inY * (e.thickness / 2 + dsp.depth / 2),
        w, d: dsp.depth,
        rot: (Math.atan2(e.uy, e.ux) * 180) / Math.PI,
      })
    }
  }
  return outs
}

// free intervals along an edge after removing door spans (+ margins)
// and, when avoidWindows, the window spans too
const freeIntervals = (edge, { avoidWindows = false } = {}) => {
  const blocked = [
    ...edge.doorSpans.map((s) => [s.t0 - EDGE_MARGIN, s.t1 + EDGE_MARGIN]),
    ...(avoidWindows ? edge.windowSpans.map((s) => [s.t0 - 50, s.t1 + 50]) : []),
  ].sort((x, y) => x[0] - y[0])
  const out = []
  let cur = EDGE_MARGIN
  for (const [b0, b1] of blocked) {
    if (b0 > cur) out.push([cur, Math.min(b0, edge.len - EDGE_MARGIN)])
    cur = Math.max(cur, b1)
  }
  if (cur < edge.len - EDGE_MARGIN) out.push([cur, edge.len - EDGE_MARGIN])
  return out.filter(([x0, x1]) => x1 - x0 > 200)
}

// ---------- placement context ----------------------------------
function makeCtx(room, walls, openings, existingFurniture = []) {
  const edges = analyzeRoomEdges(room, walls, openings)
  const keepOuts = doorKeepOuts(edges)
  const placed = existingFurniture
    .filter((f) => pointInPolygon(f.position, room.polygon))
    .map((f) => ({ cx: f.position.x, cy: f.position.y, w: f.dimensions.w, d: f.dimensions.d, rot: f.rotation }))
  return { room, edges, keepOuts, placed, result: [] }
}

const rectOf = (item, pos, rot) => ({ cx: pos.x, cy: pos.y, w: item.w, d: item.d, rot })
const insidePoly = (rect, poly) => rectCorners(rect).every((c) => pointInPolygon(c, poly))

function isValid(ctx, item, pos, rot, { skipFrontClear = false } = {}) {
  const rect = rectOf(item, pos, rot)
  if (!insidePoly(rect, ctx.room.polygon)) return false
  for (const ko of ctx.keepOuts) if (rotRectsOverlap(rect, ko)) return false
  for (const p of [...ctx.placed, ...ctx.result.map((r) => rectOf(FURNITURE_BY_TYPE[r.type] ? { w: r.dimensions.w, d: r.dimensions.d } : r, r.position, r.rotation))]) {
    if (rotRectsOverlap(rect, p)) return false
  }
  if (!skipFrontClear) {
    // front = local −d direction; keep a walkway there
    const r = (rot * Math.PI) / 180
    const fx = Math.sin(r) // R(rot)·(0,−1) = (sin, −cos)
    const fy = -Math.cos(r)
    const front = {
      cx: pos.x + fx * (item.d / 2 + FRONT_CLEAR / 2),
      cy: pos.y + fy * (item.d / 2 + FRONT_CLEAR / 2),
      w: Math.min(item.w, 800), d: FRONT_CLEAR, rot,
    }
    if (!insidePoly(front, ctx.room.polygon)) return false
    for (const p of ctx.result.map((x) => rectOf({ w: x.dimensions.w, d: x.dimensions.d }, x.position, x.rotation))) {
      if (rotRectsOverlap(front, p)) return false
    }
  }
  return true
}

const commit = (ctx, type, pos, rot) => {
  const lib = FURNITURE_BY_TYPE[type]
  ctx.result.push({
    type,
    position: { x: Math.round(pos.x), y: Math.round(pos.y) },
    rotation: ((Math.round(rot) % 360) + 360) % 360,
    dimensions: { w: lib.w, d: lib.d, h: lib.h },
  })
  return ctx.result[ctx.result.length - 1]
}

// back the item onto the edge's inner wall face at parameter t
const edgePose = (edge, item, t) => ({
  pos: {
    x: edge.a.x + edge.ux * t + edge.inX * (edge.thickness / 2 + item.d / 2),
    y: edge.a.y + edge.uy * t + edge.inY * (edge.thickness / 2 + item.d / 2),
  },
  rot: (Math.atan2(edge.inX, -edge.inY) * 180) / Math.PI,
})

// Place an item against a wall. `score(edge, interval)` ranks the
// options; within an interval we try center first, then the ends.
function placeOnWall(ctx, type, { score, avoidWindows, skipFrontClear } = {}) {
  const item = FURNITURE_BY_TYPE[type]
  const tall = item.h >= TALL_MM
  const candidates = []
  for (const edge of ctx.edges) {
    for (const [i0, i1] of freeIntervals(edge, { avoidWindows: avoidWindows ?? tall })) {
      if (i1 - i0 < item.w) continue
      const sc = score ? score(edge, [i0, i1]) : i1 - i0
      candidates.push({ edge, i0, i1, sc })
    }
  }
  candidates.sort((x, y) => y.sc - x.sc)
  for (const c of candidates) {
    const mid = (c.i0 + c.i1) / 2
    const ts = [mid, c.i0 + item.w / 2, c.i1 - item.w / 2]
    for (const t of ts) {
      if (t - item.w / 2 < c.i0 || t + item.w / 2 > c.i1) continue
      const { pos, rot } = edgePose(c.edge, item, t)
      if (isValid(ctx, item, pos, rot, { skipFrontClear })) {
        return { ...commit(ctx, type, pos, rot), edge: c.edge, t }
      }
    }
  }
  return null
}

// free-standing: coarse grid over the polygon, scored candidates
function placeFree(ctx, type, rot, { score, skipFrontClear } = {}) {
  const item = FURNITURE_BY_TYPE[type]
  const xs = ctx.room.polygon.map((p) => p.x)
  const ys = ctx.room.polygon.map((p) => p.y)
  const step = 250
  const candidates = []
  for (let x = Math.min(...xs) + 300; x <= Math.max(...xs) - 300; x += step) {
    for (let y = Math.min(...ys) + 300; y <= Math.max(...ys) - 300; y += step) {
      const pos = { x, y }
      if (!pointInPolygon(pos, ctx.room.polygon)) continue
      candidates.push({ pos, sc: score ? score(pos) : 0 })
    }
  }
  candidates.sort((a, b) => b.sc - a.sc)
  for (const c of candidates) {
    if (isValid(ctx, item, c.pos, rot, { skipFrontClear })) {
      return commit(ctx, type, c.pos, rot)
    }
  }
  return null
}

// distance from a point to the nearest door keep-out (for scoring)
const doorDist = (ctx, p) => {
  let best = Infinity
  for (const ko of ctx.keepOuts) best = Math.min(best, Math.hypot(p.x - ko.cx, p.y - ko.cy))
  return best
}

// ---------- room templates -------------------------------------
const TEMPLATES = {
  bedroom(ctx, areaM2) {
    const bedType = areaM2 >= 9.5 ? 'bed_double' : 'bed_single'
    // bed: farthest wall stretch from the door
    const bed = placeOnWall(ctx, bedType, {
      score: (e, [i0, i1]) =>
        doorDist(ctx, edgePose(e, FURNITURE_BY_TYPE[bedType], (i0 + i1) / 2).pos) + (i1 - i0) * 0.3,
    })
    if (bed) {
      // bedsides flank the bed on the same wall
      const lib = FURNITURE_BY_TYPE.bedside
      for (const side of [-1, 1]) {
        const t = bed.t + side * (FURNITURE_BY_TYPE[bedType].w / 2 + lib.w / 2 + 60)
        const { pos, rot } = edgePose(bed.edge, lib, t)
        if (t > 0 && t < bed.edge.len && isValid(ctx, lib, pos, rot, { skipFrontClear: true })) {
          commit(ctx, 'bedside', pos, rot)
        }
      }
    }
    placeOnWall(ctx, 'wardrobe') // tall → avoids windows automatically
    // desk prefers sitting under a window
    placeOnWall(ctx, 'desk', {
      avoidWindows: false,
      score: (e, [i0, i1]) => {
        const mid = (i0 + i1) / 2
        const nearWin = e.windowSpans.some((w) => mid > w.t0 - 800 && mid < w.t1 + 800)
        return (nearWin ? 10000 : 0) + (i1 - i0) * 0.2
      },
    })
  },

  living(ctx, areaM2) {
    const sofa = placeOnWall(ctx, 'sofa')
    if (sofa) {
      // TV opposite the sofa: prefer the edge whose inward normal
      // opposes the sofa's, near the sofa's sight line
      const sIn = { x: sofa.edge.inX, y: sofa.edge.inY }
      placeOnWall(ctx, 'tv_stand', {
        avoidWindows: true,
        score: (e, [i0, i1]) => {
          const facing = -(e.inX * sIn.x + e.inY * sIn.y) // 1 = opposite wall
          const mid = edgePose(e, FURNITURE_BY_TYPE.tv_stand, (i0 + i1) / 2).pos
          const lateral = -Math.abs((mid.x - sofa.position.x) * -sIn.y + (mid.y - sofa.position.y) * sIn.x)
          return facing * 100000 + lateral
        },
      })
      // coffee table on the sofa's sight line
      const ct = FURNITURE_BY_TYPE.coffee_table
      const cpos = {
        x: sofa.position.x + sIn.x * (FURNITURE_BY_TYPE.sofa.d / 2 + ct.d / 2 + 500),
        y: sofa.position.y + sIn.y * (FURNITURE_BY_TYPE.sofa.d / 2 + ct.d / 2 + 500),
      }
      if (isValid(ctx, ct, cpos, sofa.rotation, { skipFrontClear: true })) {
        commit(ctx, 'coffee_table', cpos, sofa.rotation)
      }
      placeOnWall(ctx, 'bookshelf')
    }
    if (areaM2 >= 20) TEMPLATES.dining(ctx, areaM2, { compact: true })
  },

  kitchen(ctx) {
    // counter run: tile 600 segments along the best edge from a corner
    const c = FURNITURE_BY_TYPE.counter
    let run = 0
    const edgesByLen = [...ctx.edges].sort((a, b) => b.len - a.len)
    for (const edge of edgesByLen) {
      const ivs = freeIntervals(edge)
      if (!ivs.length) continue
      const [i0, i1] = ivs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0]
      let t = i0 + c.w / 2
      while (t + c.w / 2 <= i1 && run < 6) {
        const { pos, rot } = edgePose(edge, c, t)
        if (!isValid(ctx, c, pos, rot, { skipFrontClear: true })) break
        commit(ctx, 'counter', pos, rot)
        run++
        t += c.w
      }
      if (run) break
    }
    placeOnWall(ctx, 'fridge') // tall → keeps clear of windows
    placeOnWall(ctx, 'sink', { skipFrontClear: true })
  },

  bathroom(ctx) {
    placeOnWall(ctx, 'toilet', { skipFrontClear: true })
    placeOnWall(ctx, 'sink', { skipFrontClear: true })
    if (!placeOnWall(ctx, 'bathtub', { skipFrontClear: true })) {
      placeOnWall(ctx, 'shower', { skipFrontClear: true })
    }
  },

  dining(ctx, areaM2, { compact = false } = {}) {
    const table = FURNITURE_BY_TYPE.dining_table
    const t = placeFree(ctx, 'dining_table', 0, {
      score: (p) => doorDist(ctx, p) + (compact ? -0 : 0),
      skipFrontClear: true,
    })
    if (!t) return
    const chair = FURNITURE_BY_TYPE.chair
    const gap = table.d / 2 + chair.d / 2 + 60
    const seats = [
      { dx: -table.w / 4, dy: -gap, rot: 0 },
      { dx: table.w / 4, dy: -gap, rot: 0 },
      { dx: -table.w / 4, dy: gap, rot: 180 },
      { dx: table.w / 4, dy: gap, rot: 180 },
    ]
    for (const s of seats) {
      const pos = { x: t.position.x + s.dx, y: t.position.y + s.dy }
      if (isValid(ctx, chair, pos, s.rot, { skipFrontClear: true })) commit(ctx, 'chair', pos, s.rot)
    }
  },

  office(ctx) {
    placeOnWall(ctx, 'desk', {
      avoidWindows: false,
      score: (e, [i0, i1]) => {
        const mid = (i0 + i1) / 2
        const nearWin = e.windowSpans.some((w) => mid > w.t0 - 800 && mid < w.t1 + 800)
        return (nearWin ? 10000 : 0) + (i1 - i0) * 0.2
      },
    })
    const desk = ctx.result.find((r) => r.type === 'desk')
    if (desk) {
      const r = (desk.rotation * Math.PI) / 180
      const chair = FURNITURE_BY_TYPE.chair
      const pos = {
        x: desk.position.x + Math.sin(r) * (FURNITURE_BY_TYPE.desk.d / 2 + chair.d / 2 + 80),
        y: desk.position.y - Math.cos(r) * (FURNITURE_BY_TYPE.desk.d / 2 + chair.d / 2 + 80),
      }
      if (isValid(ctx, chair, pos, (desk.rotation + 180) % 360, { skipFrontClear: true })) {
        commit(ctx, 'chair', pos, (desk.rotation + 180) % 360)
      }
    }
    placeOnWall(ctx, 'bookshelf')
    placeOnWall(ctx, 'armchair')
  },
}

export const FURNISH_KINDS = Object.keys(TEMPLATES)

// Main entry: returns furniture placements (schema-shaped, no ids).
export function furnishRoom({ room, walls, openings, existingFurniture = [], kind }) {
  if (!TEMPLATES[kind] || !room?.polygon || room.polygon.length < 3) return []
  const ctx = makeCtx(room, walls, openings, existingFurniture)
  TEMPLATES[kind](ctx, room.area || 0)
  return ctx.result
}
