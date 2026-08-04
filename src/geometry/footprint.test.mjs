// Tests for footprint extraction + dimension lines.
import { extractFootprints, footprintDimensions, signedAreaMm2, healPlanWalls, detectRooms } from './geo.js'

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`)
  if (!cond) failures++
}
let n = 0
const makeWall = ({ start, end, thickness = 150, height = 2400 }) =>
  ({ id: `fw${n++}`, start, end, thickness, height })
const W = (id, x1, y1, x2, y2) => ({
  id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 150, height: 2400,
})

// --- 1. two-room building → ONE footprint = outer rectangle -----
{
  const walls = [
    W('a', 0, 0, 4000, 0), W('b', 4000, 0, 8000, 0),
    W('c', 8000, 0, 8000, 3000), W('d', 8000, 3000, 4000, 3000),
    W('e', 4000, 3000, 0, 3000), W('f', 0, 3000, 0, 0),
    W('mid', 4000, 0, 4000, 3000),
  ]
  const fps = extractFootprints(walls)
  check('two-room building: 1 footprint', fps.length === 1, `got ${fps.length}`)
  check('footprint area = 24 m² (outer, ignores divider)',
    Math.abs(signedAreaMm2(fps[0]) / 1e6 - 24) < 0.01, signedAreaMm2(fps[0]) / 1e6)
  check('footprint positively oriented', signedAreaMm2(fps[0]) > 0)
}

// --- 2. two disjoint buildings → two footprints ------------------
{
  const walls = [
    W('a1', 0, 0, 3000, 0), W('a2', 3000, 0, 3000, 2000),
    W('a3', 3000, 2000, 0, 2000), W('a4', 0, 2000, 0, 0),
    W('b1', 10000, 0, 14000, 0), W('b2', 14000, 0, 14000, 3000),
    W('b3', 14000, 3000, 10000, 3000), W('b4', 10000, 3000, 10000, 0),
  ]
  check('disjoint: 2 footprints', extractFootprints(walls).length === 2)
}

// --- 3. L-shaped building (built the app's way, via heal) --------
{
  let res = { walls: [
    W('l1', 0, 0, 6000, 0), W('l2', 6000, 0, 6000, 3000),
    W('l3', 6000, 3000, 0, 3000), W('l4', 0, 3000, 0, 0),
  ], openings: [] }
  // annex on top-left sharing part of the top wall
  for (const w of [
    { start: { x: 0, y: -2000 }, end: { x: 3000, y: -2000 } },
    { start: { x: 3000, y: -2000 }, end: { x: 3000, y: 0 } },
    { start: { x: 3000, y: 0 }, end: { x: 0, y: 0 } },
    { start: { x: 0, y: 0 }, end: { x: 0, y: -2000 } },
  ]) res = healPlanWalls([...res.walls, makeWall(w)], res.openings, makeWall)
  const rooms = detectRooms(res.walls)
  const fps = extractFootprints(res.walls)
  check('L-shape: 2 rooms', rooms.length === 2, `got ${rooms.length}`)
  check('L-shape: 1 footprint', fps.length === 1, `got ${fps.length}`)
  check('L-shape: footprint area 24 m² (18 + 6)',
    Math.abs(signedAreaMm2(fps[0]) / 1e6 - 24) < 0.01, signedAreaMm2(fps[0]) / 1e6)
  check('L-shape: footprint has 6 corners',
    fps[0].length === 6, `got ${fps[0].length}`)
}

// --- 4. dimension lines: rectangle → 4 dims, normals point OUT ---
{
  const walls = [
    W('a', 0, 0, 4000, 0), W('b', 4000, 0, 4000, 3000),
    W('c', 4000, 3000, 0, 3000), W('d', 0, 3000, 0, 0),
  ]
  const fp = extractFootprints(walls)[0]
  const dims = footprintDimensions(fp)
  check('rectangle: 4 dimension lines', dims.length === 4, `got ${dims.length}`)
  check('lengths are 4000/3000 pairs',
    dims.filter((d) => Math.abs(d.len - 4000) < 1).length === 2 &&
    dims.filter((d) => Math.abs(d.len - 3000) < 1).length === 2)
  // every offset line must sit OUTSIDE the rectangle
  const outside = dims.every((d) =>
    d.pa.x < -1 || d.pa.x > 4001 || d.pa.y < -1 || d.pa.y > 3001)
  check('all dimension lines offset outside the building', outside,
    JSON.stringify(dims.map((d) => d.pa)))
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
