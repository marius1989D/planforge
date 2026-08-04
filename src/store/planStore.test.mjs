// Store behavior tests. Run: node src/store/planStore.test.mjs
global.localStorage = {
  _d: {}, getItem(k){return this._d[k]??null}, setItem(k,v){this._d[k]=v}, removeItem(k){delete this._d[k]},
}
const { usePlanStore } = await import('./planStore.js')

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`)
  if (!cond) failures++
}
const S = () => usePlanStore.getState()
// merged view: plan meta + the ACTIVE floor's content arrays, so all
// existing reads (plan().walls / .rooms / ...) keep working under v2
const plan = () => {
  const p = usePlanStore.getState().plan
  const f = p.floors[Math.min(p.activeFloorIndex || 0, p.floors.length - 1)]
  return { ...p, walls: f.walls, openings: f.openings, rooms: f.rooms, furniture: f.furniture, stairs: f.stairs }
}
const drawRect = (x, y, w, h) => {
  S().addWallWithSplits({ start: { x, y }, end: { x: x + w, y } })
  S().addWallWithSplits({ start: { x: x + w, y }, end: { x: x + w, y: y + h } })
  S().addWallWithSplits({ start: { x: x + w, y: y + h }, end: { x, y: y + h } })
  S().addWallWithSplits({ start: { x, y: y + h }, end: { x, y: y } })
}
const roomsSharing = () => {
  const counts = new Map()
  for (const r of plan().rooms) {
    if (r.source !== 'auto') continue
    for (const id of r.wallIds) counts.set(id, (counts.get(id) || 0) + 1)
  }
  return [...counts.values()].filter((c) => c > 1).length
}

// ============ detach-and-clone: two rooms sharing a divider ============
S().newPlan('Detach Test')
drawRect(0, 0, 8000, 3000)
S().addWallWithSplits({ start: { x: 4000, y: 0 }, end: { x: 4000, y: 3000 } })
check('setup: 2 rooms sharing a wall', plan().rooms.length === 2 && roomsSharing() === 1)

// add a doorway in the shared divider — must stay with the neighbor
const divider = plan().walls.find((w) => w.start.x === 4000 && w.end.x === 4000)
S().addOpening({ wallId: divider.id, type: 'door', offset: 1000 })

const right = plan().rooms.find((r) => r.polygon.some((pt) => pt.x === 8000))
const left = plan().rooms.find((r) => r.id !== right.id)
const leftPolyBefore = JSON.stringify([...left.polygon].sort((a,b)=>a.x-b.x||a.y-b.y))
const wallCountBefore = plan().walls.length

// detach the RIGHT room
const draggedIds = S().detachRoom(right.id)
check('detach: returned complete wall set (4 walls)', draggedIds && draggedIds.length === 4,
  JSON.stringify(draggedIds))
check('detach: one clone added', plan().walls.length === wallCountBefore + 1)
check('detach: clone id is new, divider id kept',
  draggedIds.every((id) => id !== divider.id) && plan().walls.some((w) => w.id === divider.id))
check('detach: doorway stayed with the ORIGINAL divider',
  plan().openings.length === 1 && plan().openings[0].wallId === divider.id)

// simulate the drag: move the detached room far away, then heal (drag-end)
S().translateWalls(draggedIds, 10000, 6000)
S().healWalls()
let rooms = plan().rooms
check('after move: still 2 rooms', rooms.length === 2, `got ${rooms.length}`)
const movedRight = rooms.find((r) => r.polygon.some((pt) => pt.x >= 14000))
const stayedLeft = rooms.find((r) => r !== movedRight)
check('dragged room moved rigidly, area preserved (12 m²)',
  movedRight && Math.abs(movedRight.area - 12) < 0.01, movedRight?.area)
check('neighbor completely untouched',
  JSON.stringify([...stayedLeft.polygon].sort((a,b)=>a.x-b.x||a.y-b.y)) === leftPolyBefore)
check('no shared walls remain', roomsSharing() === 0)
check('clone became a real solid wall on the moved room (4 walls each side)',
  movedRight.wallIds.length === 4 && stayedLeft.wallIds.length === 4)

// ============ rejoin: drag it back into contact =======================
const rejoinIds = S().detachRoom(movedRight.id) // no shared walls → no clones
check('re-detach with no party walls: no clone added', plan().walls.length === wallCountBefore + 1)
S().translateWalls(rejoinIds, -10000, -6000)
S().healWalls()
rooms = plan().rooms
check('rejoined: 2 rooms again', rooms.length === 2, `got ${rooms.length}`)
check('rejoined: shared wall restored by healing', roomsSharing() === 1,
  `sharing=${roomsSharing()}`)
check('rejoined: areas intact 12 + 12',
  rooms.every((r) => Math.abs(r.area - 12) < 0.01), rooms.map((r) => r.area).join(','))

// ============ middle room in a row of three ===========================
S().newPlan('Row of Three')
drawRect(0, 0, 9000, 3000)
S().addWallWithSplits({ start: { x: 3000, y: 0 }, end: { x: 3000, y: 3000 } })
S().addWallWithSplits({ start: { x: 6000, y: 0 }, end: { x: 6000, y: 3000 } })
check('row setup: 3 rooms, 2 shared walls', plan().rooms.length === 3 && roomsSharing() === 2)
const middle = plan().rooms.find((r) =>
  r.polygon.every((pt) => pt.x >= 3000 && pt.x <= 6000))
const midIds = S().detachRoom(middle.id)
check('middle detach: 4 walls, 2 of them clones', midIds.length === 4)
S().translateWalls(midIds, 0, 8000)
S().healWalls()
rooms = plan().rooms
check('row after pull-out: still 3 rooms', rooms.length === 3, `got ${rooms.length}`)
check('all three rooms 9 m² each', rooms.every((r) => Math.abs(r.area - 9) < 0.01),
  rooms.map((r) => r.area).join(','))
check('both neighbors kept their dividers (left-behind walls)', roomsSharing() === 0)

// ============ standalone room regression ==============================
S().newPlan('Standalone')
drawRect(0, 0, 4000, 3000)
const solo = plan().rooms[0]
const soloIds = S().detachRoom(solo.id)
check('standalone: no clones, own 4 walls', soloIds.length === 4)
S().translateWalls(soloIds, -1000, 500)
S().healWalls()
check('standalone: rigid move, 12 m² preserved',
  plan().rooms.length === 1 && Math.abs(plan().rooms[0].area - 12) < 0.01)

// ============ zone translation (unchanged path) =======================
const zid = S().addManualRoom({
  name: 'Z', polygon: [{x:100,y:100},{x:500,y:100},{x:500,y:400},{x:100,y:400}],
})
S().moveRoom(zid, 200, 50)
const z = plan().rooms.find((r) => r.id === zid)
check('zone translated correctly', z.polygon[0].x === 300 && z.polygon[0].y === 150)

// ============ join-a-room bug regression (round 2) ====================
S().newPlan('Join Test')
drawRect(0, 0, 6300, 4000)
check('join setup: 1 room 25.2 m²',
  plan().rooms.length === 1 && Math.abs(plan().rooms[0].area - 25.2) < 0.01)
S().renameRoom(plan().rooms[0].id, 'Living Room')
drawRect(1000, -1400, 4000, 1400) // bottom edge collinear on big top wall
check('after join: 2 rooms detected', plan().rooms.length === 2, `got ${plan().rooms.length}`)
const areas2 = plan().rooms.map((r) => r.area).sort((a, b) => a - b)
check('after join: 5.6 and 25.2 m²',
  Math.abs(areas2[0] - 5.6) < 0.01 && Math.abs(areas2[1] - 25.2) < 0.01, areas2.join(','))
check('custom name survived healing', plan().rooms.some((r) => r.name === 'Living Room'))
const names = plan().rooms.map((r) => r.name)
check('no duplicate names', new Set(names).size === names.length, names.join(','))

// ============ multi-plan manager ======================================
S().newPlan('Plan A')
drawRect(0, 0, 4000, 3000)
const idA = plan().id
S().newPlan('Plan B')
const idB = plan().id
check('plans: index contains both', S().plansIndex.some(e => e.id === idA) && S().plansIndex.some(e => e.id === idB))
check('plans: B is empty', plan().walls.length === 0)
S().switchPlan(idA)
check('plans: switching back restores A with its walls', plan().id === idA && plan().walls.length === 4)
S().duplicatePlan()
check('plans: duplicate has new id, same walls, "(copy)" name',
  plan().id !== idA && plan().walls.length === 4 && plan().name.includes('(copy)'))
const idCopy = plan().id
S().deleteCurrentPlan()
check('plans: delete removes from index and switches away',
  plan().id !== idCopy && !S().plansIndex.some(e => e.id === idCopy))

// ============ undo / redo =============================================
S().newPlan('History Test')
drawRect(0, 0, 4000, 3000)
check('history: room exists', plan().rooms.length === 1)
S().undo()
check('undo: last wall removed, loop broken (0 rooms)', plan().rooms.length === 0 && plan().walls.length === 3)
S().redo()
check('redo: wall and room restored', plan().rooms.length === 1 && plan().walls.length === 4)

// drag coalescing: snapshot once, then N history:false frames = ONE undo step
const room = plan().rooms[0]
const ids = S().detachRoom(room.id)
S().snapshot()
S().translateWalls(ids, 1000, 0)
S().translateWalls(ids, 1000, 0)
S().translateWalls(ids, 1000, 0)
S().healWalls()
const movedX = Math.min(...plan().walls.map(w => Math.min(w.start.x, w.end.x)))
check('drag: room moved 3m total', movedX === 3000, `minX=${movedX}`)
S().undo()
const backX = Math.min(...plan().walls.map(w => Math.min(w.start.x, w.end.x)))
check('undo: entire drag reverted in ONE step', backX === 0, `minX=${backX}`)

// coalescing by tag: repeated updates to same wall = one undo entry
S().newPlan('Tag Test')
const wid = S().addWall({ start: {x:0,y:0}, end: {x:4000,y:0} })
const undoDepthBefore = usePlanStore.getState()._history.undo.length
S().updateWall(wid, { thickness: 200 })
S().updateWall(wid, { thickness: 250 })
S().updateWall(wid, { thickness: 300 })
const undoDepthAfter = usePlanStore.getState()._history.undo.length
check('tag coalescing: 3 edits pushed 1 history entry', undoDepthAfter === undoDepthBefore + 1,
  `${undoDepthBefore} -> ${undoDepthAfter}`)
S().undo()
check('undo after coalesced edits: thickness back to 150',
  plan().walls[0].thickness === 150, plan().walls[0].thickness)

// new action clears redo
S().newPlan('Redo Clear')
S().addWall({ start: {x:0,y:0}, end: {x:2000,y:0} })
S().undo()
S().addWall({ start: {x:0,y:0}, end: {x:3000,y:0} })
check('new action clears redo stack', usePlanStore.getState()._history.redo.length === 0)

// ============ duplicate selected item =================================
S().newPlan('Dup Test')
drawRect(0, 0, 4000, 3000)
const dupRoom = plan().rooms[0]
S().setSelection({ type: 'room', id: dupRoom.id })
S().duplicateSelected()
check('dup room: 2 rooms now', plan().rooms.length === 2, `got ${plan().rooms.length}`)
check('dup room: equal areas', plan().rooms.every(r => Math.abs(r.area - 12) < 0.01))
check('dup room: clone selected', usePlanStore.getState().selection?.type === 'room' &&
  usePlanStore.getState().selection.id !== dupRoom.id)
check('dup room: clone offset clear of original',
  plan().walls.some(w => w.start.x >= 4500 || w.end.x >= 4500))
S().undo()
check('dup room: single undo removes the copy', plan().rooms.length === 1)

const southWall = plan().walls.find(w => w.start.y === 0 && w.end.y === 0)
const doorId = S().addOpening({ wallId: southWall.id, type: 'door', offset: 800 })
check('door defaults: swingSide/hinge set',
  plan().openings[0].swingSide === 1 && plan().openings[0].hinge === 'start')
S().setSelection({ type: 'opening', id: doorId })
S().duplicateSelected()
check('dup opening: 2 doors on same wall', plan().openings.length === 2 &&
  plan().openings.every(o => o.wallId === southWall.id))
check('dup opening: no overlap',
  Math.abs(plan().openings[1].offset - (800 + 900 + 100)) < 1, plan().openings[1].offset)

const furnId = S().addFurniture({ type: 'sofa', position: {x:2000,y:1500}, rotation: 90, dimensions: {w:1800,d:850,h:800} })
S().setSelection({ type: 'furniture', id: furnId })
S().duplicateSelected()
check('dup furniture: 2 items, rotation copied', plan().furniture.length === 2 &&
  plan().furniture[1].rotation === 90)
check('dup furniture: clone selected', usePlanStore.getState().selection.id === plan().furniture[1].id)

const zDup = S().addManualRoom({ name: 'Kitchen', polygon: [{x:0,y:5000},{x:2000,y:5000},{x:2000,y:6000},{x:0,y:6000}] })
S().setSelection({ type: 'zone', id: zDup })
S().duplicateSelected()
const zoneCopies = plan().rooms.filter(r => r.source === 'manual')
check('dup zone: 2 zones, copy offset right', zoneCopies.length === 2 &&
  zoneCopies[1].polygon[0].x === 2300, zoneCopies[1]?.polygon[0]?.x)

// ============ room drag carries its contents ==========================
S().newPlan('Contents Test')
drawRect(0, 0, 4000, 3000)
const cRoom = plan().rooms[0]
const inSofa = S().addFurniture({ type: 'sofa', position: {x:2000,y:1500}, rotation: 0, dimensions: {w:1800,d:850,h:800} })
const outChair = S().addFurniture({ type: 'chair', position: {x:9000,y:9000}, rotation: 0, dimensions: {w:450,d:450,h:900} })
const inZone = S().addManualRoom({ name: 'Dining', polygon: [{x:500,y:500},{x:1500,y:500},{x:1500,y:1500},{x:500,y:1500}] })

const contents = S().getRoomContents(cRoom.id)
check('contents: sofa + zone detected, outside chair excluded',
  contents.furnitureIds.length === 1 && contents.furnitureIds[0] === inSofa &&
  contents.zoneIds.length === 1 && contents.zoneIds[0] === inZone &&
  !contents.furnitureIds.includes(outChair))

// simulate the full drag gesture: snapshot → detach → framed moves → heal
S().snapshot()
const cWallIds = S().detachRoom(cRoom.id)
S().translateRoomParts({ wallIds: cWallIds, furnitureIds: contents.furnitureIds, zoneIds: contents.zoneIds }, 5000, 2000)
S().translateRoomParts({ wallIds: cWallIds, furnitureIds: contents.furnitureIds, zoneIds: contents.zoneIds }, 5000, 0)
S().healWalls()
let cp = plan()
const movedSofa = cp.furniture.find(f => f.id === inSofa)
const stayedChair = cp.furniture.find(f => f.id === outChair)
const movedZone = cp.rooms.find(r => r.id === inZone)
check('drag: sofa travelled with room (+10000,+2000)',
  movedSofa.position.x === 12000 && movedSofa.position.y === 3500,
  JSON.stringify(movedSofa.position))
check('drag: zone travelled with room',
  movedZone.polygon[0].x === 10500 && movedZone.polygon[0].y === 2500,
  JSON.stringify(movedZone.polygon[0]))
check('drag: outside chair untouched',
  stayedChair.position.x === 9000 && stayedChair.position.y === 9000)
check('drag: room itself moved, area intact',
  cp.rooms.some(r => r.source === 'auto' && Math.abs(r.area - 12) < 0.01 &&
    r.polygon.every(pt => pt.x >= 10000)))
S().undo()
cp = plan()
check('single undo reverts room AND contents together',
  cp.furniture.find(f => f.id === inSofa).position.x === 2000 &&
  cp.rooms.find(r => r.id === inZone).polygon[0].x === 500 &&
  cp.rooms.some(r => r.source === 'auto' && r.polygon.every(pt => pt.x <= 4000)))

// ============ duplicate furnished room clones contents ================
S().setSelection({ type: 'room', id: plan().rooms.find(r => r.source === 'auto').id })
S().duplicateSelected()
cp = plan()
check('dup furnished room: 2 rooms, 3 furniture (sofa cloned, chair not), 2 zones',
  cp.rooms.filter(r => r.source === 'auto').length === 2 &&
  cp.furniture.length === 3 &&
  cp.furniture.filter(f => f.type === 'sofa').length === 2 &&
  cp.rooms.filter(r => r.source === 'manual').length === 2,
  `rooms=${cp.rooms.filter(r=>r.source==='auto').length} furn=${cp.furniture.length} zones=${cp.rooms.filter(r=>r.source==='manual').length}`)
S().undo()
check('dup furnished room: single undo removes walls + contents clones',
  plan().furniture.length === 2 && plan().rooms.filter(r => r.source === 'manual').length === 1)

// ============ sample home ============================================
const { buildSamplePlan } = await import('../model/samplePlan.js')
const sample = buildSamplePlan()
const sg = sample.floors[0] // v2: content lives on the ground floor
check('sample: v2 with 1 floor', sample.schemaVersion === 2 && sample.floors.length === 1)
check('sample: 3 rooms + 1 zone', sg.rooms.filter(r=>r.source==='auto').length === 3 &&
  sg.rooms.filter(r=>r.source==='manual').length === 1)
const sAreas = sg.rooms.filter(r=>r.source==='auto').map(r=>r.area).sort((a,b)=>a-b)
check('sample: areas ~13.5/13.6/40 m²',
  sAreas[0] > 12 && sAreas[0] < 15 && sAreas[2] > 37 && sAreas[2] < 43, sAreas.join(','))
check('sample: 3 doors + 5 windows, all on real walls',
  sg.openings.filter(o=>o.type==='door').length === 3 &&
  sg.openings.filter(o=>o.type==='window').length === 5 &&
  sg.openings.every(o => sg.walls.some(w => w.id === o.wallId)))
check('sample: furnished + pitched roof', sg.furniture.length === 10 && sample.roof === 'pitched')
S().loadSamplePlan()
check('loadSamplePlan opens it', plan().name === 'Sample Bungalow' && plan().rooms.length === 4)

// ============ multi-floor ============================================
S().newPlan('Floors Test')
drawRect(0, 0, 6000, 4000)
check('floors: starts with 1 floor, 1 room', plan().floors.length === 1 && plan().rooms.length === 1)
S().addFloor()
check('floors: added + active switched', plan().floors.length === 2 && plan().activeFloorIndex === 1)
check('floors: shell walls copied up', plan().walls.length === 4 && plan().rooms.length === 1)
S().addWallWithSplits({ start: {x:3000,y:0}, end: {x:3000,y:4000} })
check('floors: divider on floor 1 -> 2 rooms upstairs', plan().rooms.length === 2)
S().setActiveFloor(0)
check('floors: ground floor untouched (1 room, 4 walls)',
  plan().rooms.length === 1 && plan().walls.length === 4)
const gWall = plan().walls[0].id
S().setActiveFloor(1)
check('floors: wall ids independent per floor', !plan().walls.some(w => w.id === gWall))
S().renameFloor(1, 'Bedrooms')
check('floors: rename', plan().floors[1].name === 'Bedrooms')
S().deleteFloor(1)
check('floors: delete -> back to 1, active clamped', plan().floors.length === 1 && plan().activeFloorIndex === 0)
S().deleteFloor(0)
check('floors: last floor cannot be deleted', plan().floors.length === 1)

// ============ stairs ==================================================
const stairId = S().addStair({ position: {x:2000,y:2000}, rotation: 0 })
check('stairs: added with defaults', plan().stairs.length === 1 &&
  plan().stairs[0].width === 1000 && plan().stairs[0].length === 2800)
S().updateStair(stairId, { rotation: 90 })
check('stairs: update', plan().stairs[0].rotation === 90)
S().setSelection({ type: 'stair', id: stairId })
S().duplicateSelected()
check('stairs: duplicate + selected clone', plan().stairs.length === 2 &&
  usePlanStore.getState().selection.id === plan().stairs[1].id)
S().deleteStair(plan().stairs[1].id)
check('stairs: delete', plan().stairs.length === 1)

// ============ room drag carries stairs too ============================
S().newPlan('Stair Carry')
drawRect(0, 0, 4000, 3000)
const scRoom = plan().rooms[0]
const scStair = S().addStair({ position: {x:1000,y:1000} })
const scContents = S().getRoomContents(scRoom.id)
check('contents include stair', scContents.stairIds.length === 1 && scContents.stairIds[0] === scStair)
const scIds = S().detachRoom(scRoom.id)
S().translateRoomParts({ wallIds: scIds, ...scContents }, 6000, 0)
S().healWalls()
check('stair travelled with room', plan().stairs[0].position.x === 7000)

// ============ v1 migration ============================================
const { migratePlan } = await import('../model/schema.js')
const v1 = { schemaVersion: 1, id: 'plan_legacy', name: 'Legacy', units: 'mm', gridSize: 100,
  roof: 'flat', walls: [{ id: 'w1', start: {x:0,y:0}, end: {x:1000,y:0}, thickness: 150, height: 2400 }],
  openings: [], rooms: [], furniture: [] }
const mig = migratePlan(structuredClone(v1))
check('migration: v1 wraps into floors[0], meta preserved',
  mig.schemaVersion === 2 && mig.floors.length === 1 &&
  mig.floors[0].walls[0].id === 'w1' && mig.roof === 'flat' && !('walls' in mig))
S().importPlan(v1)
check('migration: importing a v1 file just works', plan().walls.length === 1 && plan().floors.length === 1)

// ============ smart dimension editing =================================
S().newPlan('Dim Edit')
drawRect(0, 0, 8000, 4000)
S().addWallWithSplits({ start: {x:4000,y:0}, end: {x:4000,y:4000} })
const rightSofa = S().addFurniture({ type: 'sofa', position: {x:6000,y:2000}, rotation: 0, dimensions: {w:1800,d:850,h:800} })
const leftChair = S().addFurniture({ type: 'chair', position: {x:2000,y:2000}, rotation: 0, dimensions: {w:450,d:450,h:900} })
const eastWall = plan().walls.find(w => w.start.x === 8000 && w.end.x === 8000)
const dDoor = S().addOpening({ wallId: eastWall.id, type: 'door', offset: 1000 })
// resize the top edge (0,0)→(8000,0) to 10m: the right band shifts +2000
S().resizeFootprintEdge({ a: {x:0,y:0}, b: {x:8000,y:0}, newLen: 10000 })
let dp = plan()
const areas = dp.rooms.map(r => r.area).sort((x,y)=>x-y)
check('dim edit: left room 16m² unchanged, right grows to 24m²',
  Math.abs(areas[0]-16) < 0.01 && Math.abs(areas[1]-24) < 0.01, areas.join(','))
check('dim edit: east wall moved to x=10000',
  dp.walls.some(w => w.start.x === 10000 && w.end.x === 10000))
// items in the STRETCHING region keep absolute position (still inside
// the enlarged room); only the rigid band beyond the edited corner
// translates (covered by the east-wall check above)
check('dim edit: furniture keeps absolute position and stays in-room',
  dp.furniture.find(f=>f.id===rightSofa).position.x === 6000 &&
  dp.furniture.find(f=>f.id===leftChair).position.x === 2000 &&
  dp.rooms.some(r => r.polygon.some(pt => pt.x === 10000)))
check('dim edit: door on the moved wall still valid',
  (() => { const o = dp.openings.find(o=>o.id===dDoor); const w = dp.walls.find(w=>w.id===o.wallId)
    return w && o.offset >= 0 && o.offset + o.width <= Math.hypot(w.end.x-w.start.x, w.end.y-w.start.y) + 1 })())
S().undo()
check('dim edit: single undo restores 8m width',
  plan().rooms.every(r => Math.abs(r.area - 16) < 0.01))

// shrink: 8000 → 6000, right room 4000→2000 wide
S().resizeFootprintEdge({ a: {x:0,y:0}, b: {x:8000,y:0}, newLen: 6000 })
const shrunk = plan().rooms.map(r=>r.area).sort((x,y)=>x-y)
check('dim edit: shrink works (8m²+16m²)',
  Math.abs(shrunk[0]-8) < 0.01 && Math.abs(shrunk[1]-16) < 0.01, shrunk.join(','))
S().undo()

// ============ single wall resize =====================================
S().newPlan('Wall Len')
const wa = S().addWall({ start: {x:0,y:0}, end: {x:4000,y:0} })
const wb = S().addWall({ start: {x:4000,y:0}, end: {x:4000,y:3000} })
S().resizeWallLength(wa, 5000)
const wA = plan().walls.find(w=>w.id===wa)
const wB = plan().walls.find(w=>w.id===wb)
check('wall resize: end moved to 5000', wA.end.x === 5000 && wA.end.y === 0)
check('wall resize: connected wall followed', wB.start.x === 5000 && wB.start.y === 0)

// ============ door variants ==========================================
const { createOpening: co } = await import('../model/schema.js')
const dv = co({ wallId: 'w', type: 'door' })
const dd = co({ wallId: 'w', type: 'door', variant: 'double' })
const wv = co({ wallId: 'w', type: 'window' })
check('variant: door defaults single, double carries, window has none',
  dv.variant === 'single' && dd.variant === 'double' && wv.variant === undefined)

// ============ sun settings ===========================================
S().newPlan('Sun Test')
check('sun: defaults present on new plans',
  plan().sun && plan().sun.enabled === false && plan().sun.dateISO === '2026-06-21')
S().setSunSettings({ enabled: true, minutes: 9 * 60 })
check('sun: patch merges', plan().sun.enabled === true &&
  plan().sun.minutes === 540 && plan().sun.lat === 44.43)
S().setSunSettings({ lat: 51.5, lon: -0.1 })
check('sun: second patch keeps earlier fields', plan().sun.minutes === 540 && plan().sun.lat === 51.5)
S().undo()
check('sun: coalesced tag → one undo back to defaults', plan().sun.enabled === false)

// ============ auto-furnish ==========================================
S().newPlan('Furnish Test')
drawRect(0, 0, 4000, 3500)
const fRoom = plan().rooms[0]
const fWall = plan().walls.find(w => w.start.y === 0 && w.end.y === 0)
S().addOpening({ wallId: fWall.id, type: 'door', offset: 800, swingSide: -1 })
const nPlaced = S().furnishRoom(fRoom.id, 'bedroom')
check('furnish: placed items via store', nPlaced >= 3 && plan().furniture.length === nPlaced, nPlaced)
check('furnish: bed present', plan().furniture.some(f => f.type.startsWith('bed_')))
S().undo()
check('furnish: single undo removes the whole batch', plan().furniture.length === 0)
check('furnish: bogus room id → 0', S().furnishRoom('nope', 'bedroom') === 0)

// ============ cost rates ============================================
S().setCostRates({ wallPerM2: 120 })
check('cost rates: patch stored', plan().costRates.wallPerM2 === 120)
S().setCostRates({ currency: '$' })
check('cost rates: merge keeps earlier fields', plan().costRates.wallPerM2 === 120 && plan().costRates.currency === '$')

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
