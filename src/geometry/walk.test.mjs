// First-person walkthrough geometry tests. Run: node src/geometry/walk.test.mjs
import {
  computeElevationsM, stairHeightAtM, supportHeightAtM,
  resolveCollisionMm, startPoseMm, stairStepCount,
} from './walkGeo.js'
import { createPlan, createFloor, createWall, createOpening, createStair } from '../model/schema.js'
import { detectRooms, pointInPolygon } from './geo.js'

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`)
  if (!cond) failures++
}
const W = (x1, y1, x2, y2) => createWall({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 300 })

// ---- build a two-storey test house: 8×5m shell on both floors,
//      door on the south wall, stair along the east side --------------
const plan = createPlan({ name: 'walk test' })
const g = plan.floors[0]
g.walls = [W(0, 0, 8000, 0), W(8000, 0, 8000, 5000), W(8000, 5000, 0, 5000), W(0, 5000, 0, 0)]
// swingSide -1 = into the room for the south wall (what auto-detect computes)
g.openings = [createOpening({ wallId: g.walls[0].id, type: 'door', offset: 1000, swingSide: -1 }),
              createOpening({ wallId: g.walls[1].id, type: 'window', offset: 1500, width: 1200 })]
// stair: center (7000, 2500), rotation 0 → UP arrow toward -y (north)
g.stairs = [createStair({ position: { x: 7000, y: 2500 }, rotation: 0, width: 1000, length: 2800 })]
g.rooms = detectRooms(g.walls)
const up = createFloor({ name: 'First Floor', level: 1 })
up.walls = [W(0, 0, 8000, 0), W(8000, 0, 8000, 5000), W(8000, 5000, 0, 5000), W(0, 5000, 0, 0)]
up.rooms = detectRooms(up.walls)
plan.floors.push(up)

const elev = computeElevationsM(plan)
check('elevations: [0, 2.4], total 4.8',
  elev.starts[0] === 0 && Math.abs(elev.starts[1] - 2.4) < 1e-9 && Math.abs(elev.total - 4.8) < 1e-9,
  JSON.stringify(elev))

// ---- stair height field ------------------------------------------
const st = g.stairs[0]
const rise = 2.4
const n = stairStepCount(rise)
check('step count: ceil(2400/180) = 14', n === 14, n)
const hBottom = stairHeightAtM(st, { x: 7000, y: 2500 + 1400 - 50 }, rise) // bottom end (local +y)
const hTop = stairHeightAtM(st, { x: 7000, y: 2500 - 1400 + 50 }, rise)   // top end (arrow, -y)
check('bottom step is the lowest (1/14 of rise)', Math.abs(hBottom - rise / n) < 1e-9, hBottom)
check('top step reaches the full rise', Math.abs(hTop - rise) < 1e-9, hTop)
const hMid = stairHeightAtM(st, { x: 7000, y: 2500 }, rise)
check('midway ≈ half the rise', hMid > rise * 0.4 && hMid < rise * 0.6, hMid)
check('off the stair → null', stairHeightAtM(st, { x: 3000, y: 2500 }, rise) === null)
// heights ascend monotonically toward the arrow
let mono = true
let prev = -1
for (let y = 3850; y >= 1150; y -= 100) {
  const h = stairHeightAtM(st, { x: 7000, y }, rise)
  if (h < prev - 1e-9) mono = false
  prev = h
}
check('heights ascend toward the UP arrow', mono)

// ---- support: climbing the stair hands you to the upper floor -----
let sup = supportHeightAtM(plan, { x: 4000, y: 2500 }, 0, elev)
check('standing mid-room: ground support, floor 0', sup.feetM === 0 && sup.floorIdx === 0)
sup = supportHeightAtM(plan, { x: 4000, y: 2500 }, 0.0, elev)
check('cannot climb 2.4m to the slab directly', sup.feetM === 0)
// walk up the stair: feed each step's height back in
let feet = 0
for (let y = 3850; y >= 1150; y -= 50) {
  sup = supportHeightAtM(plan, { x: 7000, y }, feet, elev)
  feet = sup.feetM
}
check('climbed the whole stair', Math.abs(feet - 2.4) < 1e-9, feet)
// step off the top onto the upper floor
sup = supportHeightAtM(plan, { x: 6000, y: 1500 }, feet, elev)
check('stepping off the top lands on the upper slab, floor 1',
  Math.abs(sup.feetM - 2.4) < 1e-9 && sup.floorIdx === 1, JSON.stringify(sup))
// walking around upstairs stays upstairs
sup = supportHeightAtM(plan, { x: 2000, y: 2500 }, 2.4, elev)
check('upstairs stays upstairs', sup.feetM === 2.4 && sup.floorIdx === 1)

// ---- collision: walls block, doors pass --------------------------
const r = 250
// approach the south wall (y=0) mid-span, no door there (door at 1000-1900)
let q = resolveCollisionMm(g.walls, g.openings, { x: 5000, y: 200 }, r)
check('wall blocks: pushed to clearance (400mm)', Math.abs(q.y - 400) < 1 && q.x === 5000, JSON.stringify(q))
// through the door span (t = 1450 within 1080..1820)
q = resolveCollisionMm(g.walls, g.openings, { x: 1450, y: 100 }, r)
check('door passes through untouched', q.x === 1450 && q.y === 100, JSON.stringify(q))
// window is NOT pass-through (east wall t=2100 within window 1500-2700)
q = resolveCollisionMm(g.walls, g.openings, { x: 7900, y: 2100 }, r)
check('window still blocks', Math.abs(q.x - 7600) < 1, JSON.stringify(q))
// far from any wall: untouched
q = resolveCollisionMm(g.walls, g.openings, { x: 4000, y: 2500 }, r)
check('open space untouched', q.x === 4000 && q.y === 2500)

// ---- spawn pose ---------------------------------------------------
const pose = startPoseMm(plan)
check('spawn is inside the ground room', pointInPolygon({ x: pose.x, y: pose.y }, g.rooms[0].polygon),
  JSON.stringify(pose))
check('spawn faces into the room (swing side)', pose.dirY > 0.9, JSON.stringify(pose))
const bare = createPlan({ name: 'bare' })
const bp = startPoseMm(bare)
check('bare plan spawns at origin', bp.x === 0 && bp.y === 0)

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
