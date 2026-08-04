// A furnished 2-bedroom bungalow used by the empty-state onboarding.
// Built through the same pipeline as user drawing (healPlanWalls +
// detectRooms) so it's guaranteed structurally valid.
import {
  createPlan, createWall, createOpening, createFurniture, createRoom,
} from './schema.js'
import { detectRooms, healPlanWalls, polygonAreaM2 } from '../geometry/geo.js'

export function buildSamplePlan() {
  const plan = createPlan({ name: 'Sample Bungalow' })
  const ground = plan.floors[0]

  let res = { walls: [], openings: [] }
  const add = (x1, y1, x2, y2, thickness = 300) => {
    res = healPlanWalls(
      [...res.walls, createWall({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness })],
      res.openings, (props) => createWall(props),
    )
  }
  // outer shell (300mm), 10 × 7 m
  add(0, 0, 10000, 0)
  add(10000, 0, 10000, 7000)
  add(10000, 7000, 0, 7000)
  add(0, 7000, 0, 0)
  // partitions (150mm): bedroom column + divider
  add(4000, 0, 4000, 7000, 150)
  add(0, 3500, 4000, 3500, 150)

  ground.walls = res.walls
  ground.openings = res.openings

  // wall lookup by geometry
  const vSeg = (x, y1, y2) => ground.walls.find((w) =>
    Math.abs(w.start.x - x) < 1 && Math.abs(w.end.x - x) < 1 &&
    Math.min(w.start.y, w.end.y) >= y1 - 1 && Math.max(w.start.y, w.end.y) <= y2 + 1)
  const hSeg = (y, x1, x2) => ground.walls.find((w) =>
    Math.abs(w.start.y - y) < 1 && Math.abs(w.end.y - y) < 1 &&
    Math.min(w.start.x, w.end.x) >= x1 - 1 && Math.max(w.start.x, w.end.x) <= x2 + 1)

  const door = (wall, offset, swingSide = 1) =>
    ground.openings.push(createOpening({ wallId: wall.id, type: 'door', offset, swingSide }))
  const win = (wall, offset, width = 1200) =>
    ground.openings.push(createOpening({ wallId: wall.id, type: 'window', offset, width }))

  door(vSeg(4000, 0, 3500), 1300, 1)      // bedroom 1
  door(vSeg(4000, 3500, 7000), 1300, 1)   // bedroom 2
  door(hSeg(7000, 4000, 10000), 2500, 1)  // entrance
  win(hSeg(0, 0, 4000), 1400)             // bedroom 1 window
  win(hSeg(7000, 0, 4000), 1400)          // bedroom 2 window
  win(vSeg(10000, 0, 7000), 1500)         // living east 1
  win(vSeg(10000, 0, 7000), 4300)         // living east 2
  win(hSeg(0, 4000, 10000), 2500, 1500)   // kitchen window

  ground.rooms = detectRooms(ground.walls)
  // name the rooms by position
  for (const r of ground.rooms) {
    const cx = r.polygon.reduce((s, p) => s + p.x, 0) / r.polygon.length
    const cy = r.polygon.reduce((s, p) => s + p.y, 0) / r.polygon.length
    r.name = cx > 4000 ? 'Living / Kitchen' : cy < 3500 ? 'Bedroom 1' : 'Bedroom 2'
  }

  const kitchenZone = createRoom({
    name: 'Kitchen', source: 'manual',
    polygon: [
      { x: 8000, y: 300 }, { x: 9800, y: 300 },
      { x: 9800, y: 2300 }, { x: 8000, y: 2300 },
    ],
  })
  kitchenZone.area = polygonAreaM2(kitchenZone.polygon)
  ground.rooms.push(kitchenZone)

  const furn = (type, x, y, rotation, w, d, h) =>
    ground.furniture.push(createFurniture({
      type, position: { x, y }, rotation, dimensions: { w, d, h },
    }))
  furn('bed_double', 1900, 1500, 0, 1600, 2000, 500)
  furn('wardrobe', 3200, 350 + 300, 0, 1200, 600, 2000)
  furn('bed_single', 1200, 5400, 0, 900, 2000, 500)
  furn('desk', 3100, 6300, 0, 1400, 700, 750)
  furn('sofa', 6800, 5600, 0, 1800, 850, 800)
  furn('dining_table', 6600, 2300, 0, 1600, 900, 750)
  furn('chair', 6000, 1500, 0, 450, 450, 900)
  furn('chair', 7200, 1500, 0, 450, 450, 900)
  furn('fridge', 9400, 900, 0, 700, 700, 1800)
  furn('counter', 8500, 700, 0, 600, 600, 900)

  plan.roof = 'pitched'
  plan.roofPitch = 30
  plan.showDimensions = true
  return plan
}
