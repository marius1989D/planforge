import React from 'react'

// The PlanForge mark — "Cornerstone": two plan-view walls meeting at a corner,
// capped with the two drag-nodes from the editor. Walls take `currentColor`
// (so they follow whatever ink the surrounding chrome uses); the nodes use the
// active theme accent. Scales cleanly down to favicon size.
export default function Logo({ size = 20, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="PlanForge"
    >
      <path fill="currentColor" d="M14 14 H48 V23 H23 V48 H14 Z" />
      <circle cx="48" cy="18.5" r="5" fill="var(--accent)" />
      <circle cx="18.5" cy="48" r="5" fill="var(--accent)" />
    </svg>
  )
}
