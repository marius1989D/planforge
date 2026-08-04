// ============================================================
// PlanForge — PDF export
// ------------------------------------------------------------
// Draws the floor plan as real vectors at a computed architectural
// scale (page 1) plus a room/zone schedule table (page 2).
// All math is in mm; jsPDF's unit is set to 'mm', and our plan's
// y-down convention matches PDF's top-left/y-down page convention,
// so no axis flip is needed — only uniform scale + translate.
// ============================================================
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  wallPlanSpans, thickSegmentQuad, planBounds, pointAlongWall,
  polygonCentroid, polygonAreaM2, extractFootprints, footprintDimensions,
} from '../geometry/geo'
import { formatArea, formatLength } from '../model/units'
import { openingTags } from '../model/schema'
import { computeCostLines, fmtMoney } from '../geometry/quantities'
import { buildElevation, ELEVATION_DIRS } from '../geometry/elevationGeo'
import { FURNITURE_BY_TYPE } from '../model/furnitureLibrary'
import { THEMES } from '../model/themes'

const PAGE = { w: 297, h: 210 } // A4 landscape, mm
const MARGIN = 18
const TITLE_H = 26

// Preferred architectural scale denominators (1:N). We pick the
// smallest N (i.e. the largest, most legible drawing) that still
// fits the page with margins.
const SCALE_STEPS = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000]

function pickScale(bounds, availW, availH) {
  const widthMm = Math.max(1, bounds.maxX - bounds.minX)
  const heightMm = Math.max(1, bounds.maxY - bounds.minY)
  for (const n of SCALE_STEPS) {
    const drawW = widthMm / n
    const drawH = heightMm / n
    if (drawW <= availW && drawH <= availH) return n
  }
  return SCALE_STEPS[SCALE_STEPS.length - 1]
}

// plan mm -> page mm
function makeProjector(bounds, n, originX, originY) {
  const s = 1 / n
  return (p) => ({
    x: originX + (p.x - bounds.minX) * s,
    y: originY + (p.y - bounds.minY) * s,
  })
}

function polygonToLines(points) {
  // jsPDF `lines`: first point is the moveto (via x,y args), the rest
  // are deltas, and we append a closing delta back to the first point.
  const deltas = []
  for (let i = 1; i < points.length; i++) {
    deltas.push([points[i].x - points[i - 1].x, points[i].y - points[i - 1].y])
  }
  deltas.push([points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y])
  return deltas
}

function fillPolygon(doc, points, style = 'F') {
  if (points.length < 3) return
  doc.lines(polygonToLines(points), points[0].x, points[0].y, [1, 1], style, true)
}

function arcPoints(center, radius, startDeg, endDeg, segments = 10) {
  const pts = []
  for (let i = 0; i <= segments; i++) {
    const t = startDeg + ((endDeg - startDeg) * i) / segments
    const rad = (t * Math.PI) / 180
    pts.push({ x: center.x + radius * Math.cos(rad), y: center.y + radius * Math.sin(rad) })
  }
  return pts
}

function drawPolyline(doc, points) {
  for (let i = 1; i < points.length; i++) {
    doc.line(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y)
  }
}

// ---- door symbol honoring swing side + hinge end ------------------
function drawDoorSymbol(doc, wall, opening, project) {
  const swingSide = opening.swingSide || 1
  const wa = project(wall.start)
  const wb = project(wall.end)
  const wlen = Math.hypot(wb.x - wa.x, wb.y - wa.y) || 1
  const nx = ((wb.y - wa.y) / wlen) * swingSide
  const ny = (-(wb.x - wa.x) / wlen) * swingSide
  doc.setDrawColor(...rgb(SCALE_REF.door))
  doc.setLineWidth(0.15)
  const variant = opening.variant || 'single'

  if (variant === 'sliding') {
    const off = Math.max((wall.thickness / 4) / SCALE_REF.n, 0.5)
    const midT = (opening.from + opening.to) / 2
    const span = opening.to - opening.from
    const p1a = project(pointAlongWall(wall, opening.from))
    const p1b = project(pointAlongWall(wall, midT + span * 0.08))
    const p2a = project(pointAlongWall(wall, midT - span * 0.08))
    const p2b = project(pointAlongWall(wall, opening.to))
    doc.setLineWidth(0.3)
    doc.line(p1a.x + nx * off, p1a.y + ny * off, p1b.x + nx * off, p1b.y + ny * off)
    doc.line(p2a.x - nx * off, p2a.y - ny * off, p2b.x - nx * off, p2b.y - ny * off)
    return
  }

  const drawLeaf = (hMm, qMm, leafMm) => {
    const h = project(pointAlongWall(wall, hMm))
    const q = project(pointAlongWall(wall, qMm))
    const leafLen = leafMm / SCALE_REF.n
    const a1 = (Math.atan2(ny, nx) * 180) / Math.PI
    const a2 = (Math.atan2(q.y - h.y, q.x - h.x) * 180) / Math.PI
    const delta = ((a2 - a1) % 360 + 360) % 360
    const start = delta > 89 && delta < 91 ? a1 : a2
    doc.line(h.x, h.y, h.x + nx * leafLen, h.y + ny * leafLen)
    drawPolyline(doc, arcPoints(h, leafLen, start, start + 90, 12))
  }

  if (variant === 'double') {
    const span = opening.to - opening.from
    drawLeaf(opening.from, opening.to, span / 2)
    drawLeaf(opening.to, opening.from, span / 2)
    return
  }

  const hingeAt = opening.hinge === 'end' ? opening.to : opening.from
  const otherAt = opening.hinge === 'end' ? opening.from : opening.to
  drawLeaf(hingeAt, otherAt, opening.to - opening.from)
}

// ---- window symbol: two thin parallel lines across the gap -------
function drawWindowSymbol(doc, wall, opening, project) {
  const a = project(pointAlongWall(wall, opening.from))
  const b = project(pointAlongWall(wall, opening.to))
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const nx = (-dy / len) * (wall.thickness / 2 / SCALE_REF.n) * 0.6
  const ny = (dx / len) * (wall.thickness / 2 / SCALE_REF.n) * 0.6
  doc.setDrawColor(...rgb(SCALE_REF.window))
  doc.setLineWidth(0.25)
  doc.line(a.x + nx, a.y + ny, b.x + nx, b.y + ny)
  doc.line(a.x - nx, a.y - ny, b.x - nx, b.y - ny)
}

// window symbol needs the current scale (module-scoped ref, set per build);
// symbol colors ride along the same ref
const SCALE_REF = { n: 100, door: '#5a6b7a', window: '#5b9bd0' }

function drawScaleBar(doc, x, y, scaleN, P) {
  const niceMeters = scaleN <= 50 ? 1 : scaleN <= 150 ? 2 : scaleN <= 400 ? 5 : 10
  const segMm = (niceMeters * 1000) / scaleN
  doc.setFontSize(7)
  doc.setTextColor(...rgb(P.inkSoft))
  doc.text(`SCALE 1:${scaleN}`, x, y - 3)
  const inkRgb = rgb(P.ink)
  const bgRgb = rgb(P.pageBg)
  for (let i = 0; i < 5; i++) {
    doc.setFillColor(...(i % 2 === 0 ? inkRgb : bgRgb))
    doc.setDrawColor(...inkRgb)
    doc.rect(x + i * segMm, y, segMm, 2.5, 'FD')
  }
  doc.text('0', x, y + 6)
  doc.text(`${niceMeters * 5} m`, x + segMm * 5, y + 6, { align: 'right' })
}

function drawLegend(doc, x, y, P) {
  doc.setFontSize(7)
  doc.setTextColor(...rgb(P.roomText))
  let cy = y
  doc.setFillColor(...rgb(P.wall))
  doc.rect(x, cy - 2.2, 8, 2.6, 'F')
  doc.text('Wall', x + 11, cy)
  cy += 6
  doc.setDrawColor(...rgb(P.door)); doc.setLineWidth(0.15)
  doc.line(x, cy, x + 8, cy)
  doc.text('Door (with swing)', x + 11, cy + 0.6)
  cy += 6
  doc.setDrawColor(...rgb(P.window)); doc.setLineWidth(0.25)
  doc.line(x, cy - 0.6, x + 8, cy - 0.6)
  doc.line(x, cy + 0.6, x + 8, cy + 0.6)
  doc.text('Window', x + 11, cy)
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

// ============================================================
// buildPlanPdf(plan, theme) -> jsPDF document, two pages.
// Fully themed — a Blueprint export renders as a drafting sheet.
// ============================================================
export function buildPlanPdf(plan, theme = THEMES.daylight) {
  const P = theme.pdf
  const fill = (hex) => doc.setFillColor(...rgb(hex))
  const draw = (hex) => doc.setDrawColor(...rgb(hex))
  const text = (hex) => doc.setTextColor(...rgb(hex))
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  // ---- one drawing page per floor --------------------------------
  plan.floors.forEach((fl, floorIdx) => {
  if (floorIdx > 0) doc.addPage('a4', 'landscape')
  fill(P.pageBg)
  doc.rect(0, 0, PAGE.w, PAGE.h, 'F')

  // title block
  draw(P.line)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, TITLE_H, PAGE.w - MARGIN, TITLE_H)
  doc.setFontSize(16)
  text(P.ink)
  doc.setFont('helvetica', 'bold')
  doc.text(
    plan.floors.length > 1
      ? `${plan.name || 'Untitled Plan'} — ${fl.name}`
      : (plan.name || 'Untitled Plan'),
    MARGIN, 12,
  )
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  text(P.inkSoft)
  const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  doc.text(`Generated ${dateStr} · Units: ${plan.units === 'ft' ? 'Imperial (ft/in)' : 'Metric (mm/m)'} · PlanForge`, MARGIN, 19)
  doc.text('planforge.local', PAGE.w - MARGIN, 12, { align: 'right' })

  const availW = PAGE.w - MARGIN * 2
  const availH = PAGE.h - TITLE_H - MARGIN - 14 // room at bottom for scale bar/legend
  const showDims = plan.showDimensions !== false
  const rawBounds = planBounds(fl) // floor object has the same walls/rooms shape
  // dimension lines live ~600-1000mm outside the building — pad the
  // drawing bounds so they fit on the page
  const pad = showDims ? 1300 : 200
  const bounds = {
    minX: rawBounds.minX - pad, minY: rawBounds.minY - pad,
    maxX: rawBounds.maxX + pad, maxY: rawBounds.maxY + pad,
  }
  const scaleN = pickScale(bounds, availW, availH)
  SCALE_REF.n = scaleN
  SCALE_REF.door = P.door
  SCALE_REF.window = P.window
  const widthMm = (bounds.maxX - bounds.minX) / scaleN
  const heightMm = (bounds.maxY - bounds.minY) / scaleN
  const originX = MARGIN + (availW - widthMm) / 2
  const originY = TITLE_H + 10 + (availH - heightMm) / 2
  const project = makeProjector(bounds, scaleN, originX, originY)

  const autoRooms = fl.rooms.filter((r) => r.source === 'auto')
  const zones = fl.rooms.filter((r) => r.source === 'manual')
  const ROOM_FILLS = P.roomFills.map(rgb)
  const ZONE_STROKES = P.zoneColors.map(rgb)

  // room fills + labels
  autoRooms.forEach((r, i) => {
    const pts = r.polygon.map(project)
    doc.setFillColor(...ROOM_FILLS[i % ROOM_FILLS.length])
    fillPolygon(doc, pts, 'F')
    const c = project(polygonCentroid(r.polygon))
    doc.setFontSize(8.5)
    text(P.roomText)
    doc.text(r.name, c.x, c.y - 1, { align: 'center' })
    doc.setFontSize(7)
    doc.text(formatArea(r.area, plan.units), c.x, c.y + 3, { align: 'center' })
  })

  // zone outlines (dashed) + labels
  zones.forEach((r, i) => {
    const pts = r.polygon.map(project)
    const [cr, cg, cb] = ZONE_STROKES[i % ZONE_STROKES.length]
    doc.setDrawColor(cr, cg, cb)
    doc.setLineWidth(0.3)
    if (doc.setLineDashPattern) doc.setLineDashPattern([1.5, 1], 0)
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length]
      doc.line(a.x, a.y, b.x, b.y)
    }
    if (doc.setLineDashPattern) doc.setLineDashPattern([], 0)
    const c = project(polygonCentroid(r.polygon))
    doc.setFontSize(8)
    doc.setTextColor(cr, cg, cb)
    doc.text(`${r.name} (zone)`, c.x, c.y, { align: 'center' })
  })

  // furniture as light rotated rectangles with labels
  const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  for (const f of fl.furniture || []) {
    const r = (f.rotation * Math.PI) / 180
    const cos = Math.cos(r), sin = Math.sin(r)
    const hw = f.dimensions.w / 2, hd = f.dimensions.d / 2
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => ({
      x: f.position.x + x * cos - y * sin,
      y: f.position.y + x * sin + y * cos,
    }))
    const [cr, cg, cb] = hexToRgb(P.furnitureMono || FURNITURE_BY_TYPE[f.type]?.color || '#8d99ae')
    doc.setFillColor(cr, cg, cb)
    doc.setDrawColor(Math.max(0, cr - 40), Math.max(0, cg - 40), Math.max(0, cb - 40))
    doc.setLineWidth(0.2)
    fillPolygon(doc, corners.map(project), 'FD')
    const label = FURNITURE_BY_TYPE[f.type]?.label
    if (label) {
      const c = project(f.position)
      doc.setFontSize(5.5)
      text(P.roomText)
      doc.text(label, c.x, c.y + 1, { align: 'center' })
    }
  }

  // walls as filled quads per solid span, with door/window symbols
  fill(P.wall)
  for (const w of fl.walls) {
    const { solid, openings: ops } = wallPlanSpans(w, fl.openings)
    for (const s of solid) {
      const a = pointAlongWall(w, s.from)
      const b = pointAlongWall(w, s.to)
      const quad = thickSegmentQuad(a, b, w.thickness)
      if (!quad) continue
      fillPolygon(doc, quad.map(project), 'F')
    }
    for (const o of ops) {
      if (o.type === 'door') drawDoorSymbol(doc, w, o, project)
      else drawWindowSymbol(doc, w, o, project)
    }
  }

  // exterior dimension lines
  if (showDims) {
    const mmPerPageMm = scaleN
    for (const fp of extractFootprints(fl.walls)) {
      for (const d of footprintDimensions(fp)) {
        const a = project(d.a), b = project(d.b)
        const pa = project(d.pa), pb = project(d.pb)
        draw(P.dimensionExt)
        doc.setLineWidth(0.12)
        doc.line(a.x, a.y, pa.x + (d.nx * 100) / mmPerPageMm, pa.y + (d.ny * 100) / mmPerPageMm)
        doc.line(b.x, b.y, pb.x + (d.nx * 100) / mmPerPageMm, pb.y + (d.ny * 100) / mmPerPageMm)
        draw(P.dimension)
        doc.setLineWidth(0.25)
        doc.line(pa.x, pa.y, pb.x, pb.y)
        for (const t of [pa, pb]) {
          doc.line(t.x - 0.9, t.y + 0.9, t.x + 0.9, t.y - 0.9)
        }
        const lbl = project(d.label)
        doc.setFontSize(6.5)
        text(P.inkSoft)
        doc.text(formatLength(d.len, plan.units), lbl.x, lbl.y + 1, { align: 'center' })
      }
    }
  }

  // opening tags (D1/W1…) beside each symbol
  const tags = openingTags(fl.openings)
  for (const w of fl.walls) {
    for (const o of fl.openings.filter((x) => x.wallId === w.id)) {
      const mid = pointAlongWall(w, o.offset + o.width / 2)
      const wlen = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y) || 1
      const side = o.type === 'door' ? -(o.swingSide || 1) : 1
      const nx = ((w.end.y - w.start.y) / wlen) * side
      const ny = (-(w.end.x - w.start.x) / wlen) * side
      const reach = w.thickness / 2 + 260
      const pt = project({ x: mid.x + nx * reach, y: mid.y + ny * reach })
      doc.setFontSize(6)
      text(o.type === 'door' ? P.door : P.window)
      doc.text(tags.get(o.id) || '', pt.x, pt.y + 1, { align: 'center' })
    }
  }

  drawScaleBar(doc, MARGIN, PAGE.h - 9, scaleN, P)
  drawLegend(doc, PAGE.w - MARGIN - 55, PAGE.h - 16, P)
  // north arrow — plan top = North
  {
    const nx0 = PAGE.w - MARGIN - 5
    const ny0 = PAGE.h - 30
    doc.setDrawColor(...rgb(P.inkSoft))
    doc.setLineWidth(0.3)
    doc.line(nx0, ny0, nx0, ny0 - 7)
    doc.line(nx0, ny0 - 7, nx0 - 1.4, ny0 - 4.6)
    doc.line(nx0, ny0 - 7, nx0 + 1.4, ny0 - 4.6)
    doc.setFontSize(7)
    doc.setTextColor(...rgb(P.inkSoft))
    doc.text('N', nx0, ny0 - 8.5, { align: 'center' })
  }

  })

  // ---- page 2: schedule table -------------------------------------
  doc.addPage('a4', 'landscape')
  fill(P.pageBg)
  doc.rect(0, 0, PAGE.w, PAGE.h, 'F')
  doc.setFontSize(14)
  text(P.ink)
  doc.setFont('helvetica', 'bold')
  doc.text(`${plan.name || 'Untitled Plan'} — Room Schedule`, MARGIN, 16)
  doc.setFont('helvetica', 'normal')

  const allRooms = plan.floors.flatMap((f) => f.rooms.map((r) => ({ ...r, _floor: f.name })))
  const rows = allRooms.map((r) => {
    const xs = r.polygon.map((p) => p.x)
    const ys = r.polygon.map((p) => p.y)
    const wMm = Math.max(...xs) - Math.min(...xs)
    const dMm = Math.max(...ys) - Math.min(...ys)
    return [
      ...(plan.floors.length > 1 ? [r._floor] : []),
      r.name,
      r.source === 'manual' ? 'Open-plan zone' : 'Room',
      `${(wMm / 1000).toFixed(2)} × ${(dMm / 1000).toFixed(2)} m`,
      formatArea(r.area, plan.units),
    ]
  })
  const enclosedTotal = allRooms.filter((r) => r.source === 'auto').reduce((s, r) => s + r.area, 0)
  const zoneTotal = allRooms.filter((r) => r.source === 'manual').reduce((s, r) => s + r.area, 0)

  autoTable(doc, {
    startY: 24,
    head: [[...(plan.floors.length > 1 ? ['Floor'] : []), 'Room', 'Type', 'Bounding size', 'Area']],
    body: rows,
    foot: [
      [...(plan.floors.length > 1 ? [''] : []), '', '', 'Enclosed floor area', formatArea(enclosedTotal, plan.units)],
      [...(plan.floors.length > 1 ? [''] : []), '', '', 'Open-plan zone area', formatArea(zoneTotal, plan.units)],
    ],
    theme: 'grid',
    headStyles: { fillColor: rgb(P.tableHead), textColor: rgb(P.tableHeadText), fontStyle: 'bold' },
    footStyles: { fillColor: rgb(P.tableFoot), textColor: rgb(P.ink), fontStyle: 'bold' },
    styles: {
      fontSize: 9, cellPadding: 3,
      fillColor: rgb(P.pageBg), textColor: rgb(P.ink), lineColor: rgb(P.line),
    },
    margin: { left: MARGIN, right: MARGIN },
  })

  // door & window schedule — sizes live here, keyed by the plan tags
  const allOpenings = plan.floors.flatMap((f) => {
    const tm = openingTags(f.openings)
    return f.openings.map((o) => ({ ...o, _floor: f.name, _tag: tm.get(o.id) }))
  })
  if (allOpenings.length) {
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    text(P.ink)
    const y = (doc.lastAutoTable?.finalY || 60) + 12
    doc.text('Door & Window Schedule', MARGIN, y)
    doc.setFont('helvetica', 'normal')
    autoTable(doc, {
      startY: y + 4,
      head: [[...(plan.floors.length > 1 ? ['Floor'] : []), 'Tag', 'Type', 'Width × Height (mm)', 'Sill (mm)']],
      body: allOpenings.map((o) => [
        ...(plan.floors.length > 1 ? [o._floor] : []),
        o._tag,
        o.type === 'door'
          ? `Door${o.variant && o.variant !== 'single' ? ` (${o.variant})` : ''}`
          : 'Window',
        `${Math.round(o.width)} × ${Math.round(o.height)}`,
        o.type === 'window' ? `${Math.round(o.sillHeight)}` : '—',
      ]),
      theme: 'grid',
      headStyles: { fillColor: rgb(P.tableHead), textColor: rgb(P.tableHeadText), fontStyle: 'bold' },
      styles: {
        fontSize: 9, cellPadding: 3,
        fillColor: rgb(P.pageBg), textColor: rgb(P.ink), lineColor: rgb(P.line),
      },
      margin: { left: MARGIN, right: MARGIN },
    })
  }

  // ---- elevations page: 2×2 grid of the four facades ---------------
  {
    const elevs = ELEVATION_DIRS
      .map((d) => buildElevation(plan, d))
      .filter((e) => e && Number.isFinite(e.uMin) && e.uMax > e.uMin && e.height > 0)
    if (elevs.length === 4) {
      doc.addPage('a4', 'landscape')
      fill(P.pageBg)
      doc.rect(0, 0, PAGE.w, PAGE.h, 'F')
      doc.setFontSize(14)
      text(P.ink)
      doc.setFont('helvetica', 'bold')
      doc.text(`${plan.name || 'Untitled Plan'} — Elevations`, MARGIN, 14)
      doc.setFont('helvetica', 'normal')

      const gridTop = 22
      const gap = 8
      const cellW = (PAGE.w - MARGIN * 2 - gap) / 2
      const cellH = (PAGE.h - gridTop - MARGIN + 4 - gap) / 2
      const TITLES = { south: 'South elevation', north: 'North elevation', east: 'East elevation', west: 'West elevation' }

      elevs.forEach((e, i) => {
        const cx0 = MARGIN + (i % 2) * (cellW + gap)
        const cy0 = gridTop + Math.floor(i / 2) * (cellH + gap)
        doc.setFontSize(9)
        text(P.inkSoft)
        doc.text(TITLES[e.dir], cx0, cy0 + 3.5)

        const drawW = cellW - 4
        const drawH = cellH - 12
        const s = Math.min(drawW / (e.uMax - e.uMin), drawH / e.height)
        const groundY = cy0 + 7 + drawH
        const ox = cx0 + 2 + (drawW - (e.uMax - e.uMin) * s) / 2
        const X = (u) => ox + (u - e.uMin) * s
        const Y = (v) => groundY - v * s

        // ground line, a little past both ends
        doc.setDrawColor(...rgb(P.inkSoft))
        doc.setLineWidth(0.4)
        doc.line(X(e.uMin) - 4, groundY, X(e.uMax) + 4, groundY)

        // wall bands per floor
        for (const fl of e.floors) {
          for (const [u0, u1] of fl.intervals) {
            fill(P.pageBg)
            doc.setDrawColor(...rgb(P.wall))
            doc.setLineWidth(0.35)
            doc.rect(X(u0), Y(fl.v1), (u1 - u0) * s, (fl.v1 - fl.v0) * s, 'FD')
          }
        }
        // openings
        for (const o of e.openings) {
          const w = (o.u1 - o.u0) * s
          const h = (o.v1 - o.v0) * s
          if (o.type === 'window') {
            fill(P.window)
            doc.setDrawColor(...rgb(P.door))
            doc.setLineWidth(0.25)
            doc.rect(X(o.u0), Y(o.v1), w, h, 'FD')
            doc.line(X(o.u0), Y((o.v0 + o.v1) / 2), X(o.u1), Y((o.v0 + o.v1) / 2))
          } else {
            fill(P.door)
            doc.rect(X(o.u0), Y(o.v1), w, h, 'F')
          }
        }
        // roof
        if (e.roof?.kind === 'flat') {
          for (const [u0, u1] of e.roof.intervals) {
            fill(P.wall)
            doc.rect(X(u0), Y(e.roof.v1), (u1 - u0) * s, (e.roof.v1 - e.roof.v0) * s, 'F')
          }
        }
        if (e.roof?.kind === 'pitched' && e.roof.profile.length > 2) {
          const pts = e.roof.profile.map(([u, v]) => ({ x: X(u), y: Y(v) }))
          fill(P.pageBg)
          doc.setDrawColor(...rgb(P.wall))
          doc.setLineWidth(0.35)
          fillPolygon(doc, pts, 'FD')
        }
        // height note
        doc.setFontSize(7)
        text(P.inkSoft)
        doc.text(`${(e.height / 1000).toFixed(2)} m`, X(e.uMax) + 1.5, Y(e.height) + 2)
      })
    }
  }

  // ---- cost estimate page -----------------------------------------
  const cost = computeCostLines(plan)
  if (cost.lines.length) {
    doc.addPage('a4', 'landscape')
    fill(P.pageBg)
    doc.rect(0, 0, PAGE.w, PAGE.h, 'F')
    doc.setFontSize(14)
    text(P.ink)
    doc.setFont('helvetica', 'bold')
    doc.text(`${plan.name || 'Untitled Plan'} — Cost Estimate`, MARGIN, 16)
    doc.setFont('helvetica', 'normal')
    autoTable(doc, {
      startY: 24,
      head: [['Item', 'Quantity', 'Unit rate', 'Subtotal']],
      body: cost.lines.map((l) => [
        l.label,
        `${l.qty} ${l.unit}`,
        `${fmtMoney(l.rate, cost.currency)} / ${l.unit === 'pcs' ? 'pc' : l.unit}`,
        fmtMoney(l.subtotal, cost.currency),
      ]),
      foot: [['Estimated total', '', '', fmtMoney(cost.total, cost.currency)]],
      theme: 'grid',
      headStyles: { fillColor: rgb(P.tableHead), textColor: rgb(P.tableHeadText), fontStyle: 'bold' },
      footStyles: { fillColor: rgb(P.tableFoot), textColor: rgb(P.ink), fontStyle: 'bold' },
      styles: {
        fontSize: 9, cellPadding: 3,
        fillColor: rgb(P.pageBg), textColor: rgb(P.ink), lineColor: rgb(P.line),
      },
      margin: { left: MARGIN, right: MARGIN },
    })
    doc.setFontSize(8)
    text(P.inkSoft)
    doc.text(
      'Quantities are taken from the model (wall areas net of openings; pitched roofs slope-corrected). Rough guide only — verify with contractors.',
      MARGIN, (doc.lastAutoTable?.finalY || 60) + 8,
    )
  }

  return doc
}

export function exportPlanPdf(plan, theme) {
  const doc = buildPlanPdf(plan, theme)
  doc.save(`${(plan.name || 'plan').replace(/\s+/g, '_')}.pdf`)
}
