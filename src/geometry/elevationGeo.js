// ============================================================
// PlanForge — elevation (facade) geometry, pure + testable
// ------------------------------------------------------------
// Orthographic projections of the building from the four
// cardinal directions (plan top = North). For each view:
//   • wall bands per floor: union of the floor footprint's
//     u-intervals (handles setbacks & disjoint buildings)
//   • openings on VISIBLE exterior walls at true heights
//     (doors from the floor line, windows from their sill)
//   • roof profile: flat slab, or the pitched hip profile
//     sampled from the distance-function surface
// u = the viewer's RIGHT (mm); v = height above ground (mm).
// Known simplification: no hidden-surface removal between
// building wings — fine for typical homes, documented.
// ============================================================
import {
  extractFootprints, pointInPolygon, pointToSegmentDist,
  pointAlongWall, dist,
} from './geo.js'
import { floorHeightMm } from './walkGeo.js'

// towardViewer + the viewer's-right axis, in plan coords (y-down,
// north = −y). Facing the building: right(south)=+x, right(north)=−x,
// right(east, looking west)=north=−y, right(west, looking east)=+y.
const VIEWS = {
  south: { toward: { x: 0, y: 1 }, u: { x: 1, y: 0 } },
  north: { toward: { x: 0, y: -1 }, u: { x: -1, y: 0 } },
  east: { toward: { x: 1, y: 0 }, u: { x: 0, y: -1 } },
  west: { toward: { x: -1, y: 0 }, u: { x: 0, y: 1 } },
}
export const ELEVATION_DIRS = Object.keys(VIEWS)

const uOf = (view, p) => p.x * view.u.x + p.y * view.u.y

// merge overlapping [u0,u1] intervals
const mergeIntervals = (list) => {
  const s = [...list].sort((a, b) => a[0] - b[0])
  const out = []
  for (const iv of s) {
    if (out.length && iv[0] <= out[out.length - 1][1] + 1) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], iv[1])
    } else out.push([...iv])
  }
  return out
}

// outward side of a wall = the side NOT inside the footprint
const outwardNormal = (wall, footprint) => {
  const len = dist(wall.start, wall.end) || 1
  const nx = (wall.end.y - wall.start.y) / len
  const ny = -(wall.end.x - wall.start.x) / len
  const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 }
  const probe = { x: mid.x + nx * (wall.thickness / 2 + 40), y: mid.y + ny * (wall.thickness / 2 + 40) }
  return pointInPolygon(probe, footprint) ? { x: -nx, y: -ny } : { x: nx, y: ny }
}

export function buildElevation(plan, dir) {
  const view = VIEWS[dir]
  if (!view) return null
  const floors = []
  const openings = []
  let uMin = Infinity
  let uMax = -Infinity
  let elev = 0 // mm

  plan.floors.forEach((floor) => {
    const h = floorHeightMm(floor)
    const fps = extractFootprints(floor.walls)
    const intervals = mergeIntervals(
      fps.map((fp) => {
        const us = fp.map((p) => uOf(view, p))
        return [Math.min(...us), Math.max(...us)]
      }),
    )
    for (const [a, b] of intervals) {
      uMin = Math.min(uMin, a)
      uMax = Math.max(uMax, b)
    }
    floors.push({ intervals, v0: elev, v1: elev + h })

    // openings on visible exterior walls of THIS floor
    for (const fp of fps) {
      for (const wall of floor.walls) {
        const mid = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 }
        const onBoundary = fp.some((p, i) =>
          pointToSegmentDist(mid, p, fp[(i + 1) % fp.length]) < 20)
        if (!onBoundary) continue
        const out = outwardNormal(wall, fp)
        if (out.x * view.toward.x + out.y * view.toward.y < 0.3) continue
        const len = dist(wall.start, wall.end) || 1
        const wu = { x: (wall.end.x - wall.start.x) / len, y: (wall.end.y - wall.start.y) / len }
        if (Math.abs(wu.x * view.u.x + wu.y * view.u.y) < 0.6) continue // edge-on
        for (const o of floor.openings.filter((x) => x.wallId === wall.id)) {
          const p0 = pointAlongWall(wall, o.offset)
          const p1 = pointAlongWall(wall, o.offset + o.width)
          const u0 = Math.min(uOf(view, p0), uOf(view, p1))
          const u1 = Math.max(uOf(view, p0), uOf(view, p1))
          const base = o.type === 'window' ? elev + (o.sillHeight || 0) : elev
          openings.push({ u0, u1, v0: base, v1: base + o.height, type: o.type })
        }
      }
    }
    elev += h
  })

  // roof profile over the TOP floor footprint
  let roof = null
  const top = plan.floors[plan.floors.length - 1]
  const topFps = extractFootprints(top.walls)
  if (plan.roof === 'flat' && topFps.length) {
    const intervals = mergeIntervals(topFps.map((fp) => {
      const us = fp.map((p) => uOf(view, p))
      return [Math.min(...us), Math.max(...us)]
    }))
    roof = { kind: 'flat', v0: elev, v1: elev + 200, intervals }
  }
  if (plan.roof === 'pitched' && topFps.length) {
    const pitch = ((plan.roofPitch || 30) * Math.PI) / 180
    const tan = Math.tan(pitch)
    const BIN = 100 // mm
    const bins = new Map()
    for (const fp of topFps) {
      const xs = fp.map((p) => p.x)
      const ys = fp.map((p) => p.y)
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += BIN) {
        for (let y = Math.min(...ys); y <= Math.max(...ys); y += BIN) {
          const p = { x, y }
          if (!pointInPolygon(p, fp)) continue
          let d = Infinity
          for (let i = 0; i < fp.length; i++) {
            d = Math.min(d, pointToSegmentDist(p, fp[i], fp[(i + 1) % fp.length]))
          }
          const u = Math.round(uOf(view, p) / BIN) * BIN
          const h = d * tan
          if (!bins.has(u) || bins.get(u) < h) bins.set(u, h)
        }
      }
    }
    const profile = [...bins.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([u, h]) => [u, elev + h])
    // pin the ends to the eaves
    if (profile.length) {
      profile.unshift([uMin, elev])
      profile.push([uMax, elev])
    }
    roof = { kind: 'pitched', v0: elev, profile }
  }

  const height = roof
    ? (roof.kind === 'flat' ? roof.v1 : Math.max(elev, ...roof.profile.map((p) => p[1])))
    : elev
  return { dir, uMin, uMax, height, floors, openings, roof }
}
