import { create } from 'zustand'
import {
  createPlan, createFloor, createWall, createOpening, createRoom,
  createFurniture, createStair, isValidPlan, migratePlan,
} from '../model/schema.js'
import {
  detectRooms, polygonAreaM2, translatePolygon,
  healPlanWalls, polygonCentroid, dist, pointInPolygon,
} from '../geometry/geo.js'
import { buildSamplePlan } from '../model/samplePlan.js'
import { furnishRoom as computeFurnish } from '../geometry/furnishGeo.js'

// ============================================================
// Persistence (unchanged keys). Plans are schema v2 (floors[]);
// v1 files migrate transparently on load/import.
// ============================================================
const INDEX_KEY = 'planforge_index'
const CURRENT_KEY = 'planforge_current_id'
const LEGACY_KEY = 'planforge_current'
const PLAN_KEY = (id) => `planforge_plan_${id}`

const readJSON = (k) => {
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null } catch { return null }
}
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* quota */ } }
const removeKey = (k) => { try { localStorage.removeItem(k) } catch { /* noop */ } }

function loadInitial() {
  let index = readJSON(INDEX_KEY)
  if (!Array.isArray(index)) index = []

  const legacy = migratePlan(readJSON(LEGACY_KEY))
  if (legacy && !index.some((e) => e.id === legacy.id)) {
    writeJSON(PLAN_KEY(legacy.id), legacy)
    index = [...index, { id: legacy.id, name: legacy.name, updatedAt: Date.now() }]
    writeJSON(INDEX_KEY, index)
    removeKey(LEGACY_KEY)
  }

  let currentId = null
  try { currentId = localStorage.getItem(CURRENT_KEY) } catch { /* noop */ }
  let plan = currentId ? migratePlan(readJSON(PLAN_KEY(currentId))) : null
  if (!plan) plan = index.length ? migratePlan(readJSON(PLAN_KEY(index[0].id))) : null
  if (!plan) {
    plan = createPlan({ name: 'My First Plan' })
    index = [...index, { id: plan.id, name: plan.name, updatedAt: Date.now() }]
    writeJSON(INDEX_KEY, index)
    writeJSON(PLAN_KEY(plan.id), plan)
  }
  try { localStorage.setItem(CURRENT_KEY, plan.id) } catch { /* noop */ }
  return { plan, index }
}

let saveTimer = null
function scheduleSave(plan) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    writeJSON(PLAN_KEY(plan.id), plan)
    const index = readJSON(INDEX_KEY) || []
    const entry = { id: plan.id, name: plan.name, updatedAt: Date.now() }
    const next = index.some((e) => e.id === plan.id)
      ? index.map((e) => (e.id === plan.id ? entry : e))
      : [...index, entry]
    writeJSON(INDEX_KEY, next)
  }, 400)
}
function saveNow(plan) {
  clearTimeout(saveTimer)
  writeJSON(PLAN_KEY(plan.id), plan)
}

// ============================================================
// Floor helpers — every geometry/content mutation targets the
// ACTIVE floor. `mutateFloor(plan, fn)` maps only that floor.
// ============================================================
export const activeFloorOf = (plan) =>
  plan.floors[Math.min(plan.activeFloorIndex || 0, plan.floors.length - 1)]

const mutateFloor = (plan, fn) => {
  const idx = Math.min(plan.activeFloorIndex || 0, plan.floors.length - 1)
  return { ...plan, floors: plan.floors.map((f, i) => (i === idx ? fn(f) : f)) }
}

// Room recomputation (active floor) with two-stage name reconciliation
const DEFAULT_ROOM_NAME = /^Room \d+$/
function recomputeFloorRooms(floor) {
  const manual = floor.rooms.filter((r) => r.source === 'manual')
  const prevAuto = floor.rooms.filter((r) => r.source === 'auto')
  const byId = new Map(prevAuto.map((r) => [r.id, r]))
  const detected = detectRooms(floor.walls)

  const claimed = new Set()
  const assigned = new Map()
  for (const r of detected) {
    const prev = byId.get(r.id)
    if (prev) {
      claimed.add(prev.id)
      if (!DEFAULT_ROOM_NAME.test(prev.name)) assigned.set(r.id, prev.name)
    }
  }
  const leftovers = prevAuto.filter(
    (p) => !claimed.has(p.id) && !DEFAULT_ROOM_NAME.test(p.name),
  )
  for (const r of detected) {
    if (assigned.has(r.id) || byId.has(r.id)) continue
    const c = polygonCentroid(r.polygon)
    let best = null
    for (const p of leftovers) {
      if (claimed.has(p.id)) continue
      const d = dist(c, polygonCentroid(p.polygon))
      if (d < 2000 && (!best || d < best.d)) best = { d, p }
    }
    if (best) {
      claimed.add(best.p.id)
      assigned.set(r.id, best.p.name)
    }
  }
  const used = new Set(assigned.values())
  let n = 1
  const auto = detected.map((r) => {
    if (assigned.has(r.id)) return { ...r, name: assigned.get(r.id) }
    while (used.has(`Room ${n}`)) n++
    const name = `Room ${n}`
    used.add(name)
    return { ...r, name }
  })
  return { ...floor, rooms: [...auto, ...manual] }
}
const withRecomputedRooms = (plan) => mutateFloor(plan, recomputeFloorRooms)

// Keep every opening within its (possibly resized) wall
const clampFloorOpenings = (f) => ({
  ...f,
  openings: f.openings.map((o) => {
    const w = f.walls.find((x) => x.id === o.wallId)
    if (!w) return o
    const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y)
    const offset = Math.max(0, Math.min(o.offset, Math.max(0, len - o.width)))
    return offset === o.offset ? o : { ...o, offset }
  }),
})

const HISTORY_CAP = 50
const emptyHistory = () => ({ undo: [], redo: [], lastTag: null })

export const usePlanStore = create((set, get) => {
  const initial = loadInitial()

  // shorthand: mutate the active floor inside a _commit
  const commitFloor = (fn, opts) => get()._commit((p) => mutateFloor(p, fn), opts)

  return {
    plan: initial.plan,
    plansIndex: initial.index,
    _history: emptyHistory(),

    _commit(mutate, { recompute = false, history = true, tag = null } = {}) {
      set((state) => {
        let next = mutate(structuredClone(state.plan))
        if (recompute) next = withRecomputedRooms(next)
        scheduleSave(next)
        const h = state._history
        if (!history) return { plan: next }
        const coalesce = tag !== null && tag === h.lastTag
        return {
          plan: next,
          _history: {
            undo: coalesce ? h.undo : [...h.undo.slice(-(HISTORY_CAP - 1)), state.plan],
            redo: [],
            lastTag: tag,
          },
        }
      })
    },

    // ---- undo / redo ------------------------------------------
    snapshot: () =>
      set((s) => ({
        _history: {
          undo: [...s._history.undo.slice(-(HISTORY_CAP - 1)), s.plan],
          redo: [],
          lastTag: null,
        },
      })),
    undo: () =>
      set((s) => {
        const u = s._history.undo
        if (!u.length) return {}
        const prev = u[u.length - 1]
        scheduleSave(prev)
        return {
          plan: prev,
          _history: {
            undo: u.slice(0, -1),
            redo: [...s._history.redo.slice(-(HISTORY_CAP - 1)), s.plan],
            lastTag: null,
          },
        }
      }),
    redo: () =>
      set((s) => {
        const r = s._history.redo
        if (!r.length) return {}
        const next = r[r.length - 1]
        scheduleSave(next)
        return {
          plan: next,
          _history: {
            undo: [...s._history.undo.slice(-(HISTORY_CAP - 1)), s.plan],
            redo: r.slice(0, -1),
            lastTag: null,
          },
        }
      }),

    // ---- plan manager ------------------------------------------
    _registerAndOpen(plan) {
      saveNow(get().plan)
      writeJSON(PLAN_KEY(plan.id), plan)
      const index = get().plansIndex
      const entry = { id: plan.id, name: plan.name, updatedAt: Date.now() }
      const nextIndex = index.some((e) => e.id === plan.id)
        ? index.map((e) => (e.id === plan.id ? entry : e))
        : [...index, entry]
      writeJSON(INDEX_KEY, nextIndex)
      try { localStorage.setItem(CURRENT_KEY, plan.id) } catch { /* noop */ }
      set({ plan, plansIndex: nextIndex, _history: emptyHistory(), selection: null })
    },
    newPlan: (name) => get()._registerAndOpen(createPlan({ name: name || 'Untitled Plan' })),
    loadSamplePlan: () => get()._registerAndOpen(buildSamplePlan()),
    switchPlan: (id) => {
      if (id === get().plan.id) return
      const target = migratePlan(readJSON(PLAN_KEY(id)))
      if (target) get()._registerAndOpen(target)
    },
    duplicatePlan: () => {
      const src = get().plan
      const copy = structuredClone(src)
      const fresh = createPlan({ name: `${src.name} (copy)` })
      copy.id = fresh.id
      copy.name = fresh.name
      get()._registerAndOpen(copy)
    },
    deleteCurrentPlan: () => {
      const { plan, plansIndex } = get()
      const nextIndex = plansIndex.filter((e) => e.id !== plan.id)
      removeKey(PLAN_KEY(plan.id))
      writeJSON(INDEX_KEY, nextIndex)
      const nextPlan =
        (nextIndex.length && migratePlan(readJSON(PLAN_KEY(nextIndex[0].id)))) ||
        createPlan({ name: 'Untitled Plan' })
      if (!nextIndex.some((e) => e.id === nextPlan.id)) {
        nextIndex.push({ id: nextPlan.id, name: nextPlan.name, updatedAt: Date.now() })
        writeJSON(INDEX_KEY, nextIndex)
        writeJSON(PLAN_KEY(nextPlan.id), nextPlan)
      }
      try { localStorage.setItem(CURRENT_KEY, nextPlan.id) } catch { /* noop */ }
      set({ plan: nextPlan, plansIndex: nextIndex, _history: emptyHistory(), selection: null })
    },
    importPlan: (obj) => {
      const incoming = migratePlan(structuredClone(obj))
      if (!incoming) throw new Error('Invalid plan file')
      if (get().plansIndex.some((e) => e.id === incoming.id)) {
        incoming.id = createPlan({}).id
      }
      get()._registerAndOpen(incoming)
    },
    exportPlan: () => JSON.stringify(get().plan, null, 2),

    renamePlan: (name) => {
      get()._commit((p) => ({ ...p, name }), { tag: 'plan-name' })
      const { plan, plansIndex } = get()
      const nextIndex = plansIndex.map((e) =>
        e.id === plan.id ? { ...e, name, updatedAt: Date.now() } : e,
      )
      writeJSON(INDEX_KEY, nextIndex)
      set({ plansIndex: nextIndex })
    },
    setUnits: (units) => get()._commit((p) => ({ ...p, units }), { tag: 'units' }),
    setGridSize: (gridSize) => get()._commit((p) => ({ ...p, gridSize }), { tag: 'grid' }),
    setRoof: (roof) => get()._commit((p) => ({ ...p, roof }), { tag: 'roof' }),
    setRoofPitch: (roofPitch) =>
      get()._commit((p) => ({ ...p, roofPitch: Math.max(10, Math.min(55, roofPitch)) }), { tag: 'pitch' }),
    setWallColor: (wallColor) => get()._commit((p) => ({ ...p, wallColor }), { tag: 'wallcolor' }),
    setFloorColor: (floorColor) => get()._commit((p) => ({ ...p, floorColor }), { tag: 'floorcolor' }),
    setCostRates: (patch) =>
      get()._commit(
        (p) => ({ ...p, costRates: { ...(p.costRates || {}), ...patch } }),
        { tag: 'costrates' },
      ),
    setSunSettings: (patch) =>
      get()._commit(
        (p) => ({ ...p, sun: { ...(p.sun || {}), ...patch } }),
        { tag: 'sun' },
      ),
    setShowDimensions: (showDimensions) =>
      get()._commit((p) => ({ ...p, showDimensions }), { tag: 'showdims' }),

    // ---- floors -------------------------------------------------
    setActiveFloor: (index) =>
      get()._commit(
        (p) => ({ ...p, activeFloorIndex: Math.max(0, Math.min(index, p.floors.length - 1)) }),
        { history: false },
      ),
    // New floor above the current top. Copies the top floor's WALLS
    // (the shell) — the standard starting point for an upper storey.
    addFloor: ({ copyWalls = true } = {}) => {
      get()._commit((p) => {
        const top = p.floors[p.floors.length - 1]
        const floor = createFloor({ name: `Floor ${p.floors.length}`, level: p.floors.length })
        if (copyWalls) {
          floor.walls = top.walls.map((w) =>
            createWall({ start: { ...w.start }, end: { ...w.end }, thickness: w.thickness, height: w.height }))
        }
        return { ...p, floors: [...p.floors, floor], activeFloorIndex: p.floors.length }
      }, { recompute: true })
    },
    renameFloor: (index, name) =>
      get()._commit(
        (p) => ({ ...p, floors: p.floors.map((f, i) => (i === index ? { ...f, name } : f)) }),
        { tag: `floor-name:${index}` },
      ),
    deleteFloor: (index) => {
      if (get().plan.floors.length <= 1) return
      get()._commit((p) => {
        if (p.floors.length <= 1) return p
        const floors = p.floors.filter((_, i) => i !== index)
        return {
          ...p, floors,
          activeFloorIndex: Math.min(p.activeFloorIndex >= index ? p.activeFloorIndex - 1 : p.activeFloorIndex, floors.length - 1),
        }
      })
      set({ selection: null })
    },

    // ---- walls (active floor) -----------------------------------
    addWall: (props) => {
      const wall = createWall(props)
      commitFloor((f) => ({ ...f, walls: [...f.walls, wall] }), { recompute: true })
      return wall.id
    },
    updateWall: (id, patch) =>
      commitFloor(
        (f) => ({ ...f, walls: f.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) }),
        { recompute: true, tag: `wall:${id}` },
      ),
    deleteWall: (id) =>
      commitFloor(
        (f) => ({
          ...f,
          walls: f.walls.filter((w) => w.id !== id),
          openings: f.openings.filter((o) => o.wallId !== id),
        }),
        { recompute: true },
      ),
    addWallWithSplits: ({ start, end, thickness, height }) => {
      commitFloor((f) => {
        const w = createWall({ start, end, thickness, height })
        const healed = healPlanWalls([...f.walls, w], f.openings, (props) => createWall(props))
        return { ...f, walls: healed.walls, openings: healed.openings }
      }, { recompute: true })
    },
    healWalls: () =>
      commitFloor((f) => {
        const healed = healPlanWalls(f.walls, f.openings, (props) => createWall(props))
        return { ...f, walls: healed.walls, openings: healed.openings }
      }, { recompute: true, history: false }),
    moveNodes: (moves, tolerance = 10) =>
      commitFloor((f) => ({
        ...f,
        walls: f.walls.map((w) => {
          const os = w.start, oe = w.end
          let ns = os, ne = oe
          for (const m of moves) {
            if (Math.hypot(os.x - m.from.x, os.y - m.from.y) <= tolerance) ns = { ...m.to }
            if (Math.hypot(oe.x - m.from.x, oe.y - m.from.y) <= tolerance) ne = { ...m.to }
          }
          return ns === os && ne === oe ? w : { ...w, start: ns, end: ne }
        }),
      }), { recompute: true, history: false }),
    translateWalls: (wallIds, dx, dy) => {
      const ids = new Set(wallIds)
      commitFloor((f) => ({
        ...f,
        walls: f.walls.map((w) =>
          ids.has(w.id)
            ? { ...w, start: { x: w.start.x + dx, y: w.start.y + dy }, end: { x: w.end.x + dx, y: w.end.y + dy } }
            : w),
      }), { recompute: true, history: false })
    },
    detachRoom: (roomId) => {
      let newWallIds = null
      commitFloor((f) => {
        const room = f.rooms.find((r) => r.id === roomId && r.source === 'auto')
        if (!room) return f
        const usage = new Map()
        for (const r of f.rooms) {
          if (r.source !== 'auto') continue
          for (const id of r.wallIds || []) usage.set(id, (usage.get(id) || 0) + 1)
        }
        const own = (room.wallIds || []).filter((id) => (usage.get(id) || 0) <= 1)
        const shared = (room.wallIds || []).filter((id) => (usage.get(id) || 0) > 1)
        if (shared.length === 0) {
          newWallIds = [...own]
          return f
        }
        const clones = shared.map((id) => {
          const w = f.walls.find((x) => x.id === id)
          return createWall({ start: { ...w.start }, end: { ...w.end }, thickness: w.thickness, height: w.height })
        })
        newWallIds = [...own, ...clones.map((c) => c.id)]
        return { ...f, walls: [...f.walls, ...clones] }
      }, { recompute: true, history: false })
      return newWallIds
    },
    getRoomContents: (roomId) => {
      const f = activeFloorOf(get().plan)
      const room = f.rooms.find((r) => r.id === roomId && r.source === 'auto')
      if (!room) return { furnitureIds: [], zoneIds: [], stairIds: [] }
      return {
        furnitureIds: f.furniture.filter((x) => pointInPolygon(x.position, room.polygon)).map((x) => x.id),
        zoneIds: f.rooms
          .filter((r) => r.source === 'manual' && pointInPolygon(polygonCentroid(r.polygon), room.polygon))
          .map((r) => r.id),
        stairIds: f.stairs.filter((x) => pointInPolygon(x.position, room.polygon)).map((x) => x.id),
      }
    },
    translateRoomParts: ({ wallIds = [], furnitureIds = [], zoneIds = [], stairIds = [] }, dx, dy) => {
      const wids = new Set(wallIds)
      const fids = new Set(furnitureIds)
      const zids = new Set(zoneIds)
      const sids = new Set(stairIds)
      commitFloor((f) => ({
        ...f,
        walls: f.walls.map((w) =>
          wids.has(w.id)
            ? { ...w, start: { x: w.start.x + dx, y: w.start.y + dy }, end: { x: w.end.x + dx, y: w.end.y + dy } }
            : w),
        furniture: f.furniture.map((x) =>
          fids.has(x.id) ? { ...x, position: { x: x.position.x + dx, y: x.position.y + dy } } : x),
        stairs: f.stairs.map((x) =>
          sids.has(x.id) ? { ...x, position: { x: x.position.x + dx, y: x.position.y + dy } } : x),
        rooms: f.rooms.map((r) =>
          zids.has(r.id) && r.source === 'manual' ? { ...r, polygon: translatePolygon(r.polygon, dx, dy) } : r),
      }), { recompute: true, history: false })
    },

    // ---- smart dimension editing -----------------------------------
    // Resize a footprint edge a→b to newLen: everything at or beyond
    // b's perpendicular line (along the edge axis) translates by the
    // delta — walls stretch, the far band moves rigidly, and furniture
    // / stairs / zones in that band travel along. One undo step.
    resizeFootprintEdge: ({ a, b, newLen }) => {
      commitFloor((f) => {
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        if (len < 1 || newLen < 300) return f
        const ux = (b.x - a.x) / len
        const uy = (b.y - a.y) / len
        const delta = newLen - len
        if (Math.abs(delta) < 0.5) return f
        const dx = ux * delta
        const dy = uy * delta
        const proj = (pt) => (pt.x - a.x) * ux + (pt.y - a.y) * uy
        const moves = (pt) => proj(pt) >= len - 5
        const shift = (pt) => (moves(pt) ? { x: pt.x + dx, y: pt.y + dy } : pt)
        const out = {
          ...f,
          walls: f.walls.map((w) => {
            const ns = shift(w.start)
            const ne = shift(w.end)
            return ns === w.start && ne === w.end ? w : { ...w, start: ns, end: ne }
          }),
          furniture: f.furniture.map((x) =>
            moves(x.position) ? { ...x, position: { x: x.position.x + dx, y: x.position.y + dy } } : x),
          stairs: f.stairs.map((x) =>
            moves(x.position) ? { ...x, position: { x: x.position.x + dx, y: x.position.y + dy } } : x),
          rooms: f.rooms.map((r) => {
            if (r.source !== 'manual') return r
            const c = polygonCentroid(r.polygon)
            return moves(c) ? { ...r, polygon: translatePolygon(r.polygon, dx, dy) } : r
          }),
        }
        return clampFloorOpenings(out)
      }, { recompute: true })
    },
    // Resize one wall to an exact length: the END node moves along the
    // wall axis; walls sharing that node follow (moveNodes semantics).
    resizeWallLength: (id, newLen) => {
      commitFloor((f) => {
        const wall = f.walls.find((w) => w.id === id)
        if (!wall || newLen < 300) return f
        const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
        if (len < 1 || Math.abs(newLen - len) < 0.5) return f
        const ux = (wall.end.x - wall.start.x) / len
        const uy = (wall.end.y - wall.start.y) / len
        const from = { ...wall.end }
        const to = { x: wall.start.x + ux * newLen, y: wall.start.y + uy * newLen }
        const out = {
          ...f,
          walls: f.walls.map((w) => {
            const ns = Math.hypot(w.start.x - from.x, w.start.y - from.y) <= 5 ? { ...to } : w.start
            const ne = Math.hypot(w.end.x - from.x, w.end.y - from.y) <= 5 ? { ...to } : w.end
            return ns === w.start && ne === w.end ? w : { ...w, start: ns, end: ne }
          }),
        }
        return clampFloorOpenings(out)
      }, { recompute: true, tag: `walllen:${id}` })
    },

    // ---- openings ------------------------------------------------
    addOpening: (props) => {
      const opening = createOpening(props)
      commitFloor((f) => ({ ...f, openings: [...f.openings, opening] }))
      return opening.id
    },
    updateOpening: (id, patch, opts = {}) =>
      commitFloor(
        (f) => ({ ...f, openings: f.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) }),
        opts.history === false ? { history: false } : { tag: `opening:${id}` },
      ),
    deleteOpening: (id) =>
      commitFloor((f) => ({ ...f, openings: f.openings.filter((o) => o.id !== id) })),

    // ---- rooms / zones ---------------------------------------------
    addManualRoom: ({ name, polygon }) => {
      const room = createRoom({ name, source: 'manual', polygon })
      room.area = polygonAreaM2(polygon)
      commitFloor((f) => ({ ...f, rooms: [...f.rooms, room] }))
      return room.id
    },
    renameRoom: (id, name) =>
      commitFloor(
        (f) => ({ ...f, rooms: f.rooms.map((r) => (r.id === id ? { ...r, name } : r)) }),
        { tag: `room:${id}` },
      ),
    deleteManualRoom: (id) =>
      commitFloor((f) => ({
        ...f,
        rooms: f.rooms.filter((r) => !(r.id === id && r.source === 'manual')),
      })),
    moveRoom: (roomId, dx, dy) =>
      commitFloor((f) => {
        const room = f.rooms.find((r) => r.id === roomId && r.source === 'manual')
        if (!room) return f
        return {
          ...f,
          rooms: f.rooms.map((r) =>
            r.id === roomId ? { ...r, polygon: translatePolygon(r.polygon, dx, dy) } : r),
        }
      }, { history: false }),

    // ---- furniture -------------------------------------------------
    addFurniture: (props) => {
      const item = createFurniture(props)
      commitFloor((f) => ({ ...f, furniture: [...f.furniture, item] }))
      return item.id
    },
    updateFurniture: (id, patch, opts = {}) =>
      commitFloor(
        (f) => ({ ...f, furniture: f.furniture.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
        opts.history === false ? { history: false } : { tag: `furn:${id}` },
      ),
    deleteFurniture: (id) =>
      commitFloor((f) => ({ ...f, furniture: f.furniture.filter((x) => x.id !== id) })),

    // Auto-furnish a detected room: the engine computes placements
    // (walls, door swings, windows, existing furniture all respected);
    // everything lands in ONE commit = one undo step.
    furnishRoom: (roomId, kind) => {
      const floor = activeFloorOf(get().plan)
      const room = floor.rooms.find((r) => r.id === roomId && r.source === 'auto')
      if (!room) return 0
      const placements = computeFurnish({
        room,
        walls: floor.walls,
        openings: floor.openings,
        existingFurniture: floor.furniture,
        kind,
      })
      if (!placements.length) return 0
      const items = placements.map((p) => createFurniture(p))
      commitFloor((f) => ({ ...f, furniture: [...f.furniture, ...items] }))
      return items.length
    },

    // ---- stairs -----------------------------------------------------
    addStair: (props) => {
      const stair = createStair(props)
      commitFloor((f) => ({ ...f, stairs: [...f.stairs, stair] }))
      return stair.id
    },
    updateStair: (id, patch, opts = {}) =>
      commitFloor(
        (f) => ({ ...f, stairs: f.stairs.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
        opts.history === false ? { history: false } : { tag: `stair:${id}` },
      ),
    deleteStair: (id) =>
      commitFloor((f) => ({ ...f, stairs: f.stairs.filter((x) => x.id !== id) })),

    // ---- duplicate whatever is selected ------------------------------
    duplicateSelected: () => {
      const { selection } = get()
      const plan = get().plan
      const floor = activeFloorOf(plan)
      if (!selection) return
      const grid = plan.gridSize || 100

      if (selection.type === 'furniture') {
        const src = floor.furniture.find((x) => x.id === selection.id)
        if (!src) return
        const item = createFurniture({
          type: src.type,
          position: { x: src.position.x + src.dimensions.w + 150, y: src.position.y },
          rotation: src.rotation,
          dimensions: { ...src.dimensions },
        })
        commitFloor((f) => ({ ...f, furniture: [...f.furniture, item] }))
        set({ selection: { type: 'furniture', id: item.id } })
        return
      }
      if (selection.type === 'stair') {
        const src = floor.stairs.find((x) => x.id === selection.id)
        if (!src) return
        const stair = createStair({
          position: { x: src.position.x + src.width + 300, y: src.position.y },
          rotation: src.rotation, width: src.width, length: src.length,
        })
        commitFloor((f) => ({ ...f, stairs: [...f.stairs, stair] }))
        set({ selection: { type: 'stair', id: stair.id } })
        return
      }
      if (selection.type === 'zone') {
        const src = floor.rooms.find((r) => r.id === selection.id && r.source === 'manual')
        if (!src) return
        const xs = src.polygon.map((p) => p.x)
        const dx = Math.max(...xs) - Math.min(...xs) + 300
        const room = createRoom({
          name: `${src.name} (copy)`, source: 'manual',
          polygon: translatePolygon(src.polygon, dx, 0),
        })
        room.area = src.area
        commitFloor((f) => ({ ...f, rooms: [...f.rooms, room] }))
        set({ selection: { type: 'zone', id: room.id } })
        return
      }
      if (selection.type === 'wall') {
        const src = floor.walls.find((w) => w.id === selection.id)
        if (!src) return
        const len = Math.hypot(src.end.x - src.start.x, src.end.y - src.start.y) || 1
        const nx = ((src.end.y - src.start.y) / len) * 500
        const ny = (-(src.end.x - src.start.x) / len) * 500
        const wall = createWall({
          start: { x: src.start.x + nx, y: src.start.y + ny },
          end: { x: src.end.x + nx, y: src.end.y + ny },
          thickness: src.thickness, height: src.height,
        })
        commitFloor((f) => ({ ...f, walls: [...f.walls, wall] }), { recompute: true })
        set({ selection: { type: 'wall', id: wall.id } })
        return
      }
      if (selection.type === 'opening') {
        const src = floor.openings.find((o) => o.id === selection.id)
        const wall = src && floor.walls.find((w) => w.id === src.wallId)
        if (!src || !wall) return
        const len = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y)
        let offset = src.offset + src.width + 100
        if (offset + src.width > len) offset = src.offset - src.width - 100
        if (offset < 0) return
        const clone = createOpening({ ...src, offset })
        commitFloor((f) => ({ ...f, openings: [...f.openings, clone] }))
        set({ selection: { type: 'opening', id: clone.id } })
        return
      }
      if (selection.type === 'room') {
        const src = floor.rooms.find((r) => r.id === selection.id && r.source === 'auto')
        if (!src) return
        const xs = src.polygon.map((p) => p.x)
        const ys = src.polygon.map((p) => p.y)
        const dx = Math.ceil((Math.max(...xs) - Math.min(...xs) + 500) / grid) * grid
        const wallIds = new Set(src.wallIds || [])
        const clones = floor.walls
          .filter((w) => wallIds.has(w.id))
          .map((w) => createWall({
            start: { x: w.start.x + dx, y: w.start.y },
            end: { x: w.end.x + dx, y: w.end.y },
            thickness: w.thickness, height: w.height,
          }))
        const furnClones = floor.furniture
          .filter((x) => pointInPolygon(x.position, src.polygon))
          .map((x) => createFurniture({
            type: x.type, position: { x: x.position.x + dx, y: x.position.y },
            rotation: x.rotation, dimensions: { ...x.dimensions },
          }))
        const stairClones = floor.stairs
          .filter((x) => pointInPolygon(x.position, src.polygon))
          .map((x) => createStair({
            position: { x: x.position.x + dx, y: x.position.y },
            rotation: x.rotation, width: x.width, length: x.length,
          }))
        const zoneClones = floor.rooms
          .filter((r) => r.source === 'manual' && pointInPolygon(polygonCentroid(r.polygon), src.polygon))
          .map((z) => {
            const zc = createRoom({
              name: z.name, source: 'manual',
              polygon: translatePolygon(z.polygon, dx, 0),
            })
            zc.area = z.area
            return zc
          })
        commitFloor((f) => ({
          ...f,
          walls: [...f.walls, ...clones],
          furniture: [...f.furniture, ...furnClones],
          stairs: [...f.stairs, ...stairClones],
          rooms: [...f.rooms, ...zoneClones],
        }), { recompute: true })
        const cx = xs.reduce((a, b) => a + b, 0) / xs.length + dx
        const cy = ys.reduce((a, b) => a + b, 0) / ys.length
        const found = activeFloorOf(get().plan).rooms.find(
          (r) => r.source === 'auto' && dist(polygonCentroid(r.polygon), { x: cx, y: cy }) < grid * 2,
        )
        set({ selection: found ? { type: 'room', id: found.id } : null })
      }
    },

    // ---- appearance / ephemeral UI ------------------------------------
    theme: (() => {
      try { return localStorage.getItem('planforge_theme') || 'daylight' } catch { return 'daylight' }
    })(),
    setTheme: (theme) => {
      try { localStorage.setItem('planforge_theme', theme) } catch { /* noop */ }
      set({ theme })
    },
    selection: null,
    setSelection: (selection) =>
      set(selection ? { selection, inspectorOpen: true } : { selection }),
    tool: 'select',
    setTool: (tool) => set({ tool }),
    view: '2d',
    setView: (view) => set({ view }),
    walkMode: false,
    setWalkMode: (walkMode) => set({ walkMode }),
    inspectorOpen: true,
    setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
    pngExporter: null,
    setPngExporter: (fn) => set({ pngExporter: fn }),
    importOpener: null,
    setImportOpener: (fn) => set({ importOpener: fn }),
  }
})
