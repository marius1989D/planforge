// Sanity tests for the geometry core. Run: node src/geometry/geo.test.mjs
import { detectRooms, wallSegments } from './geo.js'

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`)
  if (!cond) failures++
}
const W = (id, x1, y1, x2, y2) => ({
  id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 150, height: 2400,
})

// --- 1. single 4×3m rectangle → exactly one 12 m² room -------
{
  const rooms = detectRooms([
    W('w1', 0, 0, 4000, 0), W('w2', 4000, 0, 4000, 3000),
    W('w3', 4000, 3000, 0, 3000), W('w4', 0, 3000, 0, 0),
  ])
  check('rectangle: 1 room', rooms.length === 1, `got ${rooms.length}`)
  check('rectangle: 12 m²', rooms.length === 1 && Math.abs(rooms[0].area - 12) < 0.01, `got ${rooms[0]?.area}`)
  check('rectangle: 4 walls in loop', rooms[0]?.wallIds.length === 4)
}

// --- 2. 8×3m split by middle wall → two 12 m² rooms ----------
{
  const rooms = detectRooms([
    W('a', 0, 0, 4000, 0), W('b', 4000, 0, 8000, 0),
    W('c', 8000, 0, 8000, 3000), W('d', 8000, 3000, 4000, 3000),
    W('e', 4000, 3000, 0, 3000), W('f', 0, 3000, 0, 0),
    W('mid', 4000, 0, 4000, 3000),
  ])
  check('split: 2 rooms', rooms.length === 2, `got ${rooms.length}`)
  check('split: both 12 m²', rooms.every((r) => Math.abs(r.area - 12) < 0.01),
    rooms.map((r) => r.area).join(','))
  check('split: shared wall in both', rooms.every((r) => r.wallIds.includes('mid')))
}

// --- 3. two disjoint rectangles (multi-component) ------------
{
  const rooms = detectRooms([
    W('a1', 0, 0, 3000, 0), W('a2', 3000, 0, 3000, 2000),
    W('a3', 3000, 2000, 0, 2000), W('a4', 0, 2000, 0, 0),
    W('b1', 10000, 0, 14000, 0), W('b2', 14000, 0, 14000, 3000),
    W('b3', 14000, 3000, 10000, 3000), W('b4', 10000, 3000, 10000, 0),
  ])
  check('disjoint: 2 rooms', rooms.length === 2, `got ${rooms.length}`)
  const areas = rooms.map((r) => r.area).sort((x, y) => x - y)
  check('disjoint: 6 and 12 m²', Math.abs(areas[0] - 6) < 0.01 && Math.abs(areas[1] - 12) < 0.01,
    areas.join(','))
}

// --- 4. dead-end wall poking into a room doesn't break it ----
{
  const rooms = detectRooms([
    W('w1', 0, 0, 4000, 0), W('w2', 4000, 0, 4000, 3000),
    W('w3', 4000, 3000, 0, 3000), W('w4', 0, 3000, 0, 0),
    W('stub', 0, 1500, 1000, 1500), // dangling partition
  ])
  check('dead-end: still 1 room', rooms.length === 1, `got ${rooms.length}`)
  check('dead-end: area still ~12 m²', Math.abs(rooms[0]?.area - 12) < 0.01, `got ${rooms[0]?.area}`)
}

// --- 5. open shape (3 walls, no loop) → no rooms --------------
{
  const rooms = detectRooms([
    W('w1', 0, 0, 4000, 0), W('w2', 4000, 0, 4000, 3000), W('w3', 4000, 3000, 0, 3000),
  ])
  check('open shape: 0 rooms', rooms.length === 0, `got ${rooms.length}`)
}

// --- 6. deterministic ids survive unrelated edits -------------
{
  const base = [
    W('w1', 0, 0, 4000, 0), W('w2', 4000, 0, 4000, 3000),
    W('w3', 4000, 3000, 0, 3000), W('w4', 0, 3000, 0, 0),
  ]
  const id1 = detectRooms(base)[0].id
  const id2 = detectRooms([...base, W('stub', 20000, 0, 24000, 0)])[0].id
  check('stable room id across unrelated edits', id1 === id2, `${id1} vs ${id2}`)
}

// --- 7. wallSegments: door + window decomposition -------------
{
  const wall = W('w', 0, 0, 5000, 0)
  const segs = wallSegments(wall, [
    { id: 'd', wallId: 'w', type: 'door', offset: 1000, width: 900, height: 2100, sillHeight: 0 },
    { id: 'n', wallId: 'w', type: 'window', offset: 3000, width: 1200, height: 1200, sillHeight: 900 },
  ])
  // expected: [0,1000] full · [1000,1900] lintel · [1900,3000] full
  //           [3000,4200] sill + [3000,4200] lintel · [4200,5000] full
  check('segments: count 6', segs.length === 6, JSON.stringify(segs))
  const lintelDoor = segs.find((s) => s.from === 1000 && s.y0 === 2100)
  check('segments: door lintel 2100→2400', lintelDoor && lintelDoor.y1 === 2400)
  const sill = segs.find((s) => s.from === 3000 && s.y0 === 0)
  check('segments: window sill 0→900', sill && sill.y1 === 900)
  const lintelWin = segs.find((s) => s.from === 3000 && s.y0 === 2100)
  check('segments: window lintel 2100→2400', lintelWin && lintelWin.y1 === 2400)
  // conservation: solid area + opening areas = wall face area
  const solid = segs.reduce((s, x) => s + (x.to - x.from) * (x.y1 - x.y0), 0)
  const total = 5000 * 2400
  const holes = 900 * 2100 + 1200 * 1200
  check('segments: area conservation', solid === total - holes, `${solid} vs ${total - holes}`)
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
