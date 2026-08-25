import React, { useRef, useState, useEffect } from 'react'
import { usePlanStore } from './store/planStore'
import Editor2D from './components/Editor2D'
import View3D from './components/View3D'
import Inspector from './components/Inspector'
import ToolRail from './components/ToolRail'
import { exportPlanPdf } from './export/pdfExport'
import { getTheme, THEMES } from './model/themes'
import CommandPalette from './components/CommandPalette'
import AiGenerate from './components/AiGenerate'
import ActionIcon from './components/ActionIcon'
import Logo from './components/Logo'

const TYPE_LABELS = {
  wall: 'wall', opening: 'door/window', room: 'room', zone: 'zone', furniture: 'furniture', stair: 'stairs',
}

// Minimal dropdown menu (closes on outside click / Esc)
function Menu({ label, items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="menu" ref={ref}>
      <button className="menu-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label} ▾
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          {items.map((item, i) =>
            item === 'divider' ? (
              <div key={i} className="menu-divider" />
            ) : (
              <button key={i} role="menuitem" className={item.danger ? 'danger' : ''}
                onClick={() => { setOpen(false); item.onClick() }}>
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}

// Settings gear (mobile action bar): tap to switch the design system.
function SettingsMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const themeId = usePlanStore((s) => s.theme)
  const setTheme = usePlanStore((s) => s.setTheme)
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  return (
    <div className="settings-menu" ref={ref}>
      <button className="subbar-btn settings-btn" onClick={() => setOpen((o) => !o)}
        title="Appearance" aria-label="Appearance" aria-expanded={open}>
        <ActionIcon name="settings" />
      </button>
      {open && (
        <div className="settings-panel glass" role="menu">
          <p className="settings-h">Appearance</p>
          <div className="theme-picker" role="radiogroup" aria-label="Theme">
            {Object.values(THEMES).map((t) => (
              <button key={t.id} role="radio" aria-checked={themeId === t.id}
                className={themeId === t.id ? 'active' : ''} title={t.label}
                onClick={() => { setTheme(t.id); setOpen(false) }}>
                <span className="theme-swatch">
                  {t.swatch.map((c, i) => <i key={i} style={{ background: c }} />)}
                </span>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const plan = usePlanStore((s) => s.plan)
  const plansIndex = usePlanStore((s) => s.plansIndex)
  const renamePlan = usePlanStore((s) => s.renamePlan)
  const newPlan = usePlanStore((s) => s.newPlan)
  const switchPlan = usePlanStore((s) => s.switchPlan)
  const duplicatePlan = usePlanStore((s) => s.duplicatePlan)
  const deleteCurrentPlan = usePlanStore((s) => s.deleteCurrentPlan)
  const importPlan = usePlanStore((s) => s.importPlan)
  const exportPlan = usePlanStore((s) => s.exportPlan)
  const undo = usePlanStore((s) => s.undo)
  const redo = usePlanStore((s) => s.redo)
  const canUndo = usePlanStore((s) => s._history.undo.length > 0)
  const canRedo = usePlanStore((s) => s._history.redo.length > 0)
  const selection = usePlanStore((s) => s.selection)
  const setSelection = usePlanStore((s) => s.setSelection)
  const duplicateSelected = usePlanStore((s) => s.duplicateSelected)
  const deleteWall = usePlanStore((s) => s.deleteWall)
  const deleteOpening = usePlanStore((s) => s.deleteOpening)
  const deleteManualRoom = usePlanStore((s) => s.deleteManualRoom)
  const deleteFurniture = usePlanStore((s) => s.deleteFurniture)
  const deleteStair = usePlanStore((s) => s.deleteStair)
  const addFloor = usePlanStore((s) => s.addFloor)
  const setWalkMode = usePlanStore((s) => s.setWalkMode)
  const [aiOpen, setAiOpen] = useState(false)
  const pngExporter = usePlanStore((s) => s.pngExporter)
  const themeId = usePlanStore((s) => s.theme)
  const setTheme = usePlanStore((s) => s.setTheme)
  const setTool = usePlanStore((s) => s.setTool)
  const setInspectorOpen = usePlanStore((s) => s.setInspectorOpen)
  const loadSamplePlan = usePlanStore((s) => s.loadSamplePlan)
  const setShowDimensions = usePlanStore((s) => s.setShowDimensions)
  const setImportOpener = usePlanStore((s) => s.setImportOpener)
  const view = usePlanStore((s) => s.view)
  const setView = usePlanStore((s) => s.setView)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const fileRef = useRef(null)

  // track the mobile breakpoint so the ☰ menu can hide actions the
  // always-visible sub-toolbar already exposes (theme, undo, redo, delete,
  // duplicate). Desktop ⌘K keeps the full list.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)')
    const onChange = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // ⌘K opens the command palette from anywhere
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // let the empty-state "Import" button trigger the hidden file input
  useEffect(() => {
    setImportOpener(() => () => fileRef.current?.click())
    return () => setImportOpener(null)
  }, [setImportOpener])

  // on phones the inspector starts collapsed so the canvas isn't buried
  useEffect(() => {
    if (window.matchMedia('(max-width: 760px)').matches) setInspectorOpen(false)
  }, [setInspectorOpen])

  // apply the active design system (colour + type + shape + depth) as CSS vars
  useEffect(() => {
    const t = getTheme(themeId)
    const c = t.chrome
    const r = document.documentElement.style
    r.setProperty('--paper', c.paper)
    r.setProperty('--panel', c.panel)
    r.setProperty('--panel-2', c.panel2 || c.panel)
    r.setProperty('--line', c.line)
    r.setProperty('--ink', c.ink)
    r.setProperty('--ink-soft', c.inkSoft)
    r.setProperty('--accent', c.accent)
    r.setProperty('--accent-ink', c.accentInk)
    r.setProperty('--danger', c.danger)
    r.setProperty('--success', c.success || c.accent)
    r.setProperty('--rail-bg', c.railBg || c.panel)
    r.setProperty('--rail-ink', c.railInk || c.inkSoft)
    r.setProperty('--topbar-bg', c.topbarBg)
    r.setProperty('--topbar-border', c.topbarBorder)
    r.setProperty('--topbar-ink', c.topbarInk)
    r.setProperty('--topbar-ink-soft', c.topbarInkSoft)
    // typography
    r.setProperty('--font-ui', t.type.ui)
    r.setProperty('--font-display', t.type.display)
    r.setProperty('--font-mono', t.type.mono)
    // shape + depth
    r.setProperty('--radius', t.shape.radius)
    r.setProperty('--radius-lg', t.shape.radiusLg)
    r.setProperty('--shadow', t.depth.shadow)
    document.documentElement.dataset.theme = themeId
  }, [themeId])

  const selType = selection ? TYPE_LABELS[selection.type] : null
  const canDeleteSel = selection && selection.type !== 'room'

  const deleteSelected = () => {
    if (!selection) return
    if (selection.type === 'wall') deleteWall(selection.id)
    else if (selection.type === 'opening') deleteOpening(selection.id)
    else if (selection.type === 'zone') deleteManualRoom(selection.id)
    else if (selection.type === 'furniture') deleteFurniture(selection.id)
    else if (selection.type === 'stair') deleteStair(selection.id)
    setSelection(null)
  }

  const download = (url, filename) => {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }
  const safeName = () => (plan.name || 'plan').replace(/\s+/g, '_')

  const handleExportJson = () => {
    const blob = new Blob([exportPlan()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    download(url, `${safeName()}.planforge.json`)
    URL.revokeObjectURL(url)
  }
  const handleExportPng = () => {
    const dataUrl = pngExporter?.()
    if (dataUrl) download(dataUrl, `${safeName()}.png`)
    else alert('Switch to the 2D Plan view to export a PNG of the drawing.')
  }
  const handleImport = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        importPlan(JSON.parse(reader.result))
      } catch {
        alert('That file is not a valid PlanForge plan.')
      }
    }
    reader.readAsText(file)
  }

  // full command set (desktop ⌘K). Anything flagged `mobileBar` is already
  // reachable elsewhere in the mobile chrome — the bottom tool bar, the
  // sub-toolbar (theme + undo/redo/delete/duplicate), the topbar 2D/3D
  // switch, or the in-view walk control — so it's filtered out of the ☰ menu
  // to avoid duplicates. The desktop ⌘K palette keeps every command.
  const paletteActions = [
    { label: 'Select tool', keywords: 'pointer move', hint: 'V', run: () => { setView('2d'); setTool('select') }, mobileBar: true },
    { label: 'Draw walls', keywords: 'wall tool', hint: 'W', run: () => { setView('2d'); setTool('wall') }, mobileBar: true },
    { label: 'Place door', keywords: 'opening', hint: 'D', run: () => { setView('2d'); setTool('door') }, mobileBar: true },
    { label: 'Place window', keywords: 'opening glass', hint: 'N', run: () => { setView('2d'); setTool('window') }, mobileBar: true },
    { label: 'Place furniture', keywords: 'sofa bed table library', hint: 'F', run: () => { setView('2d'); setTool('furniture') }, mobileBar: true },
    { label: 'Draw zone', keywords: 'open plan area kitchen', hint: 'Z', run: () => { setView('2d'); setTool('zone') }, mobileBar: true },
    { label: 'Place stairs', keywords: 'staircase floor up', hint: 'S', run: () => { setView('2d'); setTool('stair') }, mobileBar: true },
    { label: 'Measure a distance', keywords: 'tape ruler length', hint: 'M', run: () => { setView('2d'); setTool('measure') }, mobileBar: true },
    { label: 'Add a floor', keywords: 'storey level upstairs', run: addFloor },
    {
      label: 'Toggle sun & daylight simulation', keywords: 'sunlight shadows solar time',
      run: () => {
        const st = usePlanStore.getState()
        st.setSunSettings({ enabled: !st.plan.sun?.enabled })
        setView('3d')
      },
    },
    { label: 'Switch to 2D plan', keywords: 'view editor', run: () => setView('2d'), mobileBar: true },
    { label: 'Switch to 3D view', keywords: 'view model', run: () => setView('3d'), mobileBar: true },
    { label: 'Walk through the home', keywords: 'first person walkthrough tour explore', run: () => { setView('3d'); setWalkMode(true) }, mobileBar: true },
    { label: 'Undo', hint: '⌘Z', run: undo, mobileBar: true },
    { label: 'Redo', hint: '⇧⌘Z', run: redo, mobileBar: true },
    { label: 'Duplicate selected item', hint: '⌘D', run: duplicateSelected, mobileBar: true },
    { label: 'Delete selected item', keywords: 'remove', hint: 'Del', run: deleteSelected, mobileBar: true },
    {
      label: 'Auto-furnish selected room…', keywords: 'furniture layout bedroom living kitchen fill',
      run: () => { setInspectorOpen(true) },
    },
    { label: 'Export PNG image', keywords: 'download picture', run: handleExportPng },
    { label: 'Export PDF drawing + schedules', keywords: 'download print', run: () => exportPlanPdf(plan, getTheme(themeId)) },
    { label: 'Export JSON project file', keywords: 'download save', run: handleExportJson },
    { label: 'New project', run: () => newPlan('Untitled Plan') },
    { label: 'Duplicate project', keywords: 'copy plan', run: duplicatePlan },
    { label: 'Import project…', keywords: 'open load json', run: () => fileRef.current?.click() },
    { label: 'Generate a plan with AI…', keywords: 'ai claude describe magic create', run: () => setAiOpen(true) },
    { label: 'Load the sample home', keywords: 'demo example bungalow try', run: loadSamplePlan },
    ...Object.values(THEMES).map((t) => ({
      label: `Theme: ${t.label}`, keywords: 'appearance color dark light', run: () => setTheme(t.id), mobileBar: true,
    })),
    { label: 'Show dimensions', keywords: 'measurements on', run: () => setShowDimensions(true) },
    { label: 'Hide dimensions', keywords: 'measurements off', run: () => setShowDimensions(false) },
    { label: 'Open settings panel', keywords: 'inspector sidebar', run: () => setInspectorOpen(true) },
  ]
  // on mobile, drop the actions the always-visible bars already expose
  const menuActions = isMobile ? paletteActions.filter((a) => !a.mobileBar) : paletteActions

  return (
    <div className="app">
      <header className="topbar">
        {/* project identity */}
        <span className="logo" aria-label="PlanForge">
          <Logo size={26} className="logo-mark" />
          <span className="logo-word">Plan<span className="logo-accent">Forge</span></span>
        </span>
        <select className="plan-select" value={plan.id}
          onChange={(e) => switchPlan(e.target.value)} aria-label="Open plan">
          {plansIndex.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input className="plan-name" value={plan.name}
          onChange={(e) => renamePlan(e.target.value)} aria-label="Plan name" />

        <div className="view-switch" role="tablist">
          <button role="tab" aria-selected={view === '2d'}
            className={view === '2d' ? 'active' : ''}
            onClick={() => setView('2d')}>2D Plan</button>
          <button role="tab" aria-selected={view === '3d'}
            className={view === '3d' ? 'active' : ''}
            onClick={() => setView('3d')}>3D View</button>
        </div>

        <div className="topbar-actions">
          {/* mobile: one button opens the command palette, which holds every action */}
          <button className="mobile-only topbar-menu-btn" onClick={() => setPaletteOpen(true)}
            title="Menu" aria-label="Open menu">☰</button>

          {/* history */}
          <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">↩</button>
          <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">↪</button>
          <span className="topbar-sep" />

          {/* selected item */}
          <button onClick={duplicateSelected} disabled={!selection}
            title={selection ? `Duplicate ${selType} (⌘D)` : 'Select something to duplicate'}>
            Duplicate
          </button>
          <button onClick={deleteSelected} disabled={!canDeleteSel}
            title={!selection ? 'Select something to delete'
              : selection.type === 'room'
                ? 'Rooms are defined by their walls — delete walls individually'
                : `Delete ${selType} (Del)`}>
            Delete
          </button>
          <span className="topbar-sep" />

          {/* project + export menus */}
          <Menu label="Project" items={[
            { label: 'New project', onClick: () => newPlan('Untitled Plan') },
            { label: 'Duplicate project', onClick: duplicatePlan },
            { label: 'Import project…', onClick: () => fileRef.current?.click() },
            { label: '✨ Generate with AI…', onClick: () => setAiOpen(true) },
            'divider',
            {
              label: 'Delete project…', danger: true,
              onClick: () => {
                if (confirm(`Delete the project "${plan.name}"? This cannot be undone.`)) {
                  deleteCurrentPlan()
                }
              },
            },
          ]} />
          <Menu label="Export" items={[
            { label: 'PNG image', onClick: handleExportPng },
            { label: 'PDF drawing + schedules', onClick: () => exportPlanPdf(plan, getTheme(themeId)) },
            { label: 'JSON project file', onClick: handleExportJson },
          ]} />
          <input ref={fileRef} type="file" accept=".json,application/json"
            style={{ display: 'none' }} onChange={handleImport} />
        </div>
      </header>

      {/* mobile sub-toolbar: appearance + critical actions, always in sight */}
      <div className="subbar" role="toolbar" aria-label="Quick actions">
        <SettingsMenu />
        <span className="subbar-sep" aria-hidden="true" />
        <button className="subbar-btn" onClick={undo} disabled={!canUndo}
          title="Undo (⌘Z)" aria-label="Undo"><ActionIcon name="undo" /></button>
        <button className="subbar-btn" onClick={redo} disabled={!canRedo}
          title="Redo (⇧⌘Z)" aria-label="Redo"><ActionIcon name="redo" /></button>
        <button className="subbar-btn" onClick={deleteSelected} disabled={!canDeleteSel}
          title="Delete selected" aria-label="Delete"><ActionIcon name="trash" /></button>
        <button className="subbar-btn" onClick={duplicateSelected} disabled={!selection}
          title="Duplicate selected" aria-label="Duplicate"><ActionIcon name="duplicate" /></button>
      </div>

      <main className="workspace">
        {view === '2d' && <ToolRail />}
        {view === '2d' ? <Editor2D /> : <View3D />}
        <Inspector />
      </main>

      {aiOpen && <AiGenerate onClose={() => setAiOpen(false)} />}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={menuActions}
      />
    </div>
  )
}
