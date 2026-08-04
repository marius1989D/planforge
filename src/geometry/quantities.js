// ============================================================
// PlanForge — quantity takeoff + cost estimation (pure)
// ------------------------------------------------------------
// Quantities across ALL floors:
//   • walls: net face area = Σ length×height − opening areas (m²)
//   • floors: Σ detected room areas (m²)
//   • roof: top-floor footprint area; pitched multiplies by
//     1/cos(pitch) — EXACT for the distance-function hip roof,
//     whose every facet has uniform slope
//   • doors / windows / stairs: counts (+ window glass area)
// Costs = quantities × user-editable rates.
// ============================================================
import { extractFootprints, signedAreaMm2, dist } from './geo.js'

export const DEFAULT_RATES = {
  currency: '€',
  wallPerM2: 95,
  floorPerM2: 60,
  roofPerM2: 80,
  doorEach: 350,
  windowEach: 420,
  stairEach: 2200,
}

export function computeQuantities(plan) {
  let wallGrossM2 = 0
  let openingAreaM2 = 0
  let wallLengthM = 0
  let floorAreaM2 = 0
  let doors = 0
  let windows = 0
  let windowGlassM2 = 0
  let stairs = 0

  for (const f of plan.floors) {
    for (const w of f.walls) {
      const lenM = dist(w.start, w.end) / 1000
      wallLengthM += lenM
      wallGrossM2 += lenM * (w.height / 1000)
    }
    for (const o of f.openings) {
      const a = (o.width / 1000) * (o.height / 1000)
      openingAreaM2 += a
      if (o.type === 'door') doors++
      else {
        windows++
        windowGlassM2 += a
      }
    }
    floorAreaM2 += f.rooms
      .filter((r) => r.source === 'auto')
      .reduce((s, r) => s + r.area, 0)
    stairs += f.stairs.length
  }

  // roof: top floor footprint(s)
  const top = plan.floors[plan.floors.length - 1]
  const footprintM2 = extractFootprints(top.walls)
    .reduce((s, fp) => s + Math.abs(signedAreaMm2(fp)) / 1e6, 0)
  let roofAreaM2 = 0
  if (plan.roof === 'flat') roofAreaM2 = footprintM2
  if (plan.roof === 'pitched') {
    const pitch = ((plan.roofPitch || 30) * Math.PI) / 180
    roofAreaM2 = footprintM2 / Math.cos(pitch)
  }

  return {
    wallNetM2: Math.max(0, wallGrossM2 - openingAreaM2),
    wallGrossM2,
    wallLengthM,
    floorAreaM2,
    roofAreaM2,
    roofKind: plan.roof || 'none',
    doors,
    windows,
    windowGlassM2,
    stairs,
    floors: plan.floors.length,
  }
}

// line items ready for UI/PDF: [{ label, qty, unit, rate, subtotal }]
export function computeCostLines(plan) {
  const q = computeQuantities(plan)
  const r = { ...DEFAULT_RATES, ...(plan.costRates || {}) }
  const lines = []
  const add = (label, qty, unit, rate) => {
    if (qty <= 0) return
    lines.push({ label, qty, unit, rate, subtotal: qty * rate })
  }
  add('Walls (net of openings)', round1(q.wallNetM2), 'm²', r.wallPerM2)
  add('Floors', round1(q.floorAreaM2), 'm²', r.floorPerM2)
  if (q.roofKind !== 'none') {
    add(`Roof (${q.roofKind}${q.roofKind === 'pitched' ? `, ${plan.roofPitch || 30}°` : ''})`,
      round1(q.roofAreaM2), 'm²', r.roofPerM2)
  }
  add('Doors', q.doors, 'pcs', r.doorEach)
  add('Windows', q.windows, 'pcs', r.windowEach)
  add('Stairs', q.stairs, 'pcs', r.stairEach)
  return {
    lines,
    total: lines.reduce((s, l) => s + l.subtotal, 0),
    currency: r.currency,
    quantities: q,
  }
}

const round1 = (v) => Math.round(v * 10) / 10

export const fmtMoney = (v, cur = '€') =>
  `${cur}${Math.round(v).toLocaleString('en-US')}`
