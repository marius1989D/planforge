import React from 'react'
import { usePlanStore, activeFloorOf } from '../store/planStore'
import { formatArea } from '../model/units'
import { DEFAULTS } from '../model/schema'
import { WALL_COLORS, FLOOR_COLORS } from '../model/styleOptions'
import { THEMES } from '../model/themes'
import { solarPosition, sunLabel, SUN_DEFAULTS } from '../geometry/sunGeo'
import { computeCostLines, DEFAULT_RATES, fmtMoney } from '../geometry/quantities'
import { doorClearanceIssues } from '../geometry/clearanceGeo'
import { FURNITURE_BY_TYPE } from '../model/furnitureLibrary'

// Drops a 4m × 3m room with a door and a window — verifies the
// full pipeline: store → room detection → 2D fills → 3D extrusion
// with opening cuts → autosave. Successive rooms offset by 5m.
function useAddDemoRoom() {
  const addWall = usePlanStore((s) => s.addWall)
  const addOpening = usePlanStore((s) => s.addOpening)
  const count = usePlanStore((s) => activeFloorOf(s.plan).walls.length)
  return () => {
    const o = (count / 4) * 5000
    const southId = addWall({ start: { x: o, y: o }, end: { x: o + 4000, y: o } })
    const eastId = addWall({ start: { x: o + 4000, y: o }, end: { x: o + 4000, y: o + 3000 } })
    addWall({ start: { x: o + 4000, y: o + 3000 }, end: { x: o, y: o + 3000 } })
    addWall({ start: { x: o, y: o + 3000 }, end: { x: o, y: o } })
    addOpening({ wallId: southId, type: 'door', offset: 800 })
    addOpening({ wallId: eastId, type: 'window', offset: 900 })
  }
}

export default function Inspector() {
  const plan = usePlanStore((s) => s.plan)
  const floor = activeFloorOf(plan)
  const setUnits = usePlanStore((s) => s.setUnits)
  const renameRoom = usePlanStore((s) => s.renameRoom)
  const deleteManualRoom = usePlanStore((s) => s.deleteManualRoom)
  const selection = usePlanStore((s) => s.selection)
  const updateWall = usePlanStore((s) => s.updateWall)
  const updateOpening = usePlanStore((s) => s.updateOpening)
  const updateFurniture = usePlanStore((s) => s.updateFurniture)
  const setRoof = usePlanStore((s) => s.setRoof)
  const setRoofPitch = usePlanStore((s) => s.setRoofPitch)
  const setWallColor = usePlanStore((s) => s.setWallColor)
  const setFloorColor = usePlanStore((s) => s.setFloorColor)
  const setShowDimensions = usePlanStore((s) => s.setShowDimensions)
  const themeId = usePlanStore((s) => s.theme)
  const inspectorOpen = usePlanStore((s) => s.inspectorOpen)
  const setInspectorOpen = usePlanStore((s) => s.setInspectorOpen)
  const setActiveFloor = usePlanStore((s) => s.setActiveFloor)
  const addFloor = usePlanStore((s) => s.addFloor)
  const renameFloor = usePlanStore((s) => s.renameFloor)
  const deleteFloor = usePlanStore((s) => s.deleteFloor)
  const updateStair = usePlanStore((s) => s.updateStair)
  const resizeWallLength = usePlanStore((s) => s.resizeWallLength)
  const setSunSettings = usePlanStore((s) => s.setSunSettings)
  const furnishRoom = usePlanStore((s) => s.furnishRoom)
  const setCostRates = usePlanStore((s) => s.setCostRates)
  const setTheme = usePlanStore((s) => s.setTheme)
  const selectedStair = selection?.type === 'stair'
    ? floor.stairs.find((x) => x.id === selection.id) : null
  const selectedFurniture = selection?.type === 'furniture'
    ? floor.furniture.find((f) => f.id === selection.id)
    : null
  const selectedOpening = selection?.type === 'opening'
    ? floor.openings.find((o) => o.id === selection.id)
    : null
  const openingWall = selectedOpening
    ? floor.walls.find((w) => w.id === selectedOpening.wallId)
    : null
  const selectedWall = selection?.type === 'wall'
    ? floor.walls.find((w) => w.id === selection.id)
    : null
  const addDemoRoom = useAddDemoRoom()

  const totalArea = floor.rooms
    .filter((r) => r.source === 'auto')
    .reduce((sum, r) => sum + r.area, 0)

  if (!inspectorOpen) {
    return (
      <button
        className="inspector-rail glass"
        onClick={() => setInspectorOpen(true)}
        title="Open panel"
        aria-label="Open panel"
      >
        ◧
      </button>
    )
  }

  return (
    <aside className="inspector glass">
      <button
        className="inspector-collapse"
        onClick={() => setInspectorOpen(false)}
        title="Collapse panel"
        aria-label="Collapse panel"
      >
        ✕
      </button>
      <h2>Plan</h2>
      <dl>
        <dt>Walls</dt><dd>{floor.walls.length}</dd>
        <dt>Openings</dt><dd>{floor.openings.length}</dd>
        <dt>Rooms</dt><dd>{floor.rooms.length}</dd>
        <dt>Furniture</dt><dd>{floor.furniture.length}</dd>
        <dt>Floor area</dt><dd>{formatArea(totalArea, plan.units)}</dd>
      </dl>

      {floor.rooms.length > 0 && (
        <>
          <h2>Floors</h2>
      <div className="floor-tabs" role="tablist" aria-label="Floors">
        {plan.floors.map((f, i) => (
          <button key={f.id} role="tab"
            aria-selected={i === (plan.activeFloorIndex || 0)}
            className={i === (plan.activeFloorIndex || 0) ? 'active' : ''}
            onClick={() => setActiveFloor(i)}>
            {f.name}
          </button>
        ))}
        <button className="floor-add" title="Add a floor above (copies the shell walls)"
          onClick={() => addFloor()}>+</button>
      </div>
      <label className="field">
        Floor name
        <input value={floor.name}
          onChange={(e) => renameFloor(plan.activeFloorIndex || 0, e.target.value)} />
      </label>
      {plan.floors.length > 1 && (
        <button className="danger-link"
          onClick={() => {
            if (confirm(`Delete "${floor.name}" and everything on it?`)) {
              deleteFloor(plan.activeFloorIndex || 0)
            }
          }}>
          Delete this floor…
        </button>
      )}

      <h2>Rooms</h2>
          <ul className="room-list">
            {floor.rooms.map((r) => (
              <li key={r.id}
                className={(selection?.type === 'room' || selection?.type === 'zone') &&
                  selection.id === r.id ? 'row-selected' : ''}>
                <input
                  value={r.name}
                  onChange={(e) => renameRoom(r.id, e.target.value)}
                  aria-label="Room name"
                />
                <span>{formatArea(r.area, plan.units)}</span>
                {r.source === 'manual' && (
                  <button
                    className="icon-btn"
                    title="Delete zone"
                    onClick={() => deleteManualRoom(r.id)}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {selectedWall && (
        <div className="sel-panel" key={'w-' + selectedWall.id}>
          <h2>Selected wall</h2>
          <label className="field">
            Length (mm) — moves the end node
            <input
              type="number" min="300" step="50"
              key={'len-' + selectedWall.id}
              defaultValue={Math.round(Math.hypot(
                selectedWall.end.x - selectedWall.start.x,
                selectedWall.end.y - selectedWall.start.y))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  resizeWallLength(selectedWall.id, Number(e.target.value) || 0)
                  e.target.blur()
                }
              }}
              onBlur={(e) => resizeWallLength(selectedWall.id, Number(e.target.value) || 0)}
            />
          </label>
          <label className="field">
            Thickness (mm)
            <input
              type="number" min="50" max="600" step="10"
              value={selectedWall.thickness}
              onChange={(e) => updateWall(selectedWall.id, { thickness: Number(e.target.value) || 150 })}
            />
          </label>
          <label className="field">
            Height (mm)
            <input
              type="number" min="1000" max="6000" step="100"
              value={selectedWall.height}
              onChange={(e) => updateWall(selectedWall.id, { height: Number(e.target.value) || 2400 })}
            />
          </label>
        </div>
      )}

      {selectedOpening && openingWall && (() => {
        const wallLen = Math.hypot(
          openingWall.end.x - openingWall.start.x,
          openingWall.end.y - openingWall.start.y,
        )
        const clampWidth = (v) => Math.max(300, Math.min(v, wallLen - selectedOpening.offset))
        const clampOffset = (v) =>
          Math.max(0, Math.min(v, wallLen - selectedOpening.width))
        return (
          <div className="sel-panel" key={'o-' + selectedOpening.id}>
            <h2>Selected {selectedOpening.type}</h2>
            <label className="field">
              Width (mm)
              <input type="number" min="300" step="50"
                value={Math.round(selectedOpening.width)}
                onChange={(e) => updateOpening(selectedOpening.id,
                  { width: clampWidth(Number(e.target.value) || 900) })} />
            </label>
            <label className="field">
              Position along wall (mm)
              <input type="number" min="0" step="50"
                value={Math.round(selectedOpening.offset)}
                onChange={(e) => updateOpening(selectedOpening.id,
                  { offset: clampOffset(Number(e.target.value) || 0) })} />
            </label>
            <label className="field">
              {selectedOpening.type === 'door' ? 'Height (mm)' : 'Glass height (mm)'}
              <input type="number" min="300" max={openingWall.height} step="50"
                value={Math.round(selectedOpening.height)}
                onChange={(e) => updateOpening(selectedOpening.id,
                  { height: Math.max(300, Math.min(Number(e.target.value) || 1200, openingWall.height)) })} />
            </label>
            {selectedOpening.type === 'window' && (
              <label className="field">
                Sill height (mm)
                <input type="number" min="0" max={openingWall.height - 300} step="50"
                  value={Math.round(selectedOpening.sillHeight)}
                  onChange={(e) => updateOpening(selectedOpening.id,
                    { sillHeight: Math.max(0, Math.min(Number(e.target.value) || 0, openingWall.height - selectedOpening.height)) })} />
              </label>
            )}
            {selectedOpening.type === 'door' && (() => {
              const issue = doorClearanceIssues(floor).find((i) => i.openingId === selectedOpening.id)
              if (!issue) return null
              const names = issue.furnitureIds
                .map((id) => floor.furniture.find((f) => f.id === id))
                .filter(Boolean)
                .map((f) => FURNITURE_BY_TYPE[f.type]?.label || f.type)
              return (
                <p className="clearance-warning">
                  ⚠ Swing blocked by: {names.join(', ')}
                </p>
              )
            })()}
            {selectedOpening.type === 'door' && (
              <label className="field">
                Door style
                <select
                  value={selectedOpening.variant || 'single'}
                  onChange={(e) => updateOpening(selectedOpening.id, { variant: e.target.value })}
                >
                  <option value="single">Single swing</option>
                  <option value="double">Double swing</option>
                  <option value="sliding">Sliding</option>
                </select>
              </label>
            )}
            {selectedOpening.type === 'door' && (selectedOpening.variant || 'single') !== 'sliding' && (
              <div className="btn-row">
                <button onClick={() => updateOpening(selectedOpening.id,
                  { swingSide: (selectedOpening.swingSide || 1) * -1 })}>
                  Flip swing
                </button>
                {(selectedOpening.variant || 'single') === 'single' && (
                  <button onClick={() => updateOpening(selectedOpening.id,
                    { hinge: selectedOpening.hinge === 'end' ? 'start' : 'end' })}>
                    Flip hinge
                  </button>
                )}
              </div>
            )}
            <p className="hint">
              Drag the {selectedOpening.type} to slide it · drag its end handles to resize
            </p>
          </div>
        )
      })()}

      {selection?.type === 'room' && (() => {
        const rm = floor.rooms.find((r) => r.id === selection.id && r.source === 'auto')
        if (!rm) return null
        return (
          <div className="sel-panel" key={'rm-' + rm.id}>
            <h2>Selected room — {rm.name}</h2>
            <p className="hint">Auto-furnish (respects walls, door swings, windows):</p>
            <div className="furnish-grid">
              {[['bedroom', 'Bedroom'], ['living', 'Living'], ['kitchen', 'Kitchen'],
                ['bathroom', 'Bathroom'], ['dining', 'Dining'], ['office', 'Office']].map(([k, label]) => (
                <button key={k} onClick={() => furnishRoom(rm.id, k)}>{label}</button>
              ))}
            </div>
            <p className="hint">Adds to what's there · one ⌘Z removes the batch</p>
          </div>
        )
      })()}
      {selectedStair && (
        <div className="sel-panel" key={'st-' + selectedStair.id}>
          <h2>Selected stairs</h2>
          <label className="field">
            Width (mm)
            <input type="number" min="600" max="3000" step="50"
              value={selectedStair.width}
              onChange={(e) => updateStair(selectedStair.id, { width: Math.max(600, Number(e.target.value) || 1000) })} />
          </label>
          <label className="field">
            Length (mm)
            <input type="number" min="1000" max="8000" step="100"
              value={selectedStair.length}
              onChange={(e) => updateStair(selectedStair.id, { length: Math.max(1000, Number(e.target.value) || 2800) })} />
          </label>
          <label className="field">
            Rotation (°)
            <input type="number" step="15"
              value={selectedStair.rotation}
              onChange={(e) => updateStair(selectedStair.id, { rotation: ((Number(e.target.value) || 0) % 360 + 360) % 360 })} />
          </label>
          <p className="hint">Rises to the floor above · the arrow marks UP</p>
        </div>
      )}
      {selectedFurniture && (
        <div className="sel-panel" key={'f-' + selectedFurniture.id}>
          <h2>Selected furniture</h2>
          <label className="field">
            Rotation (°)
            <input type="number" step="15"
              value={selectedFurniture.rotation}
              onChange={(e) => updateFurniture(selectedFurniture.id,
                { rotation: ((Number(e.target.value) || 0) % 360 + 360) % 360 })} />
          </label>
          <label className="field">
            Width (mm)
            <input type="number" min="100" step="50"
              value={selectedFurniture.dimensions.w}
              onChange={(e) => updateFurniture(selectedFurniture.id,
                { dimensions: { ...selectedFurniture.dimensions, w: Math.max(100, Number(e.target.value) || 100) } })} />
          </label>
          <label className="field">
            Depth (mm)
            <input type="number" min="100" step="50"
              value={selectedFurniture.dimensions.d}
              onChange={(e) => updateFurniture(selectedFurniture.id,
                { dimensions: { ...selectedFurniture.dimensions, d: Math.max(100, Number(e.target.value) || 100) } })} />
          </label>
          <label className="field">
            Height (mm)
            <input type="number" min="100" step="50"
              value={selectedFurniture.dimensions.h}
              onChange={(e) => updateFurniture(selectedFurniture.id,
                { dimensions: { ...selectedFurniture.dimensions, h: Math.max(100, Number(e.target.value) || 100) } })} />
          </label>
          <p className="hint">R rotates 90° · corner handles in the plan resize</p>
        </div>
      )}

      <h2>Appearance</h2>
      <div className="theme-picker" role="radiogroup" aria-label="Theme">
        {Object.values(THEMES).map((t) => (
          <button
            key={t.id}
            role="radio"
            aria-checked={themeId === t.id}
            className={themeId === t.id ? 'active' : ''}
            title={t.label}
            onClick={() => setTheme(t.id)}
          >
            <span className="theme-swatch">
              {t.swatch.map((c, i) => (
                <i key={i} style={{ background: c }} />
              ))}
            </span>
            {t.label}
          </button>
        ))}
      </div>

      <h2>Settings</h2>
      <label className="field">
        Roof (3D view)
        <select value={plan.roof || 'none'} onChange={(e) => setRoof(e.target.value)}>
          <option value="none">None (open top)</option>
          <option value="flat">Flat roof</option>
          <option value="pitched">Pitched (hip) roof</option>
        </select>
      </label>
      {plan.roof === 'pitched' && (
        <label className="field">
          Roof pitch (°)
          <input type="number" min="10" max="55" step="5"
            value={plan.roofPitch || 30}
            onChange={(e) => setRoofPitch(Number(e.target.value) || 30)} />
        </label>
      )}
      <label className="field">
        Wall colour (3D)
        <select value={plan.wallColor || ''} onChange={(e) => setWallColor(e.target.value || null)}>
          <option value="">Default</option>
          {WALL_COLORS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Floor colour (3D)
        <select value={plan.floorColor || ''} onChange={(e) => setFloorColor(e.target.value || null)}>
          <option value="">Default</option>
          {FLOOR_COLORS.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </label>
      {(() => {
        const sun = { ...SUN_DEFAULTS, ...(plan.sun || {}) }
        const pos = solarPosition(sun)
        const hh = String(Math.floor(sun.minutes / 60)).padStart(2, '0')
        const mm = String(sun.minutes % 60).padStart(2, '0')
        return (
          <>
            <h2>Sun &amp; daylight (3D)</h2>
            <label className="field field-inline">
              <input type="checkbox" checked={!!sun.enabled}
                onChange={(e) => setSunSettings({ enabled: e.target.checked })} />
              Simulate real sunlight
            </label>
            {sun.enabled && (
              <>
                <label className="field">
                  Date
                  <input type="date" value={sun.dateISO}
                    onChange={(e) => e.target.value && setSunSettings({ dateISO: e.target.value })} />
                </label>
                <label className="field">
                  Time — {hh}:{mm} · sun {sunLabel(pos)}
                  <input type="range" min={300} max={1320} step={15}
                    value={sun.minutes}
                    onChange={(e) => setSunSettings({ minutes: Number(e.target.value) })} />
                </label>
                <div className="field-pair">
                  <label className="field">
                    Latitude
                    <input type="number" min="-89" max="89" step="0.01" value={sun.lat}
                      onChange={(e) => setSunSettings({ lat: Number(e.target.value) || 0 })} />
                  </label>
                  <label className="field">
                    Longitude
                    <input type="number" min="-180" max="180" step="0.01" value={sun.lon}
                      onChange={(e) => setSunSettings({ lon: Number(e.target.value) || 0 })} />
                  </label>
                </div>
                <p className="hint">Plan top = North · low sun renders warm</p>
              </>
            )}
          </>
        )
      })()}

      {(() => {
        const rates = { ...DEFAULT_RATES, ...(plan.costRates || {}) }
        const cost = computeCostLines(plan)
        const rateField = (key, label) => (
          <label className="field" key={key}>
            {label}
            <input type="number" min="0" step="5" value={rates[key]}
              onChange={(e) => setCostRates({ [key]: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        )
        return (
          <>
            <h2>Cost estimate</h2>
            {cost.lines.length === 0 ? (
              <p className="hint">Draw some walls first — quantities appear here.</p>
            ) : (
              <table className="cost-table">
                <tbody>
                  {cost.lines.map((l) => (
                    <tr key={l.label}>
                      <td>{l.label}</td>
                      <td>{l.qty} {l.unit}</td>
                      <td>{fmtMoney(l.subtotal, cost.currency)}</td>
                    </tr>
                  ))}
                  <tr className="cost-total">
                    <td>Estimated total</td>
                    <td />
                    <td>{fmtMoney(cost.total, cost.currency)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <details className="cost-rates">
              <summary>Unit rates ({rates.currency})</summary>
              <label className="field">
                Currency symbol
                <input value={rates.currency} maxLength={4}
                  onChange={(e) => setCostRates({ currency: e.target.value || '€' })} />
              </label>
              <div className="field-pair">
                {rateField('wallPerM2', 'Walls / m²')}
                {rateField('floorPerM2', 'Floors / m²')}
                {rateField('roofPerM2', 'Roof / m²')}
                {rateField('doorEach', 'Door / pc')}
                {rateField('windowEach', 'Window / pc')}
                {rateField('stairEach', 'Stairs / pc')}
              </div>
            </details>
            <p className="hint">Rough guide only — verify with contractors.</p>
          </>
        )
      })()}

      <label className="field field-inline">
        <input type="checkbox"
          checked={plan.showDimensions !== false}
          onChange={(e) => setShowDimensions(e.target.checked)} />
        Show exterior dimensions (2D + PDF)
      </label>
      <label className="field">
        Units
        <select value={plan.units} onChange={(e) => setUnits(e.target.value)}>
          <option value="mm">Metric (mm/m)</option>
          <option value="ft">Imperial (ft/in)</option>
        </select>
      </label>
      <p className="hint">
        Grid snap: {plan.gridSize} mm · Wall default: {DEFAULTS.wallThickness} mm thick,{' '}
        {DEFAULTS.wallHeight} mm high
      </p>

      <h2>Quick start</h2>
      <button className="primary" onClick={addDemoRoom}>
        Add demo room (4×3 m + door + window)
      </button>
      <p className="hint">
        Or press <strong>W</strong> and draw walls — rooms are detected
        automatically from closed loops. <strong>D</strong> places doors,
        <strong>N</strong> places windows (hover a wall, click to drop).
        <strong>Z</strong> outlines open-plan zones. In Select mode, drag a
        room to pull it out — shared walls stay behind and the room can be
        rejoined anywhere.
      </p>
    </aside>
  )
}
