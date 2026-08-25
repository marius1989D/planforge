import React, { useState } from 'react'

function Pencil() {
  return (
    <svg className="pencil-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17z" />
      <path d="M13.5 6.5l3 3" />
    </svg>
  )
}

function Chevron({ open }) {
  return (
    <svg className={`chevron-ic${open ? ' open' : ''}`} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

// A settings field with two presentations of the same value.
//   • desktop (compact=false): the classic inline label + control.
//   • mobile  (compact=true):
//       - select fields (options given): a "label · value ⌄" row that expands
//         an inline list of choices to tap — no popup, no native dropdown.
//       - typed fields (children given): a "label · value ✎" row that opens a
//         focused popup holding the real input.
export default function EditableField({
  label, value, compact, row = false, options, onSelect, children,
}) {
  const [open, setOpen] = useState(false)

  // ---- SELECT MODE ----------------------------------------------------------
  if (options) {
    const current = options.find((o) => String(o.value) === String(value))
    const display = current ? current.label : value
    if (!compact) {
      return (
        <label className="field">
          {label}
          <select value={value} onChange={(e) => onSelect(e.target.value)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      )
    }
    return (
      <div className="field-select">
        <button type="button" className={`field-row${open ? ' expanded' : ''}`}
          aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="field-row-label">{label}</span>
          <span className="field-row-value">{display}</span>
          <span className="field-row-edit"><Chevron open={open} /></span>
        </button>
        {open && (
          <div className="field-options" role="listbox" aria-label={label}>
            {options.map((o) => (
              <button type="button" key={o.value} role="option"
                aria-selected={String(o.value) === String(value)}
                className={String(o.value) === String(value) ? 'active' : ''}
                onClick={() => { onSelect(o.value); setOpen(false) }}>
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ---- TYPED MODE (popup) ---------------------------------------------------
  if (!compact) {
    return (
      <label className="field">
        {label}
        {children}
      </label>
    )
  }

  const trigger = row ? (
    <button type="button" className="field-chip" onClick={() => setOpen(true)}
      aria-label={`Edit ${label}`}>
      <span className="field-chip-value">{value}</span>
      <Pencil />
    </button>
  ) : (
    <button type="button" className="field-row" onClick={() => setOpen(true)}
      aria-label={`Edit ${label}`}>
      <span className="field-row-label">{label}</span>
      <span className="field-row-value">{value}</span>
      <span className="field-row-edit"><Pencil /></span>
    </button>
  )

  return (
    <>
      {trigger}
      {open && (
        <div className="edit-pop-backdrop" onMouseDown={() => setOpen(false)}>
          <div className="edit-pop" role="dialog" aria-label={label}
            onMouseDown={(e) => e.stopPropagation()}>
            <div className="edit-pop-title">{label}</div>
            <div className="edit-pop-body">{children}</div>
            <button type="button" className="edit-pop-done" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </>
  )
}
