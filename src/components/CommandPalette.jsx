import React, { useEffect, useMemo, useRef, useState } from 'react'

// ⌘K command palette. `actions` = [{ label, keywords?, hint?, group?, run }].
// Substring match across label+keywords, ranked by match position.
// When `searchable` is false (the mobile ☰ menu) the search box is dropped and
// the list is shown in full, split into sections by each action's `group`.
export default function CommandPalette({ open, onClose, actions, searchable = true }) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(searchable ? 0 : -1)
      if (searchable) requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, searchable])

  const results = useMemo(() => {
    if (!searchable) return actions
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
  }, [query, actions, searchable])

  useEffect(() => setActive(searchable ? 0 : -1), [results.length, searchable])
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
        {searchable && (
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Type a command… (walls, export, theme, 3D…)"
            aria-label="Search commands"
          />
        )}
        <div className="cmdk-list" ref={listRef} role="listbox">
          {results.length === 0 && <div className="cmdk-empty">No matching commands</div>}
          {results.map((a, i) => {
            // in menu mode, draw a divider whenever the section changes
            const divider =
              !searchable && i > 0 && a.group !== results[i - 1].group
            return (
              <React.Fragment key={a.label}>
                {divider && <div className="cmdk-divider" role="separator" />}
                <button
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active}
                  className={i === active ? 'active' : ''}
                  onMouseEnter={() => searchable && setActive(i)}
                  onClick={() => run(a)}
                >
                  <span>{a.label}</span>
                  {a.hint && <kbd>{a.hint}</kbd>}
                </button>
              </React.Fragment>
            )
          })}
        </div>
      </div>
    </div>
  )
}
