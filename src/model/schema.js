// ============================================================
// PlanForge — core data schema (v1)
// ------------------------------------------------------------
// This file is the single contract for the whole app.
// Walls are the source of truth. Rooms are either:
//   - source: "auto"   → derived from closed wall loops (step 3)
//   - source: "manual" → user-drawn zone polygons (open-plan)
// Openings (doors/windows) reference a wall + offset, so they
// travel with the wall when it moves.
// All lengths are millimetres internally. Display conversion
// happens in model/units.js only.
// ============================================================

import { SUN_DEFAULTS } from '../geometry/sunGeo.js'

let counter = 0

const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`

// ---- Defaults (mm) -----------------------------------------
export const DEFAULTS = {
  wallThickness: 150,
  wallHeight: 2400,
  gridSize: 100,        // snap increment
  doorWidth: 900,
  doorHeight: 2100,
  windowWidth: 1200,
  windowHeight: 1200,
  windowSill: 900,
}

// ---- Factories ---------------------------------------------
export const createWall = ({ start, end, thickness, height } = {}) => ({
  id: uid('wall'),
  start: { x: start?.x ?? 0, y: start?.y ?? 0 },
  end: { x: end?.x ?? 0, y: end?.y ?? 0 },
  thickness: thickness ?? DEFAULTS.wallThickness,
  height: height ?? DEFAULTS.wallHeight,
})

export const createOpening = ({
  wallId, type = 'door', offset = 0, width, height, sillHeight, swingSide, hinge, variant,
} = {}) => ({
  id: uid(type),
  wallId,
  type, // "door" | "window"
  offset, // mm along wall from start point (to opening's leading edge)
  width: width ?? (type === 'door' ? DEFAULTS.doorWidth : DEFAULTS.windowWidth),
  height: height ?? (type === 'door' ? DEFAULTS.doorHeight : DEFAULTS.windowHeight),
  sillHeight: type === 'window' ? (sillHeight ?? DEFAULTS.windowSill) : 0,
  // doors only: which face of the wall the leaf swings toward
  // (+1 / -1 = wall normal (dy,-dx) sign) and which end holds the hinge
  swingSide: type === 'door' ? (swingSide ?? 1) : 0,
  hinge: type === 'door' ? (hinge ?? 'start') : undefined, // "start" | "end"
  variant: type === 'door' ? (variant ?? 'single') : undefined, // "single" | "double" | "sliding"
})

// Plan tags for openings (D1, D2… / W1, W2…) — architectural
// convention: sizes live in a schedule keyed by tag, not inline
// like wall dimensions. Numbered by array order.
export function openingTags(openings) {
  let d = 0
  let w = 0
  return new Map(
    openings.map((o) => [o.id, o.type === 'door' ? `D${++d}` : `W${++w}`]),
  )
}

export const createRoom = ({ name = 'Room', source = 'auto', wallIds = [], polygon = [] } = {}) => ({
  id: uid('room'),
  name,
  source, // "auto" | "manual"
  wallIds: source === 'auto' ? wallIds : undefined,
  polygon, // computed if auto, user-drawn if manual
  area: 0, // m², cached — recomputed, never trusted as input
})

// Straight stair: position = center, rotation degrees (Konva convention),
// width = across, length = travel direction. Rises one storey in 3D.
export const createStair = ({ position, rotation = 0, width = 1000, length = 2800 } = {}) => ({
  id: uid('stair'),
  position: { x: position?.x ?? 0, y: position?.y ?? 0 },
  rotation,
  width,
  length,
})

export const createFloor = ({ name = 'Ground Floor', level = 0 } = {}) => ({
  id: uid('floor'),
  name,
  level,
  walls: [],
  openings: [],
  rooms: [],
  furniture: [],
  stairs: [],
})

export const createFurniture = ({ type = 'box', position, rotation = 0, dimensions } = {}) => ({
  id: uid('item'),
  type,
  position: { x: position?.x ?? 0, y: position?.y ?? 0 },
  rotation, // degrees
  dimensions: {
    w: dimensions?.w ?? 1000,
    d: dimensions?.d ?? 1000,
    h: dimensions?.h ?? 800,
  },
})

export const createPlan = ({ name = 'Untitled Plan' } = {}) => ({
  schemaVersion: 2,
  id: uid('plan'),
  name,
  units: 'mm', // "mm" | "ft" (display only)
  roof: 'none', // "none" | "flat" | "pitched" — applies to the TOP floor
  roofPitch: 30,
  wallColor: null,
  floorColor: null,
  showDimensions: true,
  gridSize: DEFAULTS.gridSize,
  activeFloorIndex: 0,
  sun: { ...SUN_DEFAULTS }, // daylight simulation settings (3D)
  floors: [createFloor({ name: 'Ground Floor', level: 0 })],
})

// ---- Validation + v1 → v2 migration --------------------------
export function isValidPlan(p) {
  return (
    p && typeof p === 'object' && p.schemaVersion === 2 &&
    Array.isArray(p.floors) && p.floors.length >= 1 &&
    p.floors.every((f) =>
      Array.isArray(f.walls) && Array.isArray(f.openings) &&
      Array.isArray(f.rooms) && Array.isArray(f.furniture))
  )
}

// Accepts v1 (flat walls/rooms on the plan) or v2. Returns a valid v2
// plan or null. Also normalizes missing per-floor arrays (stairs was
// added with v2 and may be absent in early v2 files).
export function migratePlan(p) {
  if (!p || typeof p !== 'object') return null
  if (p.schemaVersion === 1 &&
      Array.isArray(p.walls) && Array.isArray(p.openings) &&
      Array.isArray(p.rooms) && Array.isArray(p.furniture)) {
    const floor = createFloor({ name: 'Ground Floor', level: 0 })
    floor.walls = p.walls
    floor.openings = p.openings
    floor.rooms = p.rooms
    floor.furniture = p.furniture
    const { walls, openings, rooms, furniture, ...meta } = p
    return { ...meta, schemaVersion: 2, activeFloorIndex: 0, floors: [floor] }
  }
  if (p.schemaVersion === 2 && Array.isArray(p.floors)) {
    const out = {
      ...p,
      activeFloorIndex: Math.min(p.activeFloorIndex || 0, p.floors.length - 1),
      floors: p.floors.map((f) => ({ ...f, stairs: Array.isArray(f.stairs) ? f.stairs : [] })),
    }
    return isValidPlan(out) ? out : null
  }
  return null
}
