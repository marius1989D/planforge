import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { Stage, Layer, Line, Group, Text, Circle, Arc, Rect } from 'react-konva'
import ToolIcon from './ToolIcon'
import { usePlanStore, activeFloorOf } from '../store/planStore'
import { doorClearanceIssues } from '../geometry/clearanceGeo'
import {
  wallLength, wallAngle, midpoint, polygonCentroid, pointAlongWall, dist,
  snapToGeometry, pointToSegmentDist, pointInPolygon, snapPoint, offsetOnWall,
  pointInRotRect, extractFootprints, footprintDimensions,
} from '../geometry/geo'
import { formatLength, formatArea } from '../model/units'
import { DEFAULTS, openingTags } from '../model/schema'
import { FURNITURE_LIBRARY, FURNITURE_BY_TYPE } from '../model/furnitureLibrary'
import { getTheme } from '../model/themes'

// The stage is scaled/panned, so EVERYTHING renders in plan units (mm).
// Screen-constant sizes (text, handles, hairlines) divide by scale.
// All colors come from the active theme (src/model/themes.js).
const SNAP_PX = 14 // snap radius in screen px
const HIT_PX = 10  // hit-test slop in screen px

const deg = (rad) => (rad * 180) / Math.PI

export default function Editor2D() {
  const plan = usePlanStore((s) => s.plan)
  const floor = activeFloorOf(plan) // all drawing targets the ACTIVE floor
  const floorBelow = (plan.activeFloorIndex || 0) > 0
    ? plan.floors[plan.activeFloorIndex - 1] : null
  const selection = usePlanStore((s) => s.selection)
  const setSelection = usePlanStore((s) => s.setSelection)
  const addWallWithSplits = usePlanStore((s) => s.addWallWithSplits)
  const moveNodes = usePlanStore((s) => s.moveNodes)
  const moveRoom = usePlanStore((s) => s.moveRoom)
  const detachRoom = usePlanStore((s) => s.detachRoom)
  const translateWalls = usePlanStore((s) => s.translateWalls)
  const getRoomContents = usePlanStore((s) => s.getRoomContents)
  const translateRoomParts = usePlanStore((s) => s.translateRoomParts)
  const resizeFootprintEdge = usePlanStore((s) => s.resizeFootprintEdge)
  const furnishRoom = usePlanStore((s) => s.furnishRoom)
  const healWalls = usePlanStore((s) => s.healWalls)
  const deleteWall = usePlanStore((s) => s.deleteWall)
  const deleteManualRoom = usePlanStore((s) => s.deleteManualRoom)
  const addManualRoom = usePlanStore((s) => s.addManualRoom)
  const addOpening = usePlanStore((s) => s.addOpening)
  const updateOpening = usePlanStore((s) => s.updateOpening)
  const deleteOpening = usePlanStore((s) => s.deleteOpening)
  const addFurniture = usePlanStore((s) => s.addFurniture)
  const updateFurniture = usePlanStore((s) => s.updateFurniture)
  const deleteFurniture = usePlanStore((s) => s.deleteFurniture)
  const addStair = usePlanStore((s) => s.addStair)
  const updateStair = usePlanStore((s) => s.updateStair)
  const deleteStair = usePlanStore((s) => s.deleteStair)
  const snapshot = usePlanStore((s) => s.snapshot)
  const undo = usePlanStore((s) => s.undo)
  const redo = usePlanStore((s) => s.redo)
  const setPngExporter = usePlanStore((s) => s.setPngExporter)
  const duplicateSelected = usePlanStore((s) => s.duplicateSelected)
  const T = getTheme(usePlanStore((s) => s.theme))
  const ROOM_FILLS = T.plan.roomFills
  const ZONE_FILLS = T.plan.zoneColors

  const containerRef = useRef(null)
  const stageRef = useRef(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [viewport, setViewport] = useState({ scale: 0.05, x: 60, y: 60 })
  const tool = usePlanStore((s) => s.tool)
  const setTool = usePlanStore((s) => s.setTool)
  const loadSamplePlan = usePlanStore((s) => s.loadSamplePlan)
  const importOpener = usePlanStore((s) => s.importOpener)
  const [chainStart, setChainStart] = useState(null)
  const [zonePts, setZonePts] = useState([])
  const [cursor, setCursor] = useState(null) // { point, kind } for wall/zone tools
  const [openingPreview, setOpeningPreview] = useState(null) // { wallId, offset, width, type }
  const [armedItem, setArmedItem] = useState(null) // furniture library entry while placing
  const [armedRotation, setArmedRotation] = useState(0) // ghost rotation before drop
  const [drawThickness, setDrawThickness] = useState(DEFAULTS.wallThickness) // wall tool
  const dragRef = useRef(null)
  const pinchRef = useRef(null) // { dist, mid } while two fingers are down
  const [ctxMenu, setCtxMenu] = useState(null) // { x, y, target } screen coords
  const [dimEdit, setDimEdit] = useState(null) // { a, b, len, sx, sy }

  const px = (v) => v / viewport.scale

  // ---- resize ------------------------------------------------
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- register the PNG exporter (topbar button uses it) --------
  useEffect(() => {
    setPngExporter(() => stageRef.current?.toDataURL({ pixelRatio: 2 }))
    return () => setPngExporter(null)
  }, [setPngExporter])

  // ---- coordinate transforms ----------------------------------
  const toPlan = useCallback((screen) => ({
    x: (screen.x - viewport.x) / viewport.scale,
    y: (screen.y - viewport.y) / viewport.scale,
  }), [viewport])

  const pointerPlan = () => {
    const pos = stageRef.current?.getPointerPosition()
    return pos ? toPlan(pos) : null
  }

  const switchTool = setTool
  // tool can change from anywhere (palette, ⌘K, keyboard) — reset the
  // in-progress interaction state whenever it does
  useEffect(() => {
    setChainStart(null)
    setZonePts([])
    setOpeningPreview(null)
    if (tool !== 'furniture') { setArmedItem(null); setArmedRotation(0) }
    if (tool !== 'select') setSelection(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  // ---- keyboard -----------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && k === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo(); else undo()
        return
      }
      if ((e.metaKey || e.ctrlKey) && k === 'd') {
        e.preventDefault()
        duplicateSelected()
        return
      }
      if (e.key === 'Escape') {
        setChainStart(null); setZonePts([]); setOpeningPreview(null); setSelection(null)
      } else if (k === 'v') switchTool('select')
      else if (k === 'w') switchTool('wall')
      else if (k === 'z') switchTool('zone')
      else if (k === 'd') switchTool('door')
      else if (k === 'n') switchTool('window')
      else if (k === 'f') switchTool('furniture')
      else if (k === 's') switchTool('stair')
      else if (k === 'm') switchTool('measure')
      else if (k === 'r') {
        if (tool === 'furniture' && armedItem) {
          setArmedRotation((r) => (r + 90) % 360)
        } else if (selection?.type === 'furniture') {
          const item = activeFloorOf(usePlanStore.getState().plan).furniture.find((x) => x.id === selection.id)
          if (item) updateFurniture(item.id, { rotation: (item.rotation + 90) % 360 })
        } else if (selection?.type === 'stair') {
          const st = activeFloorOf(usePlanStore.getState().plan).stairs.find((x) => x.id === selection.id)
          if (st) updateStair(st.id, { rotation: (st.rotation + 90) % 360 })
        }
      }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        if (selection.type === 'wall') deleteWall(selection.id)
        if (selection.type === 'zone') deleteManualRoom(selection.id)
        if (selection.type === 'opening') deleteOpening(selection.id)
        if (selection.type === 'furniture') deleteFurniture(selection.id)
        if (selection.type === 'stair') deleteStair(selection.id)
        setSelection(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection, tool, armedItem, deleteWall, deleteManualRoom, deleteOpening, deleteFurniture, deleteStair, updateFurniture, updateStair, undo, redo, duplicateSelected, setSelection])

  // ---- wheel: plain scroll pans; pinch / Ctrl-Cmd+scroll zooms ---
  const onWheel = (e) => {
    e.evt.preventDefault()
    const isZoomGesture = e.evt.ctrlKey || e.evt.metaKey
    if (!isZoomGesture) {
      setViewport((v) => ({ ...v, x: v.x - e.evt.deltaX, y: v.y - e.evt.deltaY }))
      return
    }
    const pointer = stageRef.current.getPointerPosition()
    const old = viewport.scale
    // Middle-ground zoom: exponential on the raw delta so trackpad pinch
    // (small, frequent deltas → ~1-4% each, smooth) and mouse notches
    // (large deltas → clamped to ~12%) both feel right.
    const factor = Math.min(1.12, Math.max(0.89, Math.exp(-e.evt.deltaY * 0.005)))
    const scale = Math.min(0.5, Math.max(0.006, old * factor))
    const wx = (pointer.x - viewport.x) / old
    const wy = (pointer.y - viewport.y) / old
    setViewport({ scale, x: pointer.x - wx * scale, y: pointer.y - wy * scale })
  }

  // ---- hit testing ---------------------------------------------
  const hitWall = (p) => {
    let best = null
    for (const w of floor.walls) {
      const d = pointToSegmentDist(p, w.start, w.end)
      const threshold = Math.max(w.thickness / 2, px(HIT_PX))
      if (d <= threshold && (!best || d < best.d)) best = { d, id: w.id }
    }
    return best?.id ?? null
  }
  const hitOpening = (p) => {
    for (const o of floor.openings) {
      const wall = floor.walls.find((w) => w.id === o.wallId)
      if (!wall) continue
      const a = pointAlongWall(wall, o.offset)
      const b = pointAlongWall(wall, o.offset + o.width)
      if (pointToSegmentDist(p, a, b) <= Math.max(wall.thickness / 2, px(HIT_PX))) {
        return o.id
      }
    }
    return null
  }
  const hitFurniture = (p) => {
    for (let i = floor.furniture.length - 1; i >= 0; i--) {
      const f = floor.furniture[i]
      if (pointInRotRect(p, f.position, f.dimensions.w, f.dimensions.d, f.rotation)) {
        return f.id
      }
    }
    return null
  }
  const hitStair = (p) => {
    for (let i = floor.stairs.length - 1; i >= 0; i--) {
      const st = floor.stairs[i]
      if (pointInRotRect(p, st.position, st.width, st.length, st.rotation)) return st.id
    }
    return null
  }
  // Zones test BEFORE rooms: a zone drawn inside a room (the primary
  // open-plan use case) is the more specific target — matching the
  // render order, where zones sit on top of room fills. Click the room
  // outside the zone (or a wall) to grab the room itself.
  const hitRoomOrZone = (p) => {
    const zones = floor.rooms.filter((r) => r.source === 'manual')
    for (let i = zones.length - 1; i >= 0; i--) {
      if (pointInPolygon(p, zones[i].polygon)) return { type: 'zone', id: zones[i].id }
    }
    const autoRooms = floor.rooms.filter((r) => r.source === 'auto')
    for (let i = autoRooms.length - 1; i >= 0; i--) {
      if (pointInPolygon(p, autoRooms[i].polygon)) return { type: 'room', id: autoRooms[i].id }
    }
    return null
  }
  const nearestWall = (p) => {
    let best = null
    for (const w of floor.walls) {
      const d = pointToSegmentDist(p, w.start, w.end)
      if (d <= px(SNAP_PX) * 1.6 && (!best || d < best.d)) best = { d, wall: w }
    }
    return best?.wall ?? null
  }

  // Which side of the wall is "inside a room"? Probes both faces at the
  // opening midpoint. Returns +1 / -1 (wall-normal sign) or null if
  // ambiguous (both faces are rooms, or neither).
  const detectSwingSide = (wall, offset, width) => {
    const mid = pointAlongWall(wall, offset + width / 2)
    const len = wallLength(wall)
    if (len === 0) return null
    const nx = (wall.end.y - wall.start.y) / len
    const ny = -(wall.end.x - wall.start.x) / len
    const reach = wall.thickness / 2 + 150
    const rooms = floor.rooms.filter((r) => r.source === 'auto')
    const inRoom = (pt) => rooms.some((r) => pointInPolygon(pt, r.polygon))
    const plus = inRoom({ x: mid.x + nx * reach, y: mid.y + ny * reach })
    const minus = inRoom({ x: mid.x - nx * reach, y: mid.y - ny * reach })
    if (plus && !minus) return 1
    if (minus && !plus) return -1
    return null // interior door or free wall — default, flippable in panel
  }

  // opening preview for the door/window tools: centered on the cursor's
  // projection, clamped inside the wall, door swing auto-detected
  const computeOpeningPreview = (p, type) => {
    const wall = nearestWall(p)
    if (!wall) return null
    const width = type === 'door' ? DEFAULTS.doorWidth : DEFAULTS.windowWidth
    const len = wallLength(wall)
    if (len < width + 100) return null // wall too short
    const center = offsetOnWall(wall, p)
    const offset = Math.max(0, Math.min(center - width / 2, len - width))
    const swingSide = type === 'door' ? (detectSwingSide(wall, offset, width) ?? 1) : 0
    return { wallId: wall.id, offset, width, type, swingSide, hinge: 'start' }
  }

  // ---- pointer handlers -----------------------------------------
  const onMouseDown = (e) => {
    const p = pointerPlan()
    if (!p) return
    const middle = e.evt.button === 1
    const right = e.evt.button === 2

    if (middle) {
      dragRef.current = { kind: 'pan', last: stageRef.current.getPointerPosition() }
      return
    }

    if (tool === 'wall') {
      if (right) { setChainStart(null); return }
      const snap = snapToGeometry(p, floor.walls, plan.gridSize, px(SNAP_PX))
      if (!chainStart) {
        setChainStart(snap.point)
      } else if (dist(chainStart, snap.point) > plan.gridSize / 2) {
        addWallWithSplits({ start: chainStart, end: snap.point, thickness: drawThickness })
        setChainStart(snap.point)
      }
      return
    }

    if (tool === 'zone') {
      if (right) { setZonePts([]); return }
      const pt = snapPoint(p, plan.gridSize)
      if (zonePts.length >= 3 && dist(pt, zonePts[0]) <= px(SNAP_PX)) {
        const count = floor.rooms.filter((r) => r.source === 'manual').length
        addManualRoom({ name: `Zone ${count + 1}`, polygon: zonePts })
        setZonePts([])
      } else {
        setZonePts([...zonePts, pt])
      }
      return
    }

    if (tool === 'door' || tool === 'window') {
      if (right) return
      const preview = computeOpeningPreview(p, tool)
      if (preview) {
        addOpening(preview)
        setOpeningPreview(null)
      }
      return
    }

    if (tool === 'measure') {
      if (right) { setMeasure(null); switchTool('select'); return }
      const p2 = snapToGeometry(p, floor.walls, viewport.scale) ?? { point: snapPoint(p, plan.gridSize) }
      setMeasure((m) => (!m || m.b ? { a: p2.point, b: null } : { ...m, b: p2.point }))
      return
    }
    if (tool === 'stair') {
      if (right) { switchTool('select'); return }
      const id = addStair({ position: snapPoint(p, plan.gridSize), rotation: armedRotation })
      setArmedRotation(0)
      setTool('select')
      setSelection({ type: 'stair', id })
      return
    }
    if (tool === 'furniture') {
      if (right) { setArmedItem(null); return }
      if (armedItem) {
        const id = addFurniture({
          type: armedItem.type,
          position: snapPoint(p, plan.gridSize),
          rotation: armedRotation,
          dimensions: { w: armedItem.w, d: armedItem.d, h: armedItem.h },
        })
        // place once → jump to Select with the new item selected, ready
        // to fine-tune. Shift-click keeps placing (multiples).
        if (!e.evt.shiftKey) {
          setArmedItem(null)
          setArmedRotation(0)
          setTool('select')
          setSelection({ type: 'furniture', id })
        }
      }
      return
    }

    if (right && tool === 'select') return // handled by onContextMenu

    // ---- select tool: opening → furniture → wall → room/zone → pan ----
    const openingId = hitOpening(p)
    if (openingId) {
      setSelection({ type: 'opening', id: openingId })
      const o = floor.openings.find((x) => x.id === openingId)
      snapshot() // one undo step for the whole slide
      dragRef.current = { kind: 'opening', id: openingId, wallId: o.wallId }
      return
    }
    const furnId = hitFurniture(p)
    if (furnId) {
      setSelection({ type: 'furniture', id: furnId })
      snapshot()
      dragRef.current = { kind: 'furn', id: furnId }
      return
    }
    const stairId = hitStair(p)
    if (stairId) {
      setSelection({ type: 'stair', id: stairId })
      snapshot()
      dragRef.current = { kind: 'stair', id: stairId }
      return
    }
    const wallId = hitWall(p)
    if (wallId) {
      setSelection({ type: 'wall', id: wallId })
      const wall = floor.walls.find((w) => w.id === wallId)
      snapshot()
      dragRef.current = {
        kind: 'wall', id: wallId, last: snapPoint(p, plan.gridSize),
        s: { ...wall.start }, e: { ...wall.end },
      }
      return
    }
    const hit = hitRoomOrZone(p)
    if (hit) {
      setSelection(hit)
      snapshot()
      dragRef.current = {
        kind: 'room', id: hit.id, isZone: hit.type === 'zone',
        last: snapPoint(p, plan.gridSize), wallIds: null,
      }
      return
    }
    setSelection(null)
    dragRef.current = { kind: 'pan', last: stageRef.current.getPointerPosition() }
  }

  const onMouseMove = () => {
    const p = pointerPlan()
    if (!p) return
    const drag = dragRef.current

    if (drag?.kind === 'pan') {
      const pos = stageRef.current.getPointerPosition()
      setViewport((v) => ({ ...v, x: v.x + pos.x - drag.last.x, y: v.y + pos.y - drag.last.y }))
      drag.last = pos
      return
    }
    if (drag?.kind === 'node') {
      const others = floor.walls.filter((w) =>
        dist(w.start, drag.point) > 1 && dist(w.end, drag.point) > 1)
      const snap = snapToGeometry(p, others, plan.gridSize, px(SNAP_PX))
      if (dist(snap.point, drag.point) > 0.5) {
        moveNodes([{ from: drag.point, to: snap.point }])
        drag.point = snap.point
      }
      setCursor(snap)
      return
    }
    if (drag?.kind === 'wall') {
      const cur = snapPoint(p, plan.gridSize)
      const dx = cur.x - drag.last.x
      const dy = cur.y - drag.last.y
      if (dx !== 0 || dy !== 0) {
        // Move ONLY this wall, so it detaches from whatever shared its corners
        // — you reshape one wall at a time. (moveNodes would drag every wall
        // meeting at those corners along with it.) Junctions re-form on drop
        // via healWalls if you land an endpoint back on another wall.
        translateWalls([drag.id], dx, dy)
        drag.last = cur
      }
      return
    }
    if (drag?.kind === 'room') {
      const cur = snapPoint(p, plan.gridSize)
      const dx = cur.x - drag.last.x
      const dy = cur.y - drag.last.y
      if (dx !== 0 || dy !== 0) {
        if (drag.isZone) {
          moveRoom(drag.id, dx, dy)
        } else {
          // On first real movement: capture the room's contents (BEFORE
          // detaching — detachment changes the room's id), then detach.
          // Every frame after moves walls + furniture + zones in one
          // commit so the whole gesture is a single undo step.
          if (!drag.parts) {
            const contents = getRoomContents(drag.id)
            const wallIds = detachRoom(drag.id) || []
            drag.parts = { wallIds, ...contents }
          }
          translateRoomParts(drag.parts, dx, dy)
        }
        drag.last = cur
      }
      return
    }
    if (drag?.kind === 'stair') {
      const cur = snapPoint(p, plan.gridSize)
      const st = floor.stairs.find((x) => x.id === drag.id)
      if (st && (st.position.x !== cur.x || st.position.y !== cur.y)) {
        updateStair(drag.id, { position: cur }, { history: false })
      }
      return
    }
    if (drag?.kind === 'furn') {
      const cur = snapPoint(p, plan.gridSize)
      const f = floor.furniture.find((x) => x.id === drag.id)
      if (f && (f.position.x !== cur.x || f.position.y !== cur.y)) {
        updateFurniture(drag.id, { position: cur }, { history: false })
      }
      return
    }
    if (drag?.kind === 'opening') {
      const o = floor.openings.find((x) => x.id === drag.id)
      const wall = floor.walls.find((w) => w.id === drag.wallId)
      if (o && wall) {
        const len = wallLength(wall)
        const center = offsetOnWall(wall, p)
        const offset = Math.max(0, Math.min(center - o.width / 2, len - o.width))
        if (Math.abs(offset - o.offset) > 0.5) updateOpening(o.id, { offset }, { history: false })
      }
      return
    }
    if (drag?.kind === 'openend') {
      const o = floor.openings.find((x) => x.id === drag.id)
      const wall = floor.walls.find((w) => w.id === drag.wallId)
      if (o && wall) {
        const len = wallLength(wall)
        const proj = Math.round(offsetOnWall(wall, p) / 50) * 50
        if (drag.end === 'a') {
          const endPos = o.offset + o.width
          const newOffset = Math.max(0, Math.min(proj, endPos - 300))
          updateOpening(o.id, { offset: newOffset, width: endPos - newOffset }, { history: false })
        } else {
          const newEnd = Math.max(o.offset + 300, Math.min(proj, len))
          updateOpening(o.id, { width: newEnd - o.offset }, { history: false })
        }
      }
      return
    }
    if (drag?.kind === 'furnresize') {
      const f = floor.furniture.find((x) => x.id === drag.id)
      if (f) {
        const { position, rotation } = drag.orig
        const rad = (-rotation * Math.PI) / 180
        // pointer into the item's original local frame
        const dx = p.x - position.x
        const dy = p.y - position.y
        const lx = dx * Math.cos(rad) - dy * Math.sin(rad)
        const ly = dx * Math.sin(rad) + dy * Math.cos(rad)
        // opposite corner (fixed anchor) in local coords
        const sx = drag.signX, sy = drag.signY
        const ox = -sx * drag.orig.dimensions.w / 2
        const oy = -sy * drag.orig.dimensions.d / 2
        const snap50 = (v) => Math.max(100, Math.round(v / 50) * 50)
        const newW = snap50(Math.abs(lx - ox))
        const newD = snap50(Math.abs(ly - oy))
        // new center in local coords, then back to world
        const cx = ox + (sx * newW) / 2
        const cy = oy + (sy * newD) / 2
        const wrad = (rotation * Math.PI) / 180
        const wx = position.x + cx * Math.cos(wrad) - cy * Math.sin(wrad)
        const wy = position.y + cx * Math.sin(wrad) + cy * Math.cos(wrad)
        updateFurniture(drag.id, {
          position: { x: wx, y: wy },
          dimensions: { ...drag.orig.dimensions, w: newW, d: newD },
        }, { history: false })
      }
      return
    }

    if (tool === 'wall') {
      setCursor(snapToGeometry(p, floor.walls, plan.gridSize, px(SNAP_PX)))
    } else if (tool === 'zone') {
      setCursor({ point: snapPoint(p, plan.gridSize), kind: 'grid' })
    } else if (tool === 'door' || tool === 'window') {
      setCursor(null)
      setOpeningPreview(computeOpeningPreview(p, tool))
    } else if (tool === 'furniture') {
      setCursor(armedItem ? { point: snapPoint(p, plan.gridSize), kind: 'grid' } : null)
    } else if (tool === 'stair') {
      setCursor({ point: snapPoint(p, plan.gridSize), kind: 'grid' })
    } else if (tool === 'measure') {
      const p2 = snapToGeometry(p, floor.walls, viewport.scale) ?? { point: snapPoint(p, plan.gridSize) }
      setCursor({ point: p2.point, kind: 'grid' })
      setMeasure((m) => (m && !m.b ? { ...m, live: p2.point } : m))
    } else {
      setCursor(null)
      const container = stageRef.current?.container()
      if (container) {
        const over = hitOpening(p) || hitFurniture(p) || hitWall(p) || hitRoomOrZone(p)
        container.style.cursor = over ? 'move' : ''
      }
    }
  }

  const onMouseUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    // dragging can land walls on top of / across other walls — heal the
    // graph once at drag-end so junctions form and rooms re-detect
    if (drag.kind === 'node' || drag.kind === 'wall' ||
        (drag.kind === 'room' && !drag.isZone)) {
      healWalls()
      // healing/detaching changes room ids — refresh a room selection
      if (drag.kind === 'room') {
        const p = pointerPlan()
        setSelection(p ? hitRoomOrZone(p) : null)
      }
    }
  }

  // ---- touch: 1 finger reuses the mouse logic, 2 fingers pinch-zoom + pan --
  // Konva populates getPointerPosition() for touch, and the mouse handlers key
  // off e.evt.button (absent on touch → treated as a plain left press), so a
  // single finger can share the exact same draw/select/drag code path.
  const touchDist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  const touchMid = (a, b, rect) => ({
    x: (a.clientX + b.clientX) / 2 - rect.left,
    y: (a.clientY + b.clientY) / 2 - rect.top,
  })

  const onTouchStart = (e) => {
    const t = e.evt.touches
    if (t.length >= 2) {
      e.evt.preventDefault()
      dragRef.current = null // abandon any single-finger interaction
      const rect = stageRef.current.container().getBoundingClientRect()
      pinchRef.current = { dist: touchDist(t[0], t[1]), mid: touchMid(t[0], t[1], rect) }
      return
    }
    // preventDefault suppresses the browser's compatibility mouse events, which
    // would otherwise re-fire onMouseDown and double-handle every tap.
    e.evt.preventDefault()
    onMouseDown(e)
  }

  const onTouchMove = (e) => {
    const t = e.evt.touches
    if (t.length >= 2 && pinchRef.current) {
      e.evt.preventDefault()
      const rect = stageRef.current.container().getBoundingClientRect()
      const dist = touchDist(t[0], t[1])
      const mid = touchMid(t[0], t[1], rect)
      const prev = pinchRef.current
      setViewport((v) => {
        const scale = Math.min(0.5, Math.max(0.006, v.scale * (dist / prev.dist)))
        // anchor the world point under the old midpoint, then re-place it at the
        // new midpoint — one expression that both zooms and two-finger pans.
        const wx = (prev.mid.x - v.x) / v.scale
        const wy = (prev.mid.y - v.y) / v.scale
        return { scale, x: mid.x - wx * scale, y: mid.y - wy * scale }
      })
      pinchRef.current = { dist, mid }
      return
    }
    if (!pinchRef.current) {
      e.evt.preventDefault()
      onMouseMove()
    }
  }

  const onTouchEnd = (e) => {
    // lifting one of two fingers ends the pinch; a fresh drag starts on the
    // next touchstart, which avoids a jump from the leftover finger.
    if (e.evt.touches.length < 2) pinchRef.current = null
    if (e.evt.touches.length === 0) onMouseUp()
  }

  const onDblClick = () => {
    if (tool === 'wall') setChainStart(null)
    if (tool === 'zone' && zonePts.length >= 3) {
      const count = floor.rooms.filter((r) => r.source === 'manual').length
      addManualRoom({ name: `Zone ${count + 1}`, polygon: zonePts })
      setZonePts([])
    }
  }

  // Right-click in Select: contextual pill menu for whatever's under
  // the cursor. Draw tools keep right-click = cancel (handled above).
  const onContextMenu = (e) => {
    e.preventDefault()
    if (tool !== 'select') return
    const rect = containerRef.current.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const p = toPlan({ x: sx, y: sy })
    const openingId = hitOpening(p)
    const furnId = !openingId && hitFurniture(p)
    const stairId = !openingId && !furnId && hitStair(p)
    const wallId = !openingId && !furnId && !stairId && hitWall(p)
    const rz = !openingId && !furnId && !stairId && !wallId && hitRoomOrZone(p)
    let target = null
    if (openingId) target = { type: 'opening', id: openingId }
    else if (furnId) target = { type: 'furniture', id: furnId }
    else if (stairId) target = { type: 'stair', id: stairId }
    else if (wallId) target = { type: 'wall', id: wallId }
    else if (rz) target = rz
    if (!target) { setCtxMenu(null); return }
    setSelection(target)
    setCtxMenu({ x: sx, y: sy, target })
  }
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    const esc = (e) => { if (e.key === 'Escape') setCtxMenu(null) }
    window.addEventListener('mousedown', close)
    window.addEventListener('wheel', close, { passive: true })
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('wheel', close)
      window.removeEventListener('keydown', esc)
    }
  }, [ctxMenu])

  const ctxItems = () => {
    const t = ctxMenu.target
    const items = []
    if (t.type === 'opening') {
      const o = floor.openings.find((x) => x.id === t.id)
      if (o?.type === 'door') {
        items.push(
          { label: 'Flip swing', run: () => updateOpening(o.id, { swingSide: (o.swingSide || 1) * -1 }) },
          { label: 'Flip hinge', run: () => updateOpening(o.id, { hinge: o.hinge === 'end' ? 'start' : 'end' }) },
        )
      }
    }
    if (t.type === 'furniture') {
      items.push({
        label: 'Rotate 90°',
        run: () => {
          const f = floor.furniture.find((x) => x.id === t.id)
          if (f) updateFurniture(f.id, { rotation: (f.rotation + 90) % 360 })
        },
      })
    }
    if (t.type === 'stair') {
      items.push({
        label: 'Rotate 90°',
        run: () => {
          const st = floor.stairs.find((x) => x.id === t.id)
          if (st) updateStair(st.id, { rotation: (st.rotation + 90) % 360 })
        },
      })
    }
    if (t.type === 'room') {
      for (const [k, label] of [['bedroom', 'Furnish: Bedroom'], ['living', 'Furnish: Living'], ['kitchen', 'Furnish: Kitchen']]) {
        items.push({ label, run: () => furnishRoom(t.id, k) })
      }
    }
    items.push({ label: 'Duplicate', run: duplicateSelected })
    if (t.type !== 'room') {
      items.push({
        label: 'Delete', danger: true,
        run: () => {
          if (t.type === 'wall') deleteWall(t.id)
          if (t.type === 'opening') deleteOpening(t.id)
          if (t.type === 'zone') deleteManualRoom(t.id)
          if (t.type === 'furniture') deleteFurniture(t.id)
          if (t.type === 'stair') deleteStair(t.id)
          setSelection(null)
        },
      })
    }
    return items
  }

  // 2D stair symbol: outline + treads + UP arrow, rotates like furniture
  const renderStair = (st) => {
    const isSel = selection?.type === 'stair' && selection.id === st.id
    const stroke = isSel ? T.plan.wallSelected : T.plan.door
    const treads = Math.max(2, Math.round(st.length / 250))
    const lines = []
    for (let i = 1; i < treads; i++) {
      const y = -st.length / 2 + (st.length / treads) * i
      lines.push(<Line key={i} points={[-st.width / 2, y, st.width / 2, y]}
        stroke={stroke} strokeWidth={px(1)} />)
    }
    return (
      <Group key={st.id} x={st.position.x} y={st.position.y} rotation={st.rotation}>
        <Rect x={-st.width / 2} y={-st.length / 2} width={st.width} height={st.length}
          stroke={stroke} strokeWidth={px(isSel ? 2.2 : 1.5)}
          fill={isSel ? T.plan.wallSelected + '18' : 'transparent'} />
        {lines}
        <Line points={[0, st.length / 2 - px(6), 0, -st.length / 2 + px(14)]}
          stroke={stroke} strokeWidth={px(1.4)} />
        <Line points={[-px(5), -st.length / 2 + px(22), 0, -st.length / 2 + px(14), px(5), -st.length / 2 + px(22)]}
          stroke={stroke} strokeWidth={px(1.4)} />
        {(viewport.scale > 0.03 || isSel) && (
          <Text x={-60 / viewport.scale} y={st.length / 2 + px(6)}
            width={120 / viewport.scale} align="center"
            text={`UP · ${(st.width / 1000).toFixed(1)}×${(st.length / 1000).toFixed(1)} m`}
            fontSize={fontSize * 0.68} fill={T.plan.furnitureText} />
        )}
      </Group>
    )
  }

  const startNodeDrag = (point) => (e) => {
    e.cancelBubble = true
    snapshot()
    dragRef.current = { kind: 'node', point: { ...point } }
  }
  const startOpeningEndDrag = (opening, end) => (e) => {
    e.cancelBubble = true
    snapshot()
    dragRef.current = { kind: 'openend', id: opening.id, wallId: opening.wallId, end }
  }
  const startFurnResize = (item, signX, signY) => (e) => {
    e.cancelBubble = true
    snapshot()
    dragRef.current = {
      kind: 'furnresize', id: item.id, signX, signY,
      orig: {
        position: { ...item.position },
        rotation: item.rotation,
        dimensions: { ...item.dimensions },
      },
    }
  }

  // ---- grid in plan space, covering the visible rect --------------
  const gridLines = useMemo(() => {
    const lines = []
    const topLeft = toPlan({ x: 0, y: 0 })
    const botRight = toPlan({ x: size.w, y: size.h })
    const major = 1000
    const minor = plan.gridSize * 5
    const showMinor = viewport.scale >= 0.02
    const step = showMinor ? minor : major
    const x0 = Math.floor(topLeft.x / step) * step
    const y0 = Math.floor(topLeft.y / step) * step
    for (let x = x0; x <= botRight.x; x += step) {
      lines.push({ points: [x, topLeft.y, x, botRight.y], major: Math.abs(x % major) < 1 })
    }
    for (let y = y0; y <= botRight.y; y += step) {
      lines.push({ points: [topLeft.x, y, botRight.x, y], major: Math.abs(y % major) < 1 })
    }
    return lines
  }, [size, viewport, plan.gridSize, toPlan])

  const autoRooms = floor.rooms.filter((r) => r.source === 'auto')
  const zones = floor.rooms.filter((r) => r.source === 'manual')
  // door-swing warnings: furniture ids blocking any swinging door
  const blockedFurnIds = useMemo(() => {
    const ids = new Set()
    for (const issue of doorClearanceIssues(floor)) {
      for (const id of issue.furnitureIds) ids.add(id)
    }
    return ids
  }, [floor.walls, floor.openings, floor.furniture])
  const [measure, setMeasure] = useState(null) // { a, b|null }
  useEffect(() => { if (tool !== 'measure') setMeasure(null) }, [tool])

  const dimensions = useMemo(() => {
    if (plan.showDimensions === false) return []
    return extractFootprints(floor.walls).flatMap((fp) => footprintDimensions(fp))
  }, [floor.walls, plan.showDimensions])
  const selectedWall = selection?.type === 'wall'
    ? floor.walls.find((w) => w.id === selection.id) : null
  const selectedOpening = selection?.type === 'opening'
    ? floor.openings.find((o) => o.id === selection.id) : null
  const selectedFurnitureItem = selection?.type === 'furniture'
    ? floor.furniture.find((f) => f.id === selection.id) : null
  const tags = useMemo(() => openingTags(floor.openings), [floor.openings])
  const fontSize = 12 / viewport.scale
  const hair = 1 / viewport.scale
  const flat = (poly) => poly.flatMap((p) => [p.x, p.y])

  // door swing arc honoring swing side + hinge end: quarter circle
  // between the leaf direction (wall normal × swingSide) and the wall
  // direction toward the far jamb, whichever 90° span connects them
  const renderDoor = (wall, o, key, opts = {}) => {
    const { offset, width } = o
    const swingSide = o.swingSide || 1
    const hingeAt = o.hinge === 'end' ? offset + width : offset
    const otherAt = o.hinge === 'end' ? offset : offset + width
    const h = pointAlongWall(wall, hingeAt)
    const q = pointAlongWall(wall, otherAt)
    const len = wallLength(wall) || 1
    const nx = ((wall.end.y - wall.start.y) / len) * swingSide
    const ny = (-(wall.end.x - wall.start.x) / len) * swingSide
    const a1 = deg(Math.atan2(ny, nx)) // leaf direction
    const a2 = deg(Math.atan2(q.y - h.y, q.x - h.x)) // toward far jamb
    const delta = ((a2 - a1) % 360 + 360) % 360
    const rotation = delta === 90 ? a1 : a2
    const tip = { x: h.x + width * nx, y: h.y + width * ny }
    const stroke = opts.selected ? T.plan.wallSelected : T.plan.door
    const aPt = pointAlongWall(wall, offset)
    const bPt = pointAlongWall(wall, offset + width)
    const gap = (
      <Line points={[aPt.x, aPt.y, bPt.x, bPt.y]}
        stroke={T.plan.gap}
        strokeWidth={Math.max(wall.thickness, px(2)) - px(1)}
        lineCap="butt" />
    )
    const variant = o.variant || 'single'

    if (variant === 'sliding') {
      // two overlapping panels offset to either face — classic symbol
      const off = Math.max(wall.thickness / 4, px(2))
      const midT = offset + width / 2
      const p1a = pointAlongWall(wall, offset)
      const p1b = pointAlongWall(wall, midT + width * 0.08)
      const p2a = pointAlongWall(wall, midT - width * 0.08)
      const p2b = pointAlongWall(wall, offset + width)
      return (
        <Group key={key} opacity={opts.preview ? 0.5 : 1}>
          {gap}
          <Line points={[p1a.x + nx * off, p1a.y + ny * off, p1b.x + nx * off, p1b.y + ny * off]}
            stroke={stroke} strokeWidth={px(2)} />
          <Line points={[p2a.x - nx * off, p2a.y - ny * off, p2b.x - nx * off, p2b.y - ny * off]}
            stroke={stroke} strokeWidth={px(2)} />
        </Group>
      )
    }

    if (variant === 'double') {
      // two half-width leaves hinged at both jambs, arcs meeting mid
      const leaf = width / 2
      const jambs = [
        { h: aPt, q: bPt },
        { h: bPt, q: aPt },
      ]
      return (
        <Group key={key} opacity={opts.preview ? 0.5 : 1}>
          {gap}
          {jambs.map((j, i) => {
            const a1j = deg(Math.atan2(ny, nx))
            const a2j = deg(Math.atan2(j.q.y - j.h.y, j.q.x - j.h.x))
            const dj = ((a2j - a1j) % 360 + 360) % 360
            const rotj = dj === 90 || (dj > 89 && dj < 91) ? a1j : a2j
            const tipj = { x: j.h.x + leaf * nx, y: j.h.y + leaf * ny }
            return (
              <Group key={i}>
                <Line points={[j.h.x, j.h.y, tipj.x, tipj.y]}
                  stroke={stroke} strokeWidth={px(1.5)} />
                <Arc x={j.h.x} y={j.h.y}
                  innerRadius={leaf} outerRadius={leaf}
                  angle={90} rotation={rotj}
                  stroke={stroke} strokeWidth={px(1)} dash={[px(4), px(3)]} />
              </Group>
            )
          })}
        </Group>
      )
    }

    return (
      <Group key={key} opacity={opts.preview ? 0.5 : 1}>
        {gap}
        <Line points={[h.x, h.y, tip.x, tip.y]}
          stroke={stroke} strokeWidth={px(1.5)} />
        <Arc x={h.x} y={h.y}
          innerRadius={width} outerRadius={width}
          angle={90} rotation={rotation}
          stroke={stroke} strokeWidth={px(1)} dash={[px(4), px(3)]} />
      </Group>
    )
  }
  const renderWindow = (wall, offset, width, key, opts = {}) => {
    const a = pointAlongWall(wall, offset)
    const b = pointAlongWall(wall, offset + width)
    const stroke = opts.selected ? T.plan.wallSelected : T.plan.window
    return (
      <Group key={key} opacity={opts.preview ? 0.5 : 1}>
        <Line points={[a.x, a.y, b.x, b.y]}
          stroke={T.plan.gap}
          strokeWidth={Math.max(wall.thickness, px(2)) - px(1)}
          lineCap="butt" />
        <Line points={[a.x, a.y, b.x, b.y]}
          stroke={stroke} strokeWidth={px(2.5)} dash={[px(5), px(3)]} />
      </Group>
    )
  }

  return (
    <div
      className="editor2d"
      ref={containerRef}
      onContextMenu={onContextMenu}
      style={{
        cursor: tool === 'select' ? 'default' : 'crosshair',
        background: T.canvas.bg,
      }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDblClick={onDblClick}
      >
        <Layer listening={false}>
          {gridLines.map((l, i) => (
            <Line key={i} points={l.points}
              stroke={l.major ? T.canvas.gridMajor : T.canvas.gridMinor} strokeWidth={hair} />
          ))}
        </Layer>

        {/* exterior dimension lines */}
        {dimensions.length > 0 && (
          <Layer>
            {dimensions.map((d, i) => (
              <Group key={i}>
                <Group listening={false}>
                {/* extension lines from the corners out past the dim line */}
                <Line points={[d.a.x, d.a.y, d.pa.x + d.nx * px(4), d.pa.y + d.ny * px(4)]}
                  stroke={T.plan.dimensionExt} strokeWidth={hair} />
                <Line points={[d.b.x, d.b.y, d.pb.x + d.nx * px(4), d.pb.y + d.ny * px(4)]}
                  stroke={T.plan.dimensionExt} strokeWidth={hair} />
                {/* dimension line */}
                <Line points={[d.pa.x, d.pa.y, d.pb.x, d.pb.y]}
                  stroke={T.plan.dimension} strokeWidth={1.4 / viewport.scale} />
                {/* 45° architectural ticks */}
                {[d.pa, d.pb].map((t, j) => (
                  <Line key={j}
                    points={[t.x - px(5), t.y + px(5), t.x + px(5), t.y - px(5)]}
                    stroke={T.plan.dimension} strokeWidth={1.4 / viewport.scale} />
                ))}
                </Group>
                {/* the label is live: click to type an exact length */}
                <Text
                  onClick={() => setDimEdit({
                    a: d.a, b: d.b, len: d.len,
                    sx: d.label.x * viewport.scale + viewport.x,
                    sy: d.label.y * viewport.scale + viewport.y,
                  })}
                  onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'pointer' }}
                  onMouseLeave={(e) => { e.target.getStage().container().style.cursor = '' }}
                  x={d.label.x - 60 / viewport.scale}
                  y={d.label.y - fontSize * 0.5}
                  width={120 / viewport.scale} align="center"
                  text={formatLength(d.len, plan.units)}
                  fontSize={fontSize * 0.85} fill={T.plan.dimensionText} />
              </Group>
            ))}
          </Layer>
        )}

        {/* ghost underlay: the floor below, for tracing upper storeys */}
        {floorBelow && (
          <Layer listening={false} opacity={0.16}>
            {floorBelow.walls.map((w) => (
              <Line key={w.id}
                points={[w.start.x, w.start.y, w.end.x, w.end.y]}
                stroke={T.plan.wall} strokeWidth={w.thickness} lineCap="round" />
            ))}
            {floorBelow.stairs.map((st) => (
              <Rect key={st.id} x={st.position.x} y={st.position.y}
                offsetX={st.width / 2} offsetY={st.length / 2}
                width={st.width} height={st.length} rotation={st.rotation}
                stroke={T.plan.wall} strokeWidth={2 / viewport.scale} />
            ))}
          </Layer>
        )}

        {/* rooms + zones under walls */}
        <Layer listening={false}>
          {autoRooms.map((r, i) => {
            const c = polygonCentroid(r.polygon)
            const isSel = selection?.type === 'room' && selection.id === r.id
            return (
              <Group key={r.id}>
                <Line points={flat(r.polygon)} closed fill={ROOM_FILLS[i % ROOM_FILLS.length]}
                  stroke={isSel ? T.plan.wallSelected : undefined}
                  strokeWidth={isSel ? 2.5 / viewport.scale : 0} />
                <Text x={c.x - 60 / viewport.scale} y={c.y - fontSize}
                  width={120 / viewport.scale} align="center"
                  text={`${r.name}\n${formatArea(r.area, plan.units)}`}
                  fontSize={fontSize} lineHeight={1.3} fill={T.plan.roomText} />
              </Group>
            )
          })}
          {zones.map((r, i) => {
            const c = polygonCentroid(r.polygon)
            const color = ZONE_FILLS[i % ZONE_FILLS.length]
            const isSel = selection?.type === 'zone' && selection.id === r.id
            return (
              <Group key={r.id}>
                <Line points={flat(r.polygon)} closed fill={color}
                  opacity={isSel ? 0.32 : 0.18}
                  stroke={color} strokeWidth={(isSel ? 2.5 : 1.5) / viewport.scale}
                  dash={[8 / viewport.scale, 5 / viewport.scale]} />
                <Text x={c.x - 60 / viewport.scale} y={c.y - fontSize}
                  width={120 / viewport.scale} align="center"
                  text={`${r.name}\n${formatArea(r.area, plan.units)}`}
                  fontSize={fontSize} lineHeight={1.3} fill={color} />
                {/* per-edge lengths */}
                {viewport.scale > 0.02 && r.polygon.map((a, k) => {
                  const b = r.polygon[(k + 1) % r.polygon.length]
                  const eLen = dist(a, b)
                  if (eLen < 600) return null
                  return (
                    <Text key={k}
                      x={(a.x + b.x) / 2 - 50 / viewport.scale}
                      y={(a.y + b.y) / 2 - fontSize * 0.4}
                      width={100 / viewport.scale} align="center"
                      text={formatLength(eLen, plan.units)}
                      fontSize={fontSize * 0.68} fill={color} opacity={0.85} />
                  )
                })}
              </Group>
            )
          })}
        </Layer>

        {/* furniture (under walls so wall labels stay readable) */}
        <Layer listening={false}>
          {floor.furniture.map((f) => {
            const lib = FURNITURE_BY_TYPE[f.type]
            const color = T.plan.furnitureMono || lib?.color || '#8d99ae'
            const isSel = selection?.type === 'furniture' && selection.id === f.id
            const isBlocked = blockedFurnIds.has(f.id)
            return (
              <Group key={f.id}>
                <Rect
                  x={f.position.x} y={f.position.y}
                  offsetX={f.dimensions.w / 2} offsetY={f.dimensions.d / 2}
                  width={f.dimensions.w} height={f.dimensions.d}
                  rotation={f.rotation}
                  fill={isBlocked ? T.chrome.danger + '33' : color + '55'}
                  stroke={isBlocked ? T.chrome.danger : isSel ? T.plan.wallSelected : color}
                  strokeWidth={(isSel || isBlocked ? 2.5 : 1.5) / viewport.scale}
                  dash={isBlocked ? [10 / viewport.scale, 6 / viewport.scale] : undefined}
                  cornerRadius={60}
                />
                {isBlocked && (viewport.scale > 0.03 || isSel) && (
                  <Text x={f.position.x - 60 / viewport.scale}
                    y={f.position.y + f.dimensions.d / 2 + px(4)}
                    width={120 / viewport.scale} align="center"
                    text="⚠ blocks door swing"
                    fontSize={fontSize * 0.62} fill={T.chrome.danger} />
                )}
                {(viewport.scale > 0.03 || isSel) && (
                  <Text
                    x={f.position.x - 60 / viewport.scale}
                    y={f.position.y - fontSize * 0.8}
                    width={120 / viewport.scale} align="center"
                    text={`${lib?.label || f.type}\n${(f.dimensions.w / 1000).toFixed(2)} × ${(f.dimensions.d / 1000).toFixed(2)} m`}
                    fontSize={fontSize * 0.72} lineHeight={1.25} fill={T.plan.furnitureText} />
                )}
              </Group>
            )
          })}
          {floor.stairs.map(renderStair)}
          {tool === 'measure' && measure && (measure.b || measure.live) && (() => {
            const end = measure.b || measure.live
            const L = Math.hypot(end.x - measure.a.x, end.y - measure.a.y)
            if (L < 1) return null
            const mid = { x: (measure.a.x + end.x) / 2, y: (measure.a.y + end.y) / 2 }
            return (
              <Group>
                <Line points={[measure.a.x, measure.a.y, end.x, end.y]}
                  stroke={T.plan.dimension} strokeWidth={1.6 / viewport.scale}
                  dash={[10 / viewport.scale, 6 / viewport.scale]} />
                {[measure.a, end].map((pt, i) => (
                  <Line key={i}
                    points={[pt.x - px(5), pt.y + px(5), pt.x + px(5), pt.y - px(5)]}
                    stroke={T.plan.dimension} strokeWidth={1.6 / viewport.scale} />
                ))}
                <Text x={mid.x - 70 / viewport.scale} y={mid.y - fontSize * 1.5}
                  width={140 / viewport.scale} align="center"
                  text={formatLength(L, plan.units)}
                  fontSize={fontSize} fontStyle="bold" fill={T.plan.dimensionText} />
              </Group>
            )
          })()}
          {tool === 'stair' && cursor && (
            <Group opacity={0.45} x={cursor.point.x} y={cursor.point.y} rotation={armedRotation}>
              <Rect x={-500} y={-1400} width={1000} height={2800}
                stroke={T.plan.door} strokeWidth={1.5 / viewport.scale}
                dash={[8 / viewport.scale, 5 / viewport.scale]} fill={T.plan.door + '22'} />
            </Group>
          )}
          {/* ghost of the armed item at the cursor */}
          {tool === 'furniture' && armedItem && cursor && (
            <Group opacity={0.45}>
              <Rect
                x={cursor.point.x} y={cursor.point.y}
                offsetX={armedItem.w / 2} offsetY={armedItem.d / 2}
                width={armedItem.w} height={armedItem.d}
                rotation={armedRotation}
                fill={(T.plan.furnitureMono || armedItem.color || '#8d99ae') + '77'}
                stroke={T.plan.furnitureMono || armedItem.color || '#8d99ae'}
                strokeWidth={1.5 / viewport.scale}
                dash={[8 / viewport.scale, 5 / viewport.scale]}
                cornerRadius={60}
              />
              <Text
                x={cursor.point.x - 60 / viewport.scale}
                y={cursor.point.y - fontSize * 0.45}
                width={120 / viewport.scale} align="center"
                text={armedItem.label}
                fontSize={fontSize * 0.72} fill={T.plan.furnitureText} />
            </Group>
          )}
        </Layer>

        {/* walls, openings, previews */}
        <Layer listening={false}>
          {floor.walls.map((w) => {
            const isSel = selection?.type === 'wall' && selection.id === w.id
            return (
              <Group key={w.id}>
                <Line
                  points={[w.start.x, w.start.y, w.end.x, w.end.y]}
                  stroke={isSel ? T.plan.wallSelected : T.plan.wall}
                  strokeWidth={Math.max(w.thickness, px(2))}
                  lineCap="round"
                />
                <Text
                  x={midpoint(w.start, w.end).x + px(6)}
                  y={midpoint(w.start, w.end).y - px(18)}
                  text={formatLength(wallLength(w), plan.units)}
                  fontSize={fontSize * 0.9} fill={T.plan.wallLabel}
                />
              </Group>
            )
          })}
          {floor.openings.map((o) => {
            const wall = floor.walls.find((w) => w.id === o.wallId)
            if (!wall) return null
            const isSel = selection?.type === 'opening' && selection.id === o.id
            return o.type === 'door'
              ? renderDoor(wall, o, o.id, { selected: isSel })
              : renderWindow(wall, o.offset, o.width, o.id, { selected: isSel })
          })}
          {/* opening tags + sizes (architectural convention: tag on plan,
              sizes in the schedule — styled apart from wall dimensions) */}
          {viewport.scale > 0.02 && floor.openings.map((o) => {
            const wall = floor.walls.find((w) => w.id === o.wallId)
            if (!wall) return null
            const tag = tags.get(o.id)
            const mid = pointAlongWall(wall, o.offset + o.width / 2)
            const len = wallLength(wall) || 1
            const side = o.type === 'door' ? -(o.swingSide || 1) : 1
            const nx = ((wall.end.y - wall.start.y) / len) * side
            const ny = (-(wall.end.x - wall.start.x) / len) * side
            const off = wall.thickness / 2 + px(14)
            const color = o.type === 'door' ? T.plan.door : T.plan.window
            return (
              <Text key={'tag-' + o.id}
                x={mid.x + nx * off - 60 / viewport.scale}
                y={mid.y + ny * off - fontSize * 0.35}
                width={120 / viewport.scale} align="center"
                text={`${tag} · ${Math.round(o.width)}×${Math.round(o.height)}`}
                fontSize={fontSize * 0.7} fill={color} />
            )
          })}

          {/* door/window placement preview */}
          {openingPreview && (() => {
            const wall = floor.walls.find((w) => w.id === openingPreview.wallId)
            if (!wall) return null
            return openingPreview.type === 'door'
              ? renderDoor(wall, openingPreview, 'preview', { preview: true })
              : renderWindow(wall, openingPreview.offset, openingPreview.width, 'preview', { preview: true })
          })()}

          {/* wall drawing preview */}
          {tool === 'wall' && chainStart && cursor && (
            <Group>
              <Line points={[chainStart.x, chainStart.y, cursor.point.x, cursor.point.y]}
                stroke={T.plan.wallSelected} strokeWidth={drawThickness} opacity={0.45}
                lineCap="round" dash={[px(10), px(6)]} />
              <Text x={midpoint(chainStart, cursor.point).x + px(8)}
                y={midpoint(chainStart, cursor.point).y - px(20)}
                text={formatLength(dist(chainStart, cursor.point), plan.units)}
                fontSize={fontSize} fill={T.plan.wallSelected} fontStyle="bold" />
            </Group>
          )}

          {/* zone drawing preview */}
          {tool === 'zone' && zonePts.length > 0 && (
            <Group>
              <Line
                points={[...zonePts.flatMap((p) => [p.x, p.y]),
                  ...(cursor ? [cursor.point.x, cursor.point.y] : [])]}
                stroke={ZONE_FILLS[0]} strokeWidth={px(2)} dash={[px(8), px(5)]} />
              {zonePts.map((p, i) => (
                <Circle key={i} x={p.x} y={p.y} radius={px(i === 0 ? 6 : 4)}
                  fill={i === 0 ? ZONE_FILLS[0] : T.plan.handleFill}
                  stroke={ZONE_FILLS[0]} strokeWidth={px(1.5)} />
              ))}
            </Group>
          )}

          {/* snap indicator */}
          {(tool === 'wall' || tool === 'zone') && cursor && (
            <Circle x={cursor.point.x} y={cursor.point.y} radius={px(5)}
              stroke={cursor.kind === 'endpoint' ? T.plan.snapEndpoint
                : cursor.kind === 'wall' ? T.plan.snapWall : T.plan.snapGrid}
              strokeWidth={px(2)}
              fill={cursor.kind === 'endpoint' ? T.plan.snapEndpoint + '22' : 'transparent'} />
          )}
        </Layer>

        {/* interactive handles: wall endpoints, opening ends, furniture corners */}
        <Layer>
          {selectedWall && [selectedWall.start, selectedWall.end].map((pt, i) => (
            <Circle key={i} x={pt.x} y={pt.y} radius={px(7)} hitStrokeWidth={px(22)}
              fill={T.plan.handleFill} stroke={T.plan.handleStroke} strokeWidth={px(2.5)}
              onMouseDown={startNodeDrag(pt)} onTouchStart={startNodeDrag(pt)}
              onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'move' }}
              onMouseLeave={(e) => { e.target.getStage().container().style.cursor = '' }} />
          ))}
          {selectedOpening && (() => {
            const wall = floor.walls.find((w) => w.id === selectedOpening.wallId)
            if (!wall) return null
            return ['a', 'b'].map((end) => {
              const pt = pointAlongWall(wall,
                end === 'a' ? selectedOpening.offset : selectedOpening.offset + selectedOpening.width)
              return (
                <Circle key={end} x={pt.x} y={pt.y} radius={px(6)} hitStrokeWidth={px(22)}
                  fill={T.plan.handleFill} stroke={T.plan.handleStroke} strokeWidth={px(2.5)}
                  onMouseDown={startOpeningEndDrag(selectedOpening, end)}
                  onTouchStart={startOpeningEndDrag(selectedOpening, end)}
                  onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'ew-resize' }}
                  onMouseLeave={(e) => { e.target.getStage().container().style.cursor = '' }} />
              )
            })
          })()}
          {selectedFurnitureItem && (() => {
            const f = selectedFurnitureItem
            const rad = (f.rotation * Math.PI) / 180
            const cos = Math.cos(rad), sin = Math.sin(rad)
            return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
              const lx = (sx * f.dimensions.w) / 2
              const ly = (sy * f.dimensions.d) / 2
              const x = f.position.x + lx * cos - ly * sin
              const y = f.position.y + lx * sin + ly * cos
              return (
                <Circle key={`${sx}${sy}`} x={x} y={y} radius={px(6)} hitStrokeWidth={px(22)}
                  fill={T.plan.handleFill} stroke={T.plan.handleStroke} strokeWidth={px(2.5)}
                  onMouseDown={startFurnResize(f, sx, sy)} onTouchStart={startFurnResize(f, sx, sy)}
                  onMouseEnter={(e) => { e.target.getStage().container().style.cursor = 'nwse-resize' }}
                  onMouseLeave={(e) => { e.target.getStage().container().style.cursor = '' }} />
              )
            })
          })()}
        </Layer>
      </Stage>

      {/* tool palette overlay */}
      <div className="tool-palette" role="toolbar" aria-label="Editor tools">
        {[
          ['select', 'Select', 'Select (V)'],
          ['wall', 'Wall', 'Draw walls (W)'],
          ['door', 'Door', 'Place door (D)'],
          ['window', 'Window', 'Place window (N)'],
          ['furniture', 'Furniture', 'Place furniture (F)'],
          ['zone', 'Zone', 'Draw zone (Z)'],
          ['stair', 'Stairs', 'Place stairs (S)'],
          ['measure', 'Measure', 'Tape measure (M)'],
        ].map(([id, label, hint]) => (
          <button key={id} className={tool === id ? 'active' : ''}
            onClick={() => switchTool(id)} title={hint} aria-label={hint}>
            <ToolIcon name={id === 'stair' ? 'stair' : id} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      {tool === 'wall' && (
        <div className="wall-options" role="group" aria-label="Wall thickness">
          <span>Thickness</span>
          <button className={drawThickness === 300 ? 'active' : ''}
            onClick={() => setDrawThickness(300)}>Exterior 300</button>
          <button className={drawThickness === 150 ? 'active' : ''}
            onClick={() => setDrawThickness(150)}>Interior 150</button>
          <input type="number" min="50" max="600" step="10"
            value={drawThickness}
            onChange={(e) => setDrawThickness(Math.max(50, Math.min(600, Number(e.target.value) || 150)))}
            aria-label="Custom thickness (mm)" />
        </div>
      )}
      {tool === 'furniture' && (
        <div className="furniture-palette" role="listbox" aria-label="Furniture library">
          {FURNITURE_LIBRARY.map((item) => (
            <button
              key={item.type}
              className={armedItem?.type === item.type ? 'active' : ''}
              onClick={() => setArmedItem(item)}
            >
              {item.label}
              <span>{(item.w / 1000).toFixed(1)}×{(item.d / 1000).toFixed(1)} m</span>
            </button>
          ))}
        </div>
      )}
      <div className="status-bar">
        {tool === 'wall' && (chainStart
          ? 'Click to place · keeps chaining · double-click / Esc / right-click to finish'
          : 'Click to start a wall — snaps to endpoints, walls, and grid')}
        {tool === 'zone' && (zonePts.length
          ? 'Click to add points · click the first point or double-click to close'
          : 'Click to outline an open-plan zone (kitchen, dining…)')}
        {tool === 'door' && 'Hover a wall to preview, click to place the door · select it later to slide or resize'}
        {tool === 'window' && 'Hover a wall to preview, click to place the window · select it later to slide or resize'}
        {tool === 'stair' && 'Click to place stairs (rises to the floor above) · R rotates before placing'}
        {tool === 'measure' && (measure && !measure.b
          ? 'Click the second point · snaps to walls and corners'
          : 'Click two points to measure · right-click exits')}
        {tool === 'furniture' && (armedItem
          ? `Click to place ${armedItem.label} · R rotates · Shift-click to place several`
          : 'Pick an item from the library, then click to place it')}
        {tool === 'select' && (selection
          ? selection.type === 'room'
            ? 'Drag to move this room — shared walls stay with the neighbor, the room takes copies along and can rejoin elsewhere'
            : selection.type === 'opening'
              ? 'Drag to slide along the wall · edit size in the panel · Delete to remove'
              : selection.type === 'furniture'
                ? 'Drag to move · corner handles resize · R rotates 90° · ⌘D duplicates · Delete removes'
              : selection.type === 'stair'
                ? 'Drag to move · R rotates 90° · size in the panel · Delete removes'
                : 'Drag to move · drag handles to reshape · Delete to remove'
          : 'Click a wall, door/window, room, or zone · two-finger scroll to pan · pinch or ⌘/Ctrl+scroll to zoom')}
      </div>
      {floor.walls.length === 0 && floor.rooms.length === 0 && floor.furniture.length === 0 && floor.stairs.length === 0 && (
        <div className="onboarding">
          <div className="onboarding-card glass">
            <h1>Start a plan</h1>
            <p>Walls first — rooms find themselves.</p>
            <div className="onboarding-actions">
              <button onClick={() => switchTool('wall')}>
                <strong>Draw walls</strong><span>press W · click to chain</span>
              </button>
              <button onClick={loadSamplePlan}>
                <strong>Try a sample home</strong><span>furnished 2-bed bungalow</span>
              </button>
              <button onClick={() => importOpener?.()}>
                <strong>Import a project</strong><span>.planforge.json</span>
              </button>
            </div>
            <p className="onboarding-hint">⌘K opens the command palette anytime</p>
          </div>
        </div>
      )}
      {dimEdit && (
        <div className="dim-edit glass" style={{ left: dimEdit.sx, top: dimEdit.sy }}>
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            defaultValue={(dimEdit.len / 1000).toFixed(2)}
            aria-label="Edge length in metres"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDimEdit(null)
              if (e.key === 'Enter') {
                const v = parseFloat(e.target.value.replace(',', '.'))
                if (!Number.isNaN(v) && v > 0) {
                  // metres normally; large bare numbers read as mm
                  const newLen = v > 100 ? v : v * 1000
                  resizeFootprintEdge({ a: dimEdit.a, b: dimEdit.b, newLen })
                }
                setDimEdit(null)
              }
            }}
            onBlur={() => setDimEdit(null)}
          />
          <span>m</span>
        </div>
      )}
      {ctxMenu && (
        <div
          className="context-menu glass"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          role="menu"
        >
          {ctxItems().map((item) => (
            <button key={item.label} role="menuitem"
              className={item.danger ? 'danger' : ''}
              onClick={() => { setCtxMenu(null); item.run() }}>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
