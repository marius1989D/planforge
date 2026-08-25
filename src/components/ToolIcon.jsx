import React from 'react'

// Stroke-based tool icons on a 24px grid, one consistent style. They inherit
// `currentColor` and the toolbar's stroke settings (see .tool-palette svg).
const PATHS = {
  select: <path d="M5 3l6.5 16 2.2-6.3 6.3-2.2z" />,
  wall: <><rect x="3" y="10" width="18" height="4.5" rx="1" /><path d="M9 10V4M15 14.5V20" /></>,
  door: <><path d="M7 21V4a1 1 0 0 1 1-1h6v18" /><path d="M14 3a7 7 0 0 1 7 7v11" opacity=".55" /><circle cx="11.5" cy="12" r="1" /></>,
  window: <><rect x="4" y="6" width="16" height="12" rx="1" /><path d="M12 6v12M4 12h16" /></>,
  furniture: <><path d="M4 11V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2" /><rect x="3" y="11" width="18" height="6" rx="2" /><path d="M6 17v2M18 17v2" /></>,
  zone: <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3.2 3.4" />,
  stair: <path d="M4 20h4v-4h4v-4h4V8h4" />,
  measure: <><rect x="2.5" y="8" width="19" height="8" rx="1.4" /><path d="M7 8v3M11 8v4M15 8v3M19 8v4" /></>,
}

export default function ToolIcon({ name, className = 'tool-ic' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}
