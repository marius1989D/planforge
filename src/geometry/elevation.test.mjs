// Elevation (facade) geometry tests. Run: node src/geometry/elevation.test.mjs
import { buildElevation, ELEVATION_DIRS } from './elevationGeo.js'
import { createPlan, createFloor, createWall, createOpening } from '../model/schema.js'

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`)
  if (!cond) failures++
}
const near = (a, b, tol = 1) => Math.abs(a - b) < tol
const mk = (f, x1, y1, x2, y2) => {
  const w = createWall({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 300 })
  f.walls.push(w)
  return w
}

// ---- 8×5m house: door on the SOUTH wall, window on the EAST wall --
const plan = createPlan({ name: 'Elev' })
const g = plan.floors[0]
const south = mk(g, 0, 0, 8000, 0)      // wait: plan-top = North, so y=0 is the NORTH side
const east = mk(g, 8000, 0, 8000, 5000)
mk(g, 8000, 5000, 0, 5000)
mk(g, 0, 5000, 0, 0)
// door on the y=5000 wall — that's the SOUTH facade (larger y = further south)
const southWall = g.walls[2]
g.openings.push(createOpening({ wallId: southWall.id, type: 'door', offset: 800 }))   // 900×2100
g.openings.push(createOpening({ wallId: east.id, type: 'window', offset: 1500 }))     // 1200×1200 sill 900
plan.roof = 'none'

// ---- south elevation ------------------------------------------
{
  const e = buildElevation(plan, 'south')
  check('south: one wall band spanning 8m at 0..2400',
    e.floors.length === 1 && e.floors[0].intervals.length === 1 &&
    near(e.floors[0].intervals[0][1] - e.floors[0].intervals[0][0], 8000) &&
    e.floors[0].v0 === 0 && e.floors[0].v1 === 2400,
    JSON.stringify(e.floors))
  check('south: exactly the door, from the floor line to 2100',
    e.openings.length === 1 && e.openings[0].type === 'door' &&
    e.openings[0].v0 === 0 && e.openings[0].v1 === 2100,
    JSON.stringify(e.openings))
  // door u-span: wall runs 8000,5000 → 0,5000; offset 800 → u decreasing? span width 900 regardless
  check('south: door span is 900 wide', near(e.openings[0].u1 - e.openings[0].u0, 900))
  check('south: east window is NOT on this facade', !e.openings.some((o) => o.type === 'window'))
}

// ---- east elevation -------------------------------------------
{
  const e = buildElevation(plan, 'east')
  // u = −y: building y∈[0,5000] → u∈[−5000, 0]
  check('east: band spans u −5000..0',
    near(e.floors[0].intervals[0][0], -5000) && near(e.floors[0].intervals[0][1], 0),
    JSON.stringify(e.floors[0].intervals))
  const win = e.openings.find((o) => o.type === 'window')
  check('east: window at sill 900..2100', win && win.v0 === 900 && win.v1 === 2100, JSON.stringify(win))
  check('east: window u-span 1200 wide inside the band',
    win && near(win.u1 - win.u0, 1200) && win.u0 > -5000 && win.u1 < 0)
  check('east: no door on this facade', !e.openings.some((o) => o.type === 'door'))
}

// ---- north elevation: door invisible, u mirrored ---------------
{
  const e = buildElevation(plan, 'north')
  check('north: mirrored band −8000..0',
    near(e.floors[0].intervals[0][0], -8000) && near(e.floors[0].intervals[0][1], 0),
    JSON.stringify(e.floors[0].intervals))
  check('north: south door not visible', e.openings.length === 0, JSON.stringify(e.openings))
}

// ---- all four directions exist --------------------------------
check('four directions defined', ELEVATION_DIRS.length === 4 &&
  ELEVATION_DIRS.every((d) => buildElevation(plan, d) !== null))

// ---- pitched roof profile -------------------------------------
{
  plan.roofPitch = 30
  plan.roof = 'pitched'
  const e = buildElevation(plan, 'south')
  const apexExpected = 2400 + 2500 * Math.tan(Math.PI / 6) // ridge inset = half of 5m depth
  check('pitched: apex ≈ 2400 + 2500·tan30 = 3843',
    near(e.height, apexExpected, 90), `${e.height} vs ${apexExpected}`)
  const prof = e.roof.profile
  check('pitched: profile ends pinned to the eaves (2400)',
    near(prof[0][1], 2400, 1) && near(prof[prof.length - 1][1], 2400, 1))
  // mid-profile is the highest region
  const midV = prof[Math.floor(prof.length / 2)][1]
  check('pitched: middle of the profile near the apex', near(midV, apexExpected, 120), midV)
  plan.roof = 'none'
}

// ---- flat roof slab -------------------------------------------
{
  plan.roof = 'flat'
  const e = buildElevation(plan, 'west')
  check('flat: 200mm slab above the walls',
    e.roof.kind === 'flat' && e.roof.v0 === 2400 && e.roof.v1 === 2600 && near(e.height, 2600))
  plan.roof = 'none'
}

// ---- two disjoint buildings → two bands ------------------------
{
  const p2 = createPlan({ name: 'Two' })
  const f = p2.floors[0]
  mk(f, 0, 0, 3000, 0); mk(f, 3000, 0, 3000, 2500); mk(f, 3000, 2500, 0, 2500); mk(f, 0, 2500, 0, 0)
  mk(f, 5000, 0, 8000, 0); mk(f, 8000, 0, 8000, 2500); mk(f, 8000, 2500, 5000, 2500); mk(f, 5000, 2500, 5000, 0)
  const e = buildElevation(p2, 'south')
  check('disjoint buildings: two wall bands with a gap',
    e.floors[0].intervals.length === 2 &&
    near(e.floors[0].intervals[0][1], 3000) && near(e.floors[0].intervals[1][0], 5000),
    JSON.stringify(e.floors[0].intervals))
}

// ---- two storeys stack -----------------------------------------
{
  const p3 = createPlan({ name: 'Stack' })
  const f0 = p3.floors[0]
  mk(f0, 0, 0, 8000, 0); mk(f0, 8000, 0, 8000, 5000); mk(f0, 8000, 5000, 0, 5000); mk(f0, 0, 5000, 0, 0)
  const f1 = createFloor({ name: 'F1', level: 1 })
  mk(f1, 0, 0, 8000, 0); mk(f1, 8000, 0, 8000, 5000); mk(f1, 8000, 5000, 0, 5000); mk(f1, 0, 5000, 0, 0)
  const win2 = createOpening({ wallId: f1.walls[2].id, type: 'window', offset: 2000 })
  f1.openings.push(win2)
  p3.floors.push(f1)
  const e = buildElevation(p3, 'south')
  check('two storeys: bands 0..2400 and 2400..4800',
    e.floors.length === 2 && e.floors[1].v0 === 2400 && e.floors[1].v1 === 4800,
    JSON.stringify(e.floors.map((f) => [f.v0, f.v1])))
  const w = e.openings.find((o) => o.type === 'window')
  check('two storeys: upper window at 2400+900..2400+2100',
    w && w.v0 === 3300 && w.v1 === 4500, JSON.stringify(w))
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
