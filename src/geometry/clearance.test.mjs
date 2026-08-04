// Door-swing clearance tests. Run: node src/geometry/clearance.test.mjs
import { doorSwingSectors, sectorIntersectsRect, doorClearanceIssues } from './clearanceGeo.js'
import { createWall, createOpening, createFurniture } from '../model/schema.js'

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`)
  if (!cond) failures++
}
// north wall of a room below it: wall along +x at y=0, room at y>0,
// swingSide -1 gives leaf direction (0,+1) = into the room
const wall = createWall({ start: { x: 0, y: 0 }, end: { x: 8000, y: 0 }, thickness: 300 })
const door = createOpening({ wallId: wall.id, type: 'door', offset: 1000, swingSide: -1 }) // 1000..1900, hinge start
const furn = (x, y, w = 1800, d = 850, rot = 0) =>
  createFurniture({ type: 'sofa', position: { x, y }, rotation: rot, dimensions: { w, d, h: 800 } })
const floorOf = (openings, furniture) => ({ walls: [wall], openings, furniture, rooms: [], stairs: [] })

// ---- sector construction --------------------------------------
{
  const secs = doorSwingSectors(wall, door)
  check('single door: one sector, radius = width', secs.length === 1 && secs[0].radius === 900)
  check('sector hinged at the hinge jamb (1000, 0)',
    Math.abs(secs[0].hinge.x - 1000) < 1 && Math.abs(secs[0].hinge.y) < 1, JSON.stringify(secs[0].hinge))
  const sliding = createOpening({ wallId: wall.id, type: 'door', offset: 4000, variant: 'sliding' })
  check('sliding door: no sectors', doorSwingSectors(wall, sliding).length === 0)
  const dbl = createOpening({ wallId: wall.id, type: 'door', offset: 4000, width: 1600, swingSide: -1, variant: 'double' })
  const dsecs = doorSwingSectors(wall, dbl)
  check('double door: two half-radius sectors at both jambs',
    dsecs.length === 2 && dsecs.every((s) => s.radius === 800) &&
    Math.abs(dsecs[0].hinge.x - 4000) < 1 && Math.abs(dsecs[1].hinge.x - 5600) < 1)
}

// ---- intersection cases ---------------------------------------
{
  const sec = doorSwingSectors(wall, door)[0]
  check('sofa parked in the swing → hit',
    sectorIntersectsRect(sec, { cx: 1500, cy: 450, w: 1800, d: 850, rot: 0 }))
  check('sofa well clear (2m into the room) → clean',
    !sectorIntersectsRect(sec, { cx: 1500, cy: 2200, w: 1800, d: 850, rot: 0 }))
  check('sofa beside the swing on the hinge side → clean',
    !sectorIntersectsRect(sec, { cx: 400, cy: 1500, w: 600, d: 600, rot: 0 }))
  check('big rect fully containing the sector → hit (boundary sampling)',
    sectorIntersectsRect(sec, { cx: 1450, cy: 450, w: 4000, d: 2400, rot: 0 }))
  check('thin rotated rect crossing one radius → hit',
    sectorIntersectsRect(sec, { cx: 1000, cy: 500, w: 120, d: 1600, rot: 30 }))
  check('rect just outside the arc radius → clean',
    !sectorIntersectsRect(sec, { cx: 1450, cy: 1050, w: 400, d: 200, rot: 0 }))
}

// ---- hinge flip mirrors the sector ----------------------------
{
  const doorEnd = createOpening({ wallId: wall.id, type: 'door', offset: 1000, swingSide: -1, hinge: 'end' })
  const sec = doorSwingSectors(wall, doorEnd)[0]
  check('hinge=end: sector hinged at (1900, 0)', Math.abs(sec.hinge.x - 1900) < 1)
  check('hinge=end: swing region flips to the other jamb side',
    sectorIntersectsRect(sec, { cx: 1400, cy: 450, w: 600, d: 600, rot: 0 }) &&
    !sectorIntersectsRect(sec, { cx: 2450, cy: 450, w: 400, d: 400, rot: 0 }))
}

// ---- floor scan ------------------------------------------------
{
  const blockedSofa = furn(1500, 450)
  const cleanChair = furn(6000, 2000, 450, 450)
  const issues = doorClearanceIssues(floorOf([door], [blockedSofa, cleanChair]))
  check('floor scan: flags exactly the blocking sofa',
    issues.length === 1 && issues[0].openingId === door.id &&
    issues[0].furnitureIds.length === 1 && issues[0].furnitureIds[0] === blockedSofa.id,
    JSON.stringify(issues))
  check('floor scan: all clear → empty', doorClearanceIssues(floorOf([door], [cleanChair])).length === 0)
  const sliding = createOpening({ wallId: wall.id, type: 'door', offset: 1000, variant: 'sliding' })
  check('floor scan: sliding never flags', doorClearanceIssues(floorOf([sliding], [blockedSofa])).length === 0)
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
