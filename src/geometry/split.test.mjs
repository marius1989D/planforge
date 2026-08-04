// Tests for junction splitting + editing helpers. Run: node src/geometry/split.test.mjs
import { splitPlanWalls, detectRooms, segmentIntersection, pointToSegmentDist, pointInPolygon } from './geo.js'

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`)
  if (!cond) failures++
}
let n = 0
const makeWall = ({ start, end, thickness = 150, height = 2400 }) =>
  ({ id: `nw${n++}`, start, end, thickness, height })
const W = (id, x1, y1, x2, y2) => ({
  id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 150, height: 2400,
})

// --- 1. dividing wall across a room → T-junctions both ends → 2 rooms
{
  const room = [
    W('s', 0, 0, 4000, 0), W('e', 4000, 0, 4000, 3000),
    W('n', 4000, 3000, 0, 3000), W('w', 0, 3000, 0, 0),
  ]
  const res = splitPlanWalls(room, [], {
    start: { x: 2000, y: 0 }, end: { x: 2000, y: 3000 }, thickness: 100, height: 2400,
  }, makeWall)
  // south + north each split into 2, east/west untouched, +1 new wall = 7
  check('divider: 7 walls', res.walls.length === 7, `got ${res.walls.length}`)
  const rooms = detectRooms(res.walls)
  check('divider: 2 rooms detected', rooms.length === 2, `got ${rooms.length}`)
  check('divider: both 6 m²', rooms.every((r) => Math.abs(r.area - 6) < 0.01),
    rooms.map((r) => r.area).join(','))
}

// --- 2. X crossing: both walls split, new wall split → 4 pieces total
{
  const res = splitPlanWalls(
    [W('h', 0, 1000, 4000, 1000)], [],
    { start: { x: 2000, y: 0 }, end: { x: 2000, y: 2000 }, thickness: 150, height: 2400 },
    makeWall,
  )
  check('crossing: 4 walls', res.walls.length === 4, `got ${res.walls.length}`)
  check('crossing: new wall in 2 pieces', res.newWallIds.length === 2, `got ${res.newWallIds.length}`)
}

// --- 3. opening reassignment on split
{
  const wall = W('big', 0, 0, 6000, 0)
  const door = { id: 'd1', wallId: 'big', type: 'door', offset: 4000, width: 900, height: 2100, sillHeight: 0 }
  const near = { id: 'd2', wallId: 'big', type: 'window', offset: 500, width: 1200, height: 1200, sillHeight: 900 }
  const res = splitPlanWalls([wall], [door, near], {
    start: { x: 2000, y: -1000 }, end: { x: 2000, y: 1000 }, thickness: 150, height: 2400,
  }, makeWall)
  const moved = res.openings.find((o) => o.id === 'd1')
  const stayed = res.openings.find((o) => o.id === 'd2')
  check('opening past split: moved with offset 2000', moved && moved.wallId !== 'big' && moved.offset === 2000,
    JSON.stringify(moved))
  check('opening before split: unchanged', stayed && stayed.wallId === 'big' && stayed.offset === 500)
}

// --- 4. opening straddling the junction is dropped
{
  const wall = W('big', 0, 0, 6000, 0)
  const door = { id: 'd1', wallId: 'big', type: 'door', offset: 1700, width: 900, height: 2100, sillHeight: 0 }
  const res = splitPlanWalls([wall], [door], {
    start: { x: 2000, y: -1000 }, end: { x: 2000, y: 1000 }, thickness: 150, height: 2400,
  }, makeWall)
  check('straddling opening dropped', res.openings.length === 0, `got ${res.openings.length}`)
}

// --- 5. wall drawn with no junctions passes through untouched
{
  const res = splitPlanWalls(
    [W('a', 0, 0, 4000, 0)], [],
    { start: { x: 0, y: 2000 }, end: { x: 4000, y: 2000 }, thickness: 150, height: 2400 },
    makeWall,
  )
  check('no junction: 2 walls, 1 new', res.walls.length === 2 && res.newWallIds.length === 1)
}

// --- 6. endpoint-on-endpoint (corner join) does NOT split anything
{
  const res = splitPlanWalls(
    [W('a', 0, 0, 4000, 0)], [],
    { start: { x: 4000, y: 0 }, end: { x: 4000, y: 3000 }, thickness: 150, height: 2400 },
    makeWall,
  )
  check('corner join: no splits', res.walls.length === 2 && res.newWallIds.length === 1,
    `walls ${res.walls.length}`)
}

// --- 7. primitive sanity
{
  const hit = segmentIntersection({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })
  check('segmentIntersection midpoint', hit && Math.abs(hit.point.x - 5) < 1e-6 && Math.abs(hit.point.y - 5) < 1e-6)
  check('pointToSegmentDist', Math.abs(pointToSegmentDist({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }) - 3) < 1e-9)
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
  check('pointInPolygon in/out', pointInPolygon({ x: 5, y: 5 }, sq) && !pointInPolygon({ x: 15, y: 5 }, sq))
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`)

// --- 8. classifyRoomNodes: standalone room → all nodes free ----
{
  const { classifyRoomNodes, detectRooms } = await import('./geo.js')
  const walls = [
    W('s', 0, 0, 4000, 0), W('e', 4000, 0, 4000, 3000),
    W('n', 4000, 3000, 0, 3000), W('w', 0, 3000, 0, 0),
  ]
  const room = detectRooms(walls)[0]
  const nodes = classifyRoomNodes(room, walls)
  check('standalone room: 4 nodes, all free', nodes.length === 4 && nodes.every((n) => n.free),
    JSON.stringify(nodes))
}

// --- 9. classifyRoomNodes: shared dividing wall → shared corners pinned
{
  const { classifyRoomNodes, detectRooms } = await import('./geo.js')
  const walls = [
    W('a', 0, 0, 4000, 0), W('b', 4000, 0, 8000, 0),
    W('c', 8000, 0, 8000, 3000), W('d', 8000, 3000, 4000, 3000),
    W('e', 4000, 3000, 0, 3000), W('f', 0, 3000, 0, 0),
    W('mid', 4000, 0, 4000, 3000),
  ]
  const rooms = detectRooms(walls)
  const left = rooms.find((r) => r.wallIds.includes('f'))
  const nodes = classifyRoomNodes(left, walls)
  const pinned = nodes.filter((n) => !n.free)
  const free = nodes.filter((n) => n.free)
  // left room corners: (0,0) (4000,0) (4000,3000) (0,3000)
  // (4000,0) and (4000,3000) are shared with 'b'/'d' → pinned
  // (0,0) and (0,3000) touch nothing outside → free
  check('shared room: 2 pinned, 2 free', pinned.length === 2 && free.length === 2,
    `pinned ${pinned.length} free ${free.length}`)
  check('pinned nodes are the shared-wall corners',
    pinned.every((n) => n.point.x === 4000), JSON.stringify(pinned))
}

console.log(failures === 0 ? '\nALL TESTS PASSED (incl. followup)' : `\n${failures} FAILURE(S) TOTAL`)
process.exit(failures === 0 ? 0 : 1)
