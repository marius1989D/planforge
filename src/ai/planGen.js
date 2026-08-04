// ============================================================
// PlanForge — AI plan generation (prompt → validated plan)
// ------------------------------------------------------------
// The model writes a SIMPLIFIED generation format (wall index
// references, no ids — far more reliable for an LLM than the
// internal schema). This module's real job is the robustness
// pipeline: extract JSON from prose/fences, coerce and clamp
// every value, drop invalid entries (collecting warnings),
// heal near-miss wall joins, then detect rooms — so whatever
// comes back either becomes a valid plan or fails loudly.
// Everything except requestAiPlan is pure and node-tested.
// ============================================================
import {
  createPlan, createFloor, createWall, createOpening,
} from '../model/schema.js'
import { healPlanWalls, detectRooms, dist } from '../geometry/geo.js'

export const PLAN_GEN_SYSTEM_PROMPT = `You design house floor plans as JSON for the PlanForge app. Reply with ONLY a JSON object — no prose, no markdown fences.

Format (all lengths in millimetres; y grows toward the SOUTH, so the top of the plan is North):
{
  "name": "Plan name",
  "roof": "pitched" | "flat" | "none",
  "roofPitch": 30,
  "floors": [
    {
      "name": "Ground Floor",
      "walls": [ { "x1": 0, "y1": 0, "x2": 9000, "y2": 0, "thickness": 300 }, ... ],
      "doors":   [ { "wall": 0, "offset": 800, "width": 900, "variant": "single" }, ... ],
      "windows": [ { "wall": 1, "offset": 1500, "width": 1200, "sill": 900 }, ... ]
    }
  ]
}

Rules:
- Exterior walls thickness 300, interior 150.
- Walls must form CLOSED loops for rooms to exist: every wall endpoint must exactly coincide with another wall's endpoint. Chain them corner to corner. Interior walls run wall-face to wall-face across a room (their endpoints must land exactly ON the centerline of the wall they meet).
- "wall" in doors/windows is the 0-based index into that floor's walls array; "offset" is mm from that wall's (x1,y1) end.
- Every habitable room needs a door; put at least one entrance door on an exterior wall and give most rooms a window.
- Typical sizes: bedrooms 10-14 m², living 20-35 m², door width 900 (1600 double), window width 1200-1800, sill 900.
- Keep coordinates on a 100mm grid. Total footprint should fit the user's brief (default ~10x12 m if unspecified).
- Upper floors (if any) should reuse the ground floor's exterior outline.`

// ---- 1. extract JSON from a model reply ----------------------
export function parseAiPlanJson(text) {
  if (!text || typeof text !== 'string') return { error: 'Empty response' }
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  if (start === -1) return { error: 'No JSON object in the response' }
  // balanced-brace scan so trailing prose doesn't break parsing
  let depth = 0
  let end = -1
  let inStr = false
  let esc = false
  for (let i = start; i < t.length; i++) {
    const c = t[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) return { error: 'Unbalanced JSON in the response' }
  try {
    return { data: JSON.parse(t.slice(start, end + 1)) }
  } catch (e) {
    return { error: `JSON parse failed: ${e.message}` }
  }
}

// ---- 2. normalize into a real, healed plan -------------------
const num = (v, fallback = null) => {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return Number.isFinite(n) ? n : fallback
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export function normalizeAiPlan(raw) {
  const warnings = []
  if (!raw || typeof raw !== 'object') return { error: 'Not an object' }
  const floorsIn = Array.isArray(raw.floors) ? raw.floors : null
  if (!floorsIn || floorsIn.length === 0) return { error: 'Plan has no floors' }

  const plan = createPlan({ name: String(raw.name || 'AI Plan').slice(0, 80) })
  plan.roof = ['pitched', 'flat', 'none'].includes(raw.roof) ? raw.roof : 'pitched'
  plan.roofPitch = clamp(num(raw.roofPitch, 30) ?? 30, 10, 60)
  plan.floors = []

  floorsIn.slice(0, 4).forEach((fi, idx) => {
    const floor = createFloor({
      name: String(fi?.name || (idx === 0 ? 'Ground Floor' : `Floor ${idx}`)).slice(0, 40),
      level: idx,
    })
    const wallsIn = Array.isArray(fi?.walls) ? fi.walls : []
    const indexMap = new Map() // AI wall index → created wall
    const seen = new Set()
    wallsIn.forEach((w, wi) => {
      const x1 = num(w?.x1)
      const y1 = num(w?.y1)
      const x2 = num(w?.x2)
      const y2 = num(w?.y2)
      if ([x1, y1, x2, y2].some((v) => v === null)) {
        warnings.push(`Floor ${idx + 1}: wall ${wi} has bad coordinates — dropped`)
        return
      }
      const start = { x: Math.round(x1), y: Math.round(y1) }
      const end = { x: Math.round(x2), y: Math.round(y2) }
      if (dist(start, end) < 300) {
        warnings.push(`Floor ${idx + 1}: wall ${wi} shorter than 300mm — dropped`)
        return
      }
      const key = [start.x, start.y, end.x, end.y].join(',')
      const rkey = [end.x, end.y, start.x, start.y].join(',')
      if (seen.has(key) || seen.has(rkey)) {
        warnings.push(`Floor ${idx + 1}: wall ${wi} duplicates another — dropped`)
        return
      }
      seen.add(key)
      const wall = createWall({
        start, end,
        thickness: clamp(num(w?.thickness, 300) ?? 300, 80, 500),
        height: clamp(num(w?.height, 2400) ?? 2400, 2000, 4000),
      })
      floor.walls.push(wall)
      indexMap.set(wi, wall)
    })

    const addOpenings = (list, type) => {
      if (!Array.isArray(list)) return
      list.forEach((o, oi) => {
        const wall = indexMap.get(num(o?.wall, -1))
        if (!wall) {
          warnings.push(`Floor ${idx + 1}: ${type} ${oi} references a missing wall — dropped`)
          return
        }
        const wlen = dist(wall.start, wall.end)
        // clamp to type-sane sizes FIRST (a width of 99999 means "wide",
        // not "as wide as the wall"), then verify it fits
        const width = clamp(num(o?.width, type === 'door' ? 900 : 1200) ?? 900,
          400, type === 'door' ? 2400 : 3000)
        if (wlen < width + 100) {
          warnings.push(`Floor ${idx + 1}: ${type} ${oi} wider than its wall — dropped`)
          return
        }
        const offset = clamp(num(o?.offset, 0) ?? 0, 50, wlen - width - 50)
        const opening = createOpening({
          wallId: wall.id, type, offset, width,
          height: type === 'door'
            ? clamp(num(o?.height, 2100) ?? 2100, 1800, 2400)
            : clamp(num(o?.height, 1200) ?? 1200, 400, 2200),
          sillHeight: type === 'window' ? clamp(num(o?.sill, 900) ?? 900, 0, 1500) : 0,
          variant: type === 'door' && ['single', 'double', 'sliding'].includes(o?.variant)
            ? o.variant : undefined,
        })
        floor.openings.push(opening)
      })
    }
    addOpenings(fi?.doors, 'door')
    addOpenings(fi?.windows, 'window')
    plan.floors.push(floor)
  })

  if (!plan.floors.some((f) => f.walls.length >= 3)) {
    return { error: 'No floor has enough valid walls to form a room', warnings }
  }

  // heal near-miss joins, split at junctions, detect rooms
  let totalRooms = 0
  plan.floors = plan.floors.map((f) => {
    // heal = snap near-miss endpoints + split T-junctions (openings
    // travel with their walls), then detect rooms from closed loops
    const healed = healPlanWalls(f.walls, f.openings, createWall, { tolerance: 15 })
    const rooms = detectRooms(healed.walls)
    totalRooms += rooms.length
    return { ...f, walls: healed.walls, openings: healed.openings, rooms }
  })
  if (totalRooms === 0) {
    warnings.push('The walls do not close any rooms — you can heal/adjust them manually')
  }
  return { plan, warnings }
}

// ---- 3. call the Anthropic API from the browser --------------
export async function requestAiPlan({ apiKey, prompt, model = 'claude-sonnet-4-6' }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system: PLAN_GEN_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 401) throw new Error('Invalid API key (401)')
    if (res.status === 429) throw new Error('Rate limited (429) — try again in a moment')
    throw new Error(`API error ${res.status}: ${detail.slice(0, 200)}`)
  }
  const data = await res.json()
  return (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

// full pipeline used by the UI (and by tests with a fake reply)
export function aiTextToPlan(text) {
  const parsed = parseAiPlanJson(text)
  if (parsed.error) return { error: parsed.error }
  return normalizeAiPlan(parsed.data)
}
