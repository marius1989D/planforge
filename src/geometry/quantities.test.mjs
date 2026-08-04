// Quantity takeoff tests against hand-computed values.
import { computeQuantities, computeCostLines, fmtMoney } from './quantities.js'
import { createPlan, createFloor, createWall, createOpening, createStair } from '../model/schema.js'
import { detectRooms } from './geo.js'

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`)
  if (!cond) failures++
}
const near = (a, b, tol = 0.05) => Math.abs(a - b) < tol

// 8×5m single room, one door (900×2100), one window (1200×1200)
const plan = createPlan({ name: 'Q' })
const g = plan.floors[0]
const mk = (f, x1,y1,x2,y2) => { const w = createWall({ start:{x:x1,y:y1}, end:{x:x2,y:y2} }); f.walls.push(w); return w }
const south = mk(g,0,0,8000,0); const east = mk(g,8000,0,8000,5000)
mk(g,8000,5000,0,5000); mk(g,0,5000,0,0)
g.openings.push(createOpening({ wallId: south.id, type: 'door', offset: 800 }))
g.openings.push(createOpening({ wallId: east.id, type: 'window', offset: 1500 }))
g.rooms = detectRooms(g.walls)
g.stairs.push(createStair({ position: { x: 6500, y: 2500 } }))
plan.roof = 'pitched'
plan.roofPitch = 30

const q = computeQuantities(plan)
// walls: perimeter 26m × 2.4 = 62.4 gross; openings 0.9×2.1 + 1.2×1.2 = 3.33
check('wall gross 62.4 m²', near(q.wallGrossM2, 62.4), q.wallGrossM2)
check('wall net 59.07 m²', near(q.wallNetM2, 59.07), q.wallNetM2)
check('wall length 26 m', near(q.wallLengthM, 26), q.wallLengthM)
check('floor area 40 m²', near(q.floorAreaM2, 40), q.floorAreaM2)
// pitched roof: 40 / cos30 = 46.188
check('roof area 46.19 m² (slope-corrected)', near(q.roofAreaM2, 40 / Math.cos(Math.PI / 6)), q.roofAreaM2)
check('counts: 1 door, 1 window, 1 stair', q.doors === 1 && q.windows === 1 && q.stairs === 1)
check('window glass 1.44 m²', near(q.windowGlassM2, 1.44), q.windowGlassM2)

// flat roof = plain footprint
plan.roof = 'flat'
check('flat roof = footprint 40 m²', near(computeQuantities(plan).roofAreaM2, 40))
plan.roof = 'pitched'

// second floor doubles walls/floor, roof stays top-only
const up = createFloor({ name: 'F1', level: 1 })
mk(up,0,0,8000,0); mk(up,8000,0,8000,5000); mk(up,8000,5000,0,5000); mk(up,0,5000,0,0)
up.rooms = detectRooms(up.walls)
plan.floors.push(up)
const q2 = computeQuantities(plan)
check('two floors: wall gross 124.8', near(q2.wallGrossM2, 124.8), q2.wallGrossM2)
check('two floors: floor area 80', near(q2.floorAreaM2, 80), q2.floorAreaM2)
check('two floors: roof still 46.19 (top only)', near(q2.roofAreaM2, 40 / Math.cos(Math.PI / 6)), q2.roofAreaM2)

// cost lines with default + custom rates
const c = computeCostLines(plan)
check('cost: 6 line items', c.lines.length === 6, c.lines.map(l=>l.label).join('|'))
check('cost: total = Σ subtotals and > 0',
  near(c.total, c.lines.reduce((s,l)=>s+l.subtotal,0), 0.01) && c.total > 0)
plan.costRates = { wallPerM2: 100, currency: '$' }
const c2 = computeCostLines(plan)
const wallLine = c2.lines.find(l => l.label.startsWith('Walls'))
check('cost: custom rate applied, others default',
  wallLine.rate === 100 && c2.lines.find(l=>l.label==='Doors').rate === 350 && c2.currency === '$')
check('money format', fmtMoney(12345.6, '€') === '€12,346', fmtMoney(12345.6, '€'))

// no roof → 5 lines
plan.roof = 'none'
check('no roof → roof line omitted', computeCostLines(plan).lines.length === 5)

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
