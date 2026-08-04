# PlanForge — Design Brief & Future Roadmap

Status: Parts 1 (UI overhaul) and 2 (themes) are BUILT. Remaining
from Part 1: full bidirectional ortho-matched 2D<->3D camera morph
(shipped: 3D fly-in from top-down) and Konva-level room fade-ins.
Part 3 progress: multi-floor is BUILT (schema v2, floors[], stairs,
stacked 3D, per-floor PDF). First-person walkthrough is BUILT (walkGeo + WalkMode).
Smart dimensions + door variants are BUILT. Sun/daylight simulation is BUILT. Roadmap sessions 1-7 complete;
Advanced sprint: auto-furnish BUILT, cost estimation BUILT,
elevations BUILT. Advanced sprint COMPLETE: auto-furnish, cost estimation, elevations,
quality pack, AI plan generation. HANDOFF.md written for the next
model. Deferred: curved walls, roof-over-setbacks, collaboration,
photo-to-plan, GLTF furniture, terrain, VR/AR.
Written after completing roadmap steps 1–7 (see README.md). The core
mechanics are done and test-covered; this brief defines what comes
next: the UI overhaul, the theme system, and the advanced feature
roadmap in priority order.

---

## Part 1 — UI overhaul

### Design concept: "the instrument, not the toolbox"

The canvas is the product. Chrome floats over it, never docks around
it. Reference points: Figma, Shapr3D, Spline. Properties:

- Canvas occupies ~95% of the viewport in both 2D and 3D.
- All panels are floating translucent cards: backdrop-blur glass,
  1px hairline borders, soft large-radius shadows, 12–14px corner
  radius. No opaque docked toolbars.
- One confident accent color per theme. Everything else is neutral.
- The Inspector collapses to an icon rail; it expands contextually
  only when something is selected (wall / opening / room / zone /
  furniture) or when Settings is opened.
- Topbar shrinks to: logo mark, plan switcher, view toggle, undo/redo,
  and a single "Share/Export" menu (PNG/PDF/JSON collapse into it).

### Key interactions to add

1. **Command palette (⌘K)** — fuzzy actions: "door", "export pdf",
   "3d view", "rename room", "theme: blueprint". This is the highest
   modern-feel-per-effort item and the power-user accelerator.
2. **Contextual right-click menu** — pill menu at the cursor:
   duplicate / rotate / flip / delete for the thing under the pointer.
   (Currently right-click only cancels drawing chains — preserve that
   inside the draw tools.)
3. **2D↔3D camera fly-through transition** — THE signature moment.
   Switching views animates one camera from top-down orthographic
   (matching the 2D viewport's position/zoom exactly) into the 3D
   perspective orbit, ~600ms ease. The plan and the model must feel
   like one object viewed differently, not two modes. Implementation
   note: render the 3D scene for both views; the "2D" Konva editor
   fades in only after the camera reaches top-down — or interpolate
   an orthographic three.js camera and keep Konva purely for editing
   overlays. Decide during build; prototype first.
4. **Micro-motion** (Framer Motion or spring CSS): rooms fade/scale in
   on detection, dimension lines draw themselves in, panels slide with
   spring physics, selected items get a soft glow pulse. Duration
   discipline: nothing over 250ms except the camera fly (600ms).
5. **Empty-state onboarding** — no tutorial overlay. Empty canvas with
   three ghost buttons: "Draw walls" / "Try a sample home" / "Import".
   First use of each tool shows one inline hint chip, once ever
   (persist dismissals in localStorage). Ship 1–2 sample plans as
   bundled JSON.

### Guiding principle

**Futuristic ≠ busy.** The wow comes from motion, materiality
(glass/glow), and 2D↔3D continuity. The redesign should REMOVE
visible controls, not add them. If a control can live in the command
palette or context menu instead of persistent chrome, it should.

---

## Part 2 — Theme system

### Architecture (do this FIRST — it unlocks everything else)

Extract every color in the codebase into a single design-token object.
Current hardcoded hex values live in: `styles.css` (CSS custom props +
scattered values), `Editor2D.jsx` (ROOM_FILLS, ZONE_FILLS, grid/wall/
snap colors), `View3D.jsx` (MATERIALS), `pdfExport.js` (RGB literals),
`furnitureLibrary.js`, `styleOptions.js`.

Token shape (one object per theme):

```js
{
  id: 'daylight',
  label: 'Daylight',
  // chrome
  panelBg, panelBorder, ink, inkSoft, accent, accentInk, danger,
  // canvas
  canvasBg, gridMinor, gridMajor,
  // plan graphics
  wall, wallSelected, dimension, snapEndpoint, snapWall, snapGrid,
  roomFills: [5 colors], zoneColors: [5 colors],
  doorSymbol, windowSymbol,
  // 3D
  scene3dBg, wall3d, floor3d, roof3d, glass3d,
  // pdf (can derive from the above but allow overrides)
  pdf: { ... }
}
```

Consumption: CSS variables for DOM chrome (swap = set attributes on
:root), the token object passed directly into Konva components, the
3D MATERIALS map, and pdfExport (themed PDF output is a deliberate
feature — a Blueprint-themed PDF should look like a drafting sheet).
Theme choice persists in localStorage, is app-level (not per-plan),
and gets a live-preview picker (thumbnail swatches, not a dropdown).
Respect `prefers-color-scheme` for the DEFAULT only.

### The themes (ship 4, design all 5)

1. **Daylight** (default) — near-white warm canvas, ink-blue walls,
   soft pastel room fills. Scandinavian architecture-studio. Roughly
   the current palette, refined.
2. **Blueprint** — deep indigo canvas (#0d1b3d-ish), white/cyan
   linework, dotted technical grid, room fills as translucent cyan
   washes, white dimension text. The screenshot theme. PDF export in
   this theme mimics a classic drafting sheet (white-on-blue).
3. **Midnight** — true dark: charcoal canvas, luminous accent
   (electric teal or violet), room fills as low-opacity glows, subtle
   bloom on selection. 3D gets a dark environment + warmer interior
   light so windows glow. The "futuristic" one.
4. **Graphite** — monochrome: greys only, high contrast, accent color
   appears ONLY on selection/active states. For minimalists; also
   doubles as a high-legibility/accessibility theme.
5. **Terracotta** (later/seasonal slot) — warm paper canvas, clay and
   olive tones. Proves the token system handles "warm" palettes.

Contrast rule: every theme must keep wall-vs-canvas and text-vs-canvas
at WCAG AA. Check Blueprint and Midnight fills carefully.

---

## Part 3 — Advanced feature roadmap

### Tier 1 — natural next steps (days each)

- **Multi-floor support** ← highest unlock-per-effort on this list.
  Schema: wrap current wall/opening/room/furniture sets in a
  `floors[]` array with per-floor name + level. UI: floor switcher,
  ghost-underlay of the floor below while drawing, stairs as a new
  object type (2D symbol + 3D placeholder). Roof applies to top floor;
  footprint dims to ground floor.
- **Opening variants** — sliding/double doors, swing flip (add a
  `flip`/`variant` field to openings), arched windows.
- **Smart dimension editing** — click a dimension label, type a
  number, the wall network resizes to match (move the far endpoint
  along the wall axis, carry connected walls via moveNodes).
- **Copy/paste/duplicate + mirror/rotate rooms** — detach mechanic
  already solved the hard part; duplicate = detach-clone without
  removing the original.
- **Curved walls** — arcs as first-class walls. Touches snapping,
  face extraction (approximate arcs as polylines in the graph),
  extrusion (segmented curved boxes). Largest Tier-1 item.

### Tier 2 — the "real product" layer

- **First-person walkthrough** — WASD/pointer-lock walk mode in 3D,
  collision from wall data with pass-through at door openings.
  High wow, moderate effort (drei PointerLockControls).
- **Real furniture models** — low-poly GLTF library replacing boxes;
  wall-snapping for wardrobes/counters; clearance warnings (door
  swing arc vs furniture rect intersection — geometry already exists).
- **Sun/daylight simulation** — location + date + time → sun azimuth/
  elevation (standard solar position formula), drive the directional
  light, watch light fall through windows. Window geometry already
  exists; deceptively achievable, very futuristic-feeling.
- **Cost estimation** — generalize the PDF schedule: wall areas ×
  rate, floor areas × rate, opening counts × unit costs, editable
  rate table, currency setting.
- **Terrain & exterior** — plot boundary, garden/driveway zones
  (extends the zone system), simple trees/hedges in 3D.
- **Auto-furnish** — rule-based first ("bedroom" → bed on longest
  wall, clearances respected), AI-assisted later.

### Tier 3 — ambitious horizon

- **AI floor plan generation** — text prompt → schema JSON (the
  schema is a perfect LLM target). Validate + heal the output through
  the existing pipeline. Anthropic API integration.
- **Photo-to-plan** — trace/vectorize an uploaded floor plan image
  into walls (assisted tracing first, auto-vectorization later).
- **Collaboration** — requires the first backend (everything so far
  is client-only). Consider plan-file sync before live cursors.
- **VR/AR** — WebXR walkthrough; AR placement on the real plot.
- **Building-regs hints** — min room sizes, window/floor ratios, door
  widths. Frame as guidance, never compliance.

### Recommended sequence

UI tokens + themes → UI overhaul (panels, ⌘K, camera transition) →
multi-floor → walkthrough → smart dimensions → sun simulation →
furniture models → then reassess.

---

## Build notes for the future session

- FIRST TASK of the UI build: token extraction. Do not write any new
  component while colors are still hardcoded.
- The UI overhaul should be its OWN session (it touches every
  component); don't ride it along with bug fixes or features.
- Test-feel items (drag smoothness, snap radii, zoom curve) may have
  pending feedback from MD's Mac testing — apply that list before or
  during the overhaul, not after.
- Everything client-side until collaboration; keep it that way as
  long as possible.
