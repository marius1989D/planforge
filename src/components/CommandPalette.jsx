import React, { useEffect, useMemo, useRef, useState } from 'react'

// ⌘K command palette. `actions` = [{ label, keywords?, hint?, run }].
// Substring match across label+keywords, ranked by match position.
export default function CommandPalette({ open, onClose, actions }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actions
    return actions
      .map((a) => {
        const hay = `${a.label} ${a.keywords || ''}`.toLowerCase()
        const idx = hay.indexOf(q)
        return idx === -1 ? null : { ...a, _score: idx }
      })
      .filter(Boolean)
      .sort((a, b) => a._score - b._score)
  }, [query, actions])

  useEffect(() => setActive(0), [results.length])
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (!open) return null

  const run = (a) => {
    onClose()
    a.run()
  }
  const onKey = (e) => {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(results.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && results[active]) {
      run(results[active])
    }
  }

  return (
    <div className="cmdk-backdrop" onMouseDown={onClose}>
      <div className="cmdk glass" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          placeholder="Type a command… (walls, export, theme, 3D…)"
          aria-label="Search commands"
        />
        <div className="cmdk-list" ref={listRef} role="listbox">
          {results.length === 0 && <div className="cmdk-empty">No matching commands</div>}
          {results.map((a, i) => (
            <button
              key={a.label}
              role="option"
              aria-selected={i === active}
              data-active={i === active}
              className={i === active ? 'active' : ''}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(a)}
            >
              <span>{a.label}</span>
              {a.hint && <kbd>{a.hint}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
