// Tests for healPlanWalls. Run: node src/geometry/heal.test.mjs
import { healPlanWalls, detectRooms, wallLength } from './geo.js'

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`)
  if (!cond) failures++
}
let n = 0
const makeWall = ({ start, end, thickness = 150, height = 2400 }) =>
  ({ id: `hw${n++}`, start, end, thickness, height })
const W = (id, x1, y1, x2, y2) => ({
  id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 150, height: 2400,
})

// --- 1. collinear partial overlap → 3 segments, no duplicates --
{
  const res = healPlanWalls(
    [W('a', 0, 0, 6000, 0), W('b', 2000, 0, 8000, 0)], [], makeWall,
  )
  check('collinear overlap: 3 walls', res.walls.length === 3,
    JSON.stringify(res.walls.map((w) => [w.start.x, w.end.x])))
  const spans = res.walls
    .map((w) => [Math.min(w.start.x, w.end.x), Math.max(w.start.x, w.end.x)])
    .sort((p, q) => p[0] - q[0])
  check('collinear overlap: spans 0-2000, 2000-6000, 6000-8000',
    JSON.stringify(spans) === JSON.stringify([[0, 2000], [2000, 6000], [6000, 8000]]),
    JSON.stringify(spans))
}

// --- 2. THE BUG: room drawn/joined along another room's wall ----
// Exact screenshot scenario: big room 6300×4000, small 4000×1400 room
// sitting on its top wall, sharing a collinear stretch.
{
  const big = [
    W('bt', 0, 0, 6300, 0), W('br', 6300, 0, 6300, 4000),
    W('bb', 6300, 4000, 0, 4000), W('bl', 0, 4000, 0, 0),
  ]
  const small = [
    W('st', 1000, -1400, 5000, -1400), W('sr', 5000, -1400, 5000, 0),
    W('sb', 5000, 0, 1000, 0), // collinear ON the big room's top wall
    W('sl', 1000, 0, 1000, -1400),
  ]
  const res = healPlanWalls([...big, ...small], [], makeWall)
  const rooms = detectRooms(res.walls)
  check('joined rooms: 2 rooms detected', rooms.length === 2, `got ${rooms.length}`)
  const areas = rooms.map((r) => r.area).sort((a, b) => a - b)
  check('joined rooms: 5.6 and 25.2 m²',
    Math.abs(areas[0] - 5.6) < 0.01 && Math.abs(areas[1] - 25.2) < 0.01,
    areas.join(','))
}

// --- 3. exact duplicate wall dedupe, reversed, with opening -----
{
  const res = healPlanWalls(
    [W('k', 0, 0, 4000, 0), W('d', 4000, 0, 0, 0)],
    [{ id: 'o1', wallId: 'd', type: 'door', offset: 500, width: 900, height: 2100, sillHeight: 0 }],
    makeWall,
  )
  check('duplicate: 1 wall kept', res.walls.length === 1, `got ${res.walls.length}`)
  const o = res.openings[0]
  // reversed: offset' = 4000 - 500 - 900 = 2600, remapped to kept wall 'k'
  check('duplicate: opening remapped + offset flipped',
    o.wallId === 'k' && o.offset === 2600, JSON.stringify(o))
}

// --- 4. drag-created T-junction (no crossing, endpoint on wall) --
{
  const res = healPlanWalls(
    [W('a', 0, 0, 4000, 0), W('b', 2000, 0, 2000, 3000)], [], makeWall,
  )
  check('T-junction: wall a split into 2 (3 total)', res.walls.length === 3,
    `got ${res.walls.length}`)
}

// --- 5. healing is idempotent (second run changes nothing) -------
{
  const first = healPlanWalls(
    [W('a', 0, 0, 6000, 0), W('b', 2000, 0, 8000, 0), W('c', 3000, -1000, 3000, 1000)],
    [], makeWall,
  )
  const second = healPlanWalls(first.walls, first.openings, makeWall)
  check('idempotent: same wall count', first.walls.length === second.walls.length,
    `${first.walls.length} vs ${second.walls.length}`)
}

// --- 6. openings preserved through a heal-split ------------------
{
  const res = healPlanWalls(
    [W('long', 0, 0, 6000, 0), W('t', 4000, 0, 4000, 2000)],
    [{ id: 'o1', wallId: 'long', type: 'window', offset: 1000, width: 1200, height: 1200, sillHeight: 900 }],
    makeWall,
  )
  const o = res.openings[0]
  check('opening before junction stays on original wall',
    o && o.wallId === 'long' && o.offset === 1000, JSON.stringify(o))
  check('long wall split into 2 (3 total)', res.walls.length === 3)
}

// --- 7. total length conserved through collinear healing ----------
{
  const input = [W('a', 0, 0, 6000, 0), W('b', 2000, 0, 8000, 0)]
  const res = healPlanWalls(input, [], makeWall)
  const total = res.walls.reduce((s, w) => s + wallLength(w), 0)
  check('length conservation: 8000mm covered once', Math.abs(total - 8000) < 1,
    `got ${total}`)
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
