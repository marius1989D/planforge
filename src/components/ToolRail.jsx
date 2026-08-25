import React from 'react'
import { usePlanStore } from '../store/planStore'
import ToolIcon from './ToolIcon'

const TOOLS = [
  ['select', 'Select', 'Select (V)'],
  ['wall', 'Wall', 'Draw walls (W)'],
  ['door', 'Door', 'Place door (D)'],
  ['window', 'Window', 'Place window (N)'],
  ['furniture', 'Furniture', 'Place furniture (F)'],
  ['zone', 'Zone', 'Draw zone (Z)'],
  ['stair', 'Stairs', 'Place stairs (S)'],
  ['measure', 'Measure', 'Tape measure (M)'],
]

// The editor tool bar. A flex sibling of the canvas (not an overlay), so the
// canvas insets beside it rather than being covered — docked left rail on
// desktop, bottom bar on mobile (see .tool-palette in styles.css).
export default function ToolRail() {
  const tool = usePlanStore((s) => s.tool)
  const setTool = usePlanStore((s) => s.setTool)
  const addFloor = usePlanStore((s) => s.addFloor)
  return (
    <div className="tool-palette" role="toolbar" aria-label="Editor tools">
      {TOOLS.map(([id, label, hint]) => (
        <button key={id} className={tool === id ? 'active' : ''}
          onClick={() => setTool(id)} title={hint} aria-label={hint}>
          <ToolIcon name={id} />
          <span>{label}</span>
        </button>
      ))}
      {/* an action, not a mode — set apart from the drawing tools */}
      <span className="tool-sep" aria-hidden="true" />
      <button className="tool-action" onClick={() => addFloor()}
        title="Add a floor (storey)" aria-label="Add a floor">
        <ToolIcon name="floor" />
        <span>Floor</span>
      </button>
    </div>
  )
}
