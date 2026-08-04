// Auto-furnish engine tests. Run: node src/geometry/furnish.test.mjs
import { furnishRoom, rotRectsOverlap, analyzeRoomEdges, FURNISH_KINDS } from './furnishGeo.js'
import { createWall, createOpening } from '../model/schema.js'
import { detectRooms, pointInPolygon, pointAlongWall, dist } from './geo.js'
import { FURNITURE_BY_TYPE } from '../model/furnitureLibrary.js'

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`)
  if (!cond) failures++
}

// ---- SAT sanity -----------------------------------------------
{
  const A = { cx: 0, cy: 0, w: 1000, d: 600, rot: 0 }
  check('SAT: overlapping rects', rotRectsOverlap(A, { cx: 400, cy: 200, w: 1000, d: 600, rot: 0 }))
  check('SAT: separated rects', !rotRectsOverlap(A, { cx: 1200, cy: 0, w: 1000, d: 600, rot: 0 }))
  check('SAT: rotated diagonal miss',
    !rotRectsOverlap(A, { cx: 900, cy: 700, w: 1000, d: 200, rot: 45 }))
  check('SAT: rotated hit', rotRectsOverlap(A, { cx: 600, cy: 300, w: 1000, d: 400, rot: 30 }))
}

// ---- shared fixtures -------------------------------------------
const buildRoom = (w, h, opts = {}) => {
  const walls = [
    createWall({ start: { x: 0, y: 0 }, end: { x: w, y: 0 }, thickness: 300 }),
    createWall({ start: { x: w, y: 0 }, end: { x: w, y: h }, thickness: 300 }),
    createWall({ start: { x: w, y: h }, end: { x: 0, y: h }, thickness: 300 }),
    createWall({ start: { x: 0, y: h }, end: { x: 0, y: 0 }, thickness: 300 }),
  ]
  const openings = []
  if (opts.door) openings.push(createOpening({
    wallId: walls[opts.door.wall].id, type: 'door',
    offset: opts.door.offset, swingSide: opts.door.swingSide,
  }))
  if (opts.window) openings.push(createOpening({
    wallId: walls[opts.window.wall].id, type: 'window',
    offset: opts.window.offset, width: opts.window.width || 1200,
  }))
  const room = detectRooms(walls)[0]
  return { room, walls, openings }
}
const asRect = (f) => ({ cx: f.position.x, cy: f.position.y, w: f.dimensions.w, d: f.dimensions.d, rot: f.rotation })
const noOverlaps = (items) => {
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (rotRectsOverlap(asRect(items[i]), asRect(items[j]))) return `${items[i].type} ∩ ${items[j].type}`
  return null
}
const allInside = (items, poly) => items.every((f) =>
  [[-1,-1],[1,-1],[1,1],[-1,1]].every(([sx, sy]) => {
    const r = (f.rotation * Math.PI) / 180
    const lx = sx * f.dimensions.w / 2, ly = sy * f.dimensions.d / 2
    return pointInPolygon({
      x: f.position.x + lx * Math.cos(r) - ly * Math.sin(r),
      y: f.position.y + lx * Math.sin(r) + ly * Math.cos(r),
    }, poly)
  }))

// ---- edge analysis: inward normals + spans --------------------
{
  const { room, walls, openings } = buildRoom(4000, 3500,
    { door: { wall: 0, offset: 800, swingSide: -1 }, window: { wall: 2, offset: 1200 } })
  const edges = analyzeRoomEdges(room, walls, openings)
  check('edges: 4 analyzed', edges.length === 4)
  const withDoor = edges.find((e) => e.doorSpans.length)
  const withWin = edges.find((e) => e.windowSpans.length)
  check('edges: door + window mapped to their edges', !!withDoor && !!withWin)
  check('edges: inward-swinging door keeps out full leaf depth (900)',
    withDoor.doorSpans[0].depth === 900, JSON.stringify(withDoor?.doorSpans))
  // every inward normal points INTO the polygon
  check('edges: all inward normals verified inward', edges.every((e) =>
    pointInPolygon({ x: (e.a.x + e.b.x) / 2 + e.inX * 100, y: (e.a.y + e.b.y) / 2 + e.inY * 100 }, room.polygon)))
}

// ---- bedroom ---------------------------------------------------
{
  const { room, walls, openings } = buildRoom(4000, 3500,
    { door: { wall: 0, offset: 800, swingSide: -1 }, window: { wall: 2, offset: 1400 } })
  const out = furnishRoom({ room, walls, openings, kind: 'bedroom' })
  check('bedroom: bed + wardrobe placed (≥3 items)',
    out.some((f) => f.type === 'bed_double') && out.some((f) => f.type === 'wardrobe') && out.length >= 3,
    out.map((f) => f.type).join(','))
  check('bedroom: no overlaps', noOverlaps(out) === null, noOverlaps(out))
  check('bedroom: everything inside the room', allInside(out, room.polygon))
  // door keep-out: nothing within the swing square (door at 800..1700 on south, swings in)
  const doorRect = { cx: 1250, cy: 150 + 450, w: 900, d: 900, rot: 0 }
  check('bedroom: door swing stays clear', out.every((f) => !rotRectsOverlap(asRect(f), doorRect)))
  // tall wardrobe must not block the window span (north wall x 1400..2600)
  const ward = out.find((f) => f.type === 'wardrobe')
  const blocked = ward && ward.position.y < 1200 && ward.position.x > 1100 && ward.position.x < 2900
  check('bedroom: wardrobe not blocking the window', !blocked, JSON.stringify(ward?.position))
  check('bedroom: deterministic', JSON.stringify(out) ===
    JSON.stringify(furnishRoom({ room, walls, openings, kind: 'bedroom' })))
}

// ---- small bedroom downgrades to a single bed ------------------
{
  const { room, walls, openings } = buildRoom(3000, 2600, { door: { wall: 0, offset: 500, swingSide: -1 } })
  const out = furnishRoom({ room, walls, openings, kind: 'bedroom' })
  check('small bedroom: single bed (7.8m² < 9.5)',
    out.some((f) => f.type === 'bed_single') && !out.some((f) => f.type === 'bed_double'),
    out.map((f) => f.type).join(','))
}

// ---- living: sofa faces the TV --------------------------------
{
  const { room, walls, openings } = buildRoom(6000, 4500, { door: { wall: 1, offset: 1500, swingSide: -1 } })
  const out = furnishRoom({ room, walls, openings, kind: 'living' })
  const sofa = out.find((f) => f.type === 'sofa')
  const tv = out.find((f) => f.type === 'tv_stand')
  check('living: sofa + tv + coffee table', !!sofa && !!tv && out.some((f) => f.type === 'coffee_table'),
    out.map((f) => f.type).join(','))
  check('living: sofa and tv on opposing walls (rotations differ by 180°)',
    sofa && tv && (Math.abs(sofa.rotation - tv.rotation) + 360) % 360 === 180,
    sofa && tv && `${sofa.rotation} vs ${tv.rotation}`)
  check('living: 20m²+ gets a dining group', out.some((f) => f.type === 'dining_table') &&
    out.filter((f) => f.type === 'chair').length >= 2, out.map((f) => f.type).join(','))
  check('living: no overlaps', noOverlaps(out) === null, noOverlaps(out))
}

// ---- kitchen: contiguous counter run, tall fridge off windows --
{
  const { room, walls, openings } = buildRoom(3600, 3000,
    { door: { wall: 0, offset: 600, swingSide: -1 }, window: { wall: 2, offset: 1200 } })
  const out = furnishRoom({ room, walls, openings, kind: 'kitchen' })
  const counters = out.filter((f) => f.type === 'counter')
  check('kitchen: counter run of ≥3', counters.length >= 3, counters.length)
  // contiguous: consecutive counters exactly 600 apart
  let contiguous = true
  for (let i = 1; i < counters.length; i++) {
    if (Math.abs(dist(counters[i - 1].position, counters[i].position) - 600) > 1) contiguous = false
  }
  check('kitchen: run is contiguous (600mm pitch)', contiguous)
  check('kitchen: fridge placed', out.some((f) => f.type === 'fridge'))
  check('kitchen: no overlaps', noOverlaps(out) === null, noOverlaps(out))
}

// ---- bathroom in a tight 2.2×1.8 ------------------------------
{
  const { room, walls, openings } = buildRoom(2200, 1800, { door: { wall: 0, offset: 300, swingSide: -1 } })
  const out = furnishRoom({ room, walls, openings, kind: 'bathroom' })
  check('bathroom: toilet + sink fit', out.some((f) => f.type === 'toilet') && out.some((f) => f.type === 'sink'),
    out.map((f) => f.type).join(','))
  check('bathroom: no overlaps, all inside', noOverlaps(out) === null && allInside(out, room.polygon))
}

// ---- respects existing furniture --------------------------------
{
  const { room, walls, openings } = buildRoom(4000, 3500, { door: { wall: 0, offset: 800, swingSide: -1 } })
  const existing = [{ id: 'x', type: 'sofa', position: { x: 2000, y: 2600 },
    rotation: 0, dimensions: { w: 1800, d: 850, h: 800 } }]
  const out = furnishRoom({ room, walls, openings, existingFurniture: existing, kind: 'bedroom' })
  const all = [...existing, ...out]
  check('existing furniture respected (no new item overlaps it)',
    noOverlaps(all) === null, noOverlaps(all))
}

// ---- degenerate -------------------------------------------------
{
  const { room, walls, openings } = buildRoom(1200, 1000, { door: { wall: 0, offset: 100, swingSide: -1 } })
  const out = furnishRoom({ room, walls, openings, kind: 'bedroom' })
  check('tiny room: no crash, nothing overlapping', noOverlaps(out) === null && allInside(out, room.polygon))
  check('unknown kind: empty result', furnishRoom({ room, walls, openings, kind: 'spa' }).length === 0)
  check('kinds exported', FURNISH_KINDS.length === 6)
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
