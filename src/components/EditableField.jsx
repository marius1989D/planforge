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

// A settings field with two presentations of the *same* input:
//   • desktop (compact=false): the classic inline label + control.
//   • mobile  (compact=true):  a read-only "label · value ✎" row that opens a
//     focused popup holding the real control — cleaner than a wall of inputs.
// `children` is the control itself (input/select/…); it commits to the store
// live via its own onChange, so the popup just needs a Done button to dismiss.
export default function EditableField({ label, value, compact, row = false, children }) {
  const [open, setOpen] = useState(false)

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
