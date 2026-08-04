# PlanForge

2D floor plan editor with live 3D preview. React 18 + Vite + Konva (2D) + react-three-fiber (3D) + Zustand.

## Run

```bash
npm install
npm run dev
```

## Architecture

Walls are the source of truth. Rooms are derived — either auto-detected from
closed wall loops, or manually drawn zones for open-plan layouts. Openings
(doors/windows) reference a wall + offset so they move with the wall.
All lengths are **mm internally**; display conversion lives only in
`src/model/units.js`.

```
src/
  model/schema.js       ← THE contract. Factories + defaults. Read this first.
  model/units.js        ← mm ↔ display formatting
  geometry/geo.js       ← shared math. detectRooms() + wallSegments(). Tests: geo.test.mjs.
  store/planStore.js    ← Zustand store, all mutations, localStorage autosave
  components/Editor2D   ← Konva canvas (grid, walls, room fills, opening markers; tools = step 2)
  components/View3D     ← r3f scene (segmented walls + opening cuts, floors, glazing)
  components/Inspector  ← stats panel + dev tools
```

## What's next

See **DESIGN.md** for the full design brief: UI overhaul concept,
theme system architecture (token extraction is the mandatory first
step), and the tiered advanced-feature roadmap with recommended
sequence.

## Build roadmap

- [x] **1. Schema + store + skeleton** (this)
- [x] **2. 2D wall editor** — chained wall drawing, endpoint/wall/grid snapping, auto-split at T-junctions and crossings, select/move/corner-drag/delete, zone polygon tool, pan/zoom
- [x] **3. Room auto-detection + 3D extrusion engine** — planar-graph face extraction, segmented wall extrusion with opening cuts, room floors, zone overlays
- [x] **4. Doors & windows** — Door (D) / Window (N) tools with hover preview, click-to-place centered on cursor, 2D door swing arcs + window symbols, select/slide-along-wall dragging, width/position/height/sill editing in Inspector, Delete to remove. (3D hole cutting was already done in step 3.)
- [x] **5. Multi-plan manager + undo/redo** — plans index in localStorage (switch/duplicate/delete/import via topbar), debounced saves keyed by plan id, legacy single-plan migration. Undo/redo (⌘Z / ⇧⌘Z) with drag coalescing (snapshot at drag start + history-free per-frame updates = one undo step per gesture) and tag coalescing for field edits.
- [x] **6. Furniture** — 13-item library (Furniture tool, F), click-to-place repeatedly, drag to move, R rotates 90°, rotation/dimensions editable in Inspector, colored boxes in 3D, rendered on PDF page 1 with labels.
- [x] **7. Polish** — PNG export, flat roof, AND: pitched hip roofs over the true building footprint(s), exterior dimension lines (2D + PDF, toggleable), wall/floor colour presets for 3D.

## Notes for future sessions

- Every mutation goes through `_commit()` in the store; wall changes pass
  `{ recompute: true }` which re-derives auto rooms (no-op until step 3).
- Manual rooms (`source: "manual"`) are never touched by recomputation.
- 2D uses Konva screen scale `SCALE = 0.05` (1px = 20mm). 3D uses metres.
- Konva is y-down; three.js maps plan y → world z (see `WallBox`).

## Step 3 implementation notes

- `detectRooms(walls)`: merges endpoints into graph nodes (10mm tolerance),
  extracts planar faces via clockwise-next half-edge traversal. Interior
  faces have **positive** shoelace area in y-down plan coords; the outer
  face is negative and dropped. Verified in `src/geometry/geo.test.mjs`
  (run: `node src/geometry/geo.test.mjs`).
- Auto room ids are deterministic hashes of the wall-loop id set → renames
  survive recomputation (see `withRecomputedRooms` in the store).
- 3D walls use **segment decomposition** instead of CSG: each wall becomes
  solid boxes (full segments, door lintels, window sills+lintels). Simple,
  artifact-free, and fully covered by tests including area conservation.
- Known limitation for step 2 to solve: walls that cross without a shared
  endpoint don't form an intersection node — the drawing tools should
  auto-split walls at junctions when drawing.

## Step 2 implementation notes

- Drawing commits through `addWallWithSplits` → `splitPlanWalls` in geo.js:
  T-junctions and crossings split both the existing walls and the new wall,
  with openings reassigned (offset-adjusted) to the correct half. Tests in
  `src/geometry/split.test.mjs`.
- Corner dragging uses `moveNodes`: all wall endpoints coincident with the
  dragged point move together, so rooms stay connected. Dragging a wall body
  translates both of its nodes (adjacent walls stretch).
- The Konva Stage itself is scaled/panned; all shapes render in plan mm and
  screen-constant elements (text, handles, hairlines) divide by scale.
- Shortcuts: V select · W wall · Z zone · Esc cancel/deselect · Del delete.
  Right-click or double-click ends a wall chain / closes a zone.

## Feedback round 1 (implemented)

- **Zoom speed**: pointer-centered zoom slowed to ~3%/notch with delta
  normalization + clamping so trackpad flicks can't compound into a jump.
- **Scroll to pan**: plain two-finger scroll now PANS the canvas.
  Pinch (wheel + ctrlKey, how browsers report trackpad pinch) or
  Cmd/Ctrl + scroll ZOOMS. Drag empty space / middle-drag still pans.
- **Whole room/zone dragging** (Select tool, click inside the fill):
  - Manual zones translate rigidly (every vertex moves).
  - Auto rooms move via `moveRoom` in the store: nodes touched only by
    the room's own walls move; nodes shared with outside walls are
    pinned, so a shared dividing wall STRETCHES instead of tearing away
    (verified by `src/store/planStore.test.mjs` — a standalone room
    moves rigidly, area preserved; a room with one shared wall grows).
  - Wall hit-test still wins over room fill, so precise wall selection
    is unaffected. Hovering a draggable target shows a move cursor.
  - Deliberate limitation: no whole-room delete (ambiguous with shared
    walls) — delete individual walls instead.
- **PDF export** (`src/export/pdfExport.js`, jspdf + jspdf-autotable):
  Page 1 = vector floor plan at an auto-picked architectural scale
  (1:20…1:2000) with title block, wall quads with real opening gaps,
  door swing arcs, double-line window symbols, room fills + labels,
  dashed zone outlines, graphic scale bar, legend. Page 2 = room
  schedule table (name, type, bounding size, area) with totals footer.
  Rendering verified by rasterizing the output and color-sampling each
  element class, plus pdftotext content checks.

## Test suite

```bash
node src/geometry/geo.test.mjs      # face extraction, wall segments (17)
node src/geometry/split.test.mjs    # junction splitting, room-node classify (16)
node src/store/planStore.test.mjs   # moveRoom store behavior (10)
```

## Feedback round 2 (implemented)

- **Rooms vanishing when joined** (root cause: collinear overlapping
  walls are invisible to segment-intersection math, so no junction
  nodes were created and face extraction lost the loops):
  `healPlanWalls` in geo.js now globally normalizes the wall graph —
  splits any wall at other walls' endpoints (covers T-junctions AND
  collinear overlaps), splits X crossings, drops degenerate walls,
  dedupes coincident segments (remapping openings, flipping offsets on
  reversed duplicates). Runs on every wall commit and on drag-end
  (`healWalls` store action), so dragging a room against another now
  forms real junctions too. Tests: `src/geometry/heal.test.mjs`
  (includes an exact reproduction of the reported scenario) and the
  join test in `src/store/planStore.test.mjs`.
- **Duplicate room labels**: name reconciliation is now two-stage —
  custom names follow the loop id, then fall back to nearest-centroid
  matching (<2m); default "Room N" names are renumbered fresh each
  recompute so two rooms can never both display "Room 2".
- **Zoom speed**: exponential curve on the raw wheel delta, clamped
  per event (trackpad pinch ≈1–4% steps, mouse notch ≈12%) — between
  the original too-fast and the round-1 too-slow tuning.

Note: `splitPlanWalls` is retained (tested, used as reference) but the
store now routes everything through `healPlanWalls`.

## Detach-and-clone room dragging (replaces stretch behavior)

Dragging a whole room (Select tool, click the fill) now SEPARATES it:
- On first movement, `detachRoom` clones every party wall (wall id
  present in >1 auto room). Originals stay with the neighbor, clones
  travel with the dragged room, which becomes fully self-contained.
- `translateWalls` moves the room's walls BY ID (not by node position,
  which would drag the neighbor's coincident original along).
- Openings on a party wall stay with the ORIGINAL (a doorway belongs
  to the boundary that remains; the departing clone is solid).
- Drop + heal-on-drag-end merges coincident walls, so dropping the
  room against another structure rejoins them into shared walls.
- Single-wall and corner-handle drags keep the stretch behavior (that
  is resize, not separation). Zones translate as before.
- `classifyRoomNodes` is no longer used by the store (superseded);
  kept in geo.js with its tests.
Tests: `src/store/planStore.test.mjs` — detach/doorway ownership/rigid
move/untouched neighbor/rejoin/row-of-three/standalone regression.

## Steps 5–7 session notes

- Persistence: `planforge_index` + `planforge_plan_<id>` + `planforge_current_id`.
  Old `planforge_current` migrates automatically. Saves debounce 400ms but are
  keyed by plan id, so a pending save can't leak into another plan after switch.
- History lives in `_history {undo, redo, lastTag}` (not persisted, cleared on
  plan switch, capped at 50). Rules: normal actions push pre-mutation snapshots;
  same-tag consecutive commits coalesce; per-frame drag actions pass
  history:false and the editor calls snapshot() at drag start; healWalls is
  history:false (part of the drag gesture).
- Furniture position = item CENTER; rotation degrees clockwise (Konva y-down
  convention, hit-tested via pointInRotRect, 3D negates to radians).
- PNG export: Editor2D registers stage.toDataURL in the store (pngExporter);
  only available while the 2D view is mounted.

## Step 7 completion notes

- **Footprints**: `extractFootprints` reuses the planar-graph face
  traversal (refactored into `extractFaces`) — the building outline is
  simply each component's negative (outer) face, reversed to positive
  orientation and collinear-simplified (heal junctions are graph nodes,
  not corners). Tests: `footprint.test.mjs`.
- **Pitched roofs** (`src/geometry/roofGeo.js`): a uniform-pitch hip
  roof surface is exactly z = tan(pitch) × distance-to-boundary (the
  straight-skeleton surface), so instead of implementing skeleton event
  handling we earcut-triangulate the footprint, midpoint-subdivide to
  ~0.35m edges, and displace vertices by the distance function. Ridges
  and hips emerge naturally; eaves are exact. Verified numerically in
  `roof.test.mjs` (rectangle ridge = inradius·tan(pitch); L-shape ridge
  = pocket inscribed-circle radius; 45°/30° ratio = √3). Pitch is
  configurable 10–55° in Settings.
- **Dimension lines**: `footprintDimensions` offsets each exterior edge
  600mm outward (outward normal = (dy,−dx) for the positively-oriented
  footprint) with extension lines, 45° ticks, and length labels.
  Rendered in the 2D editor and on PDF page 1 (bounds padded so they
  fit); toggle in Settings.
- **Materials**: plan-level wall/floor colour presets (styleOptions.js)
  applied in the 3D view.

## Polish round (Mac feedback #2)

- **Door swing auto-detect**: at placement, both wall faces are probed
  (midpoint ± normal × (thickness/2+150), point-in-polygon vs rooms);
  the leaf opens into the room. Interior doors (rooms both sides) are
  ambiguous → default + **Flip swing / Flip hinge** buttons in the
  Inspector. `swingSide` (±1, wall-normal sign) and `hinge`
  (start/end) live on the opening; 2D and PDF render both.
- **Opening resize handles**: selected doors/windows get end handles —
  drag one end, the other anchors, 50mm snap, 300mm minimum. Numeric
  inputs remain.
- **Opening tags**: architectural convention — D1/D2/W1… tags on the
  plan (styled apart from wall dimensions), sizes in a **Door & Window
  Schedule** table on PDF page 2 (`openingTags` in schema.js).
- **Furniture**: dimension labels under names; ghost preview of the
  armed item at the cursor (R rotates it before placing); place →
  auto-switch to Select with the item selected (Shift-click places
  multiples); 4 corner resize handles with opposite-corner anchoring
  that works on rotated items (pointer transformed into the item's
  local frame), 50mm snap, 100mm minimum.
- **Zones**: per-edge length labels (edges ≥ 600mm).
- **Wall thickness at draw time**: floating chip when the Wall tool is
  active — Exterior 300 / Interior 150 / custom — applies to every
  wall drawn until changed.
- **Topbar redesign**: scoped sections — history (↩↪) · selected item
  (Duplicate ⌘D / Delete, disabled without a selection, tooltips name
  the target; room deletion intentionally disabled) · **Project ▾**
  menu (New / Duplicate project / Import / Delete project…) ·
  **Export ▾** menu (PNG/PDF/JSON). `duplicateSelected` in the store
  clones per type with clear-of-original offsets (room copies land
  outside the original so drag-end healing can't slice them) — tested.
- **Inspector selection feel**: the selected item's panel gets an
  accent left bar + a glow pulse (retriggered per selection), and the
  matching room-list row highlights.

## Session 1 fixes (Mac feedback #3)

- **Room drags carry contents**: at the first movement of a room drag,
  `getRoomContents` captures furniture (center-in-polygon) and zones
  (centroid-in-polygon) ONCE — membership isn't re-tested mid-drag —
  then `translateRoomParts` moves walls + furniture + zones in one
  commit per frame (whole gesture = one undo step). Duplicating a
  furnished room clones its contents in the same single commit.
- **Zones selectable inside rooms**: hit-test priority reordered to
  zones-before-rooms (the more specific target wins, matching render
  order). Grab the room via any area outside the zone or a wall.

## Session 2 — design tokens + themes (DESIGN.md part 2 complete)

- All colors extracted into `src/model/themes.js` token objects:
  chrome (→ CSS variables set by App.jsx), canvas + plan (→ Konva in
  Editor2D), three (→ 3D materials/background/grid), pdf (→ themed
  export, solid-hex print equivalents of the translucent screen fills).
- Four themes shipped: **Daylight** (default), **Blueprint** (drafting
  sheet — including the PDF, pixel-verified), **Midnight** (dark,
  electric-teal accent), **Graphite** (monochrome, accent only on
  selection; `furnitureMono` token overrides library colors for
  mono/duotone themes).
- Theme picker with palette swatches in Inspector → Appearance;
  app-level, persisted as `planforge_theme`.
- Plan-level wall/floor colour overrides still beat theme defaults in 3D.

## Session 3 — UI overhaul (DESIGN.md part 1)

- **Glass chrome**: canvas fills the workspace; inspector, tool
  palettes, wall-options chip, status pill, dropdowns, and topbar are
  floating translucent blurred cards (theme-aware via color-mix on the
  CSS variables). Inspector collapses to a rail button and auto-opens
  on selection.
- **⌘K command palette** (`CommandPalette.jsx`): ~26 actions — tools,
  views, undo/redo, selection duplicate/delete, exports, project ops,
  all four themes, dimensions toggle, sample home. Substring-ranked,
  arrow/enter navigation.
- **Right-click context menu** (Select tool only; draw tools keep
  right-click = cancel): per-target actions — doors get Flip swing /
  Flip hinge, furniture gets Rotate 90°, everything gets Duplicate,
  Delete where allowed.
- **3D fly-in**: entering 3D starts the camera top-down over the plan
  (echoing the 2D view) and eases into the orbit pose over 700ms;
  controls unlock on landing. Skipped under prefers-reduced-motion,
  which also disables all CSS motion. (Full bidirectional
  ortho-matched 2D↔3D morph remains future work per DESIGN.md.)
- **Onboarding empty state**: ghost-button card — Draw walls / Try a
  sample home / Import — replacing the old dev hint. The **sample
  home** (`samplePlan.js`) is a furnished 2-bed bungalow with 3 doors,
  5 windows, kitchen zone, 10 furniture pieces, and a pitched roof,
  built through the real heal/detect pipeline and test-verified.
- Tool and view state lifted to the store (ephemeral) so palette,
  context menu, keyboard, and toolbars stay in sync.

## Session 4 — multi-floor (schema v2)

- **Schema v2**: plan content (walls/openings/rooms/furniture + new
  stairs) lives in `floors[]`; `migratePlan` transparently upgrades v1
  files on load/import (localStorage and JSON alike) — test-verified.
- **Store**: full rewrite around `mutateFloor` — every geometry and
  content action targets the ACTIVE floor; per-floor room
  recomputation; floor management (add copies the shell walls of the
  top floor, rename, delete with ≥1 guard, switch); stairs CRUD; room
  drags and duplication now carry stairs too. Tests cover floor
  isolation (drawing upstairs never touches downstairs), stair carry,
  and migration (82 store tests).
- **2D**: floor tabs in the Inspector; ghost underlay of the floor
  below (walls + stairs at 16% opacity) for tracing upper storeys;
  stair tool (S) — place, drag, R-rotate, resize in panel, context
  menu, duplicate — rendered as outline + treads + UP arrow with a
  size label.
- **3D**: the whole building renders stacked — each floor's walls,
  rooms, zones, furniture, and glazing at its elevation (sum of wall
  heights below); stairs as solid stepped boxes rising exactly one
  storey toward their UP arrow; flat/pitched roof caps the TOP floor's
  footprint at total building height.
- **PDF**: one drawing page per floor ("Plan — Floor name"), schedules
  gain a Floor column across all floors with per-floor opening tags —
  verified on a generated two-storey document.
- Known limitation (documented): when an upper floor is smaller than
  the one below, the exposed lower area isn't separately roofed.

## Session 5 — first-person walkthrough

- **Walk mode**: the "🚶 Walk through" pill in the 3D view (or ⌘K →
  "Walk through the home") enters pointer-lock first-person: mouse
  looks, WASD/arrows move, Shift runs, Esc exits (camera pose is
  saved and restored around the walk; the fly-in doesn't replay).
- **Ground-follow**: pure-geometry support sampling (`walkGeo.js`,
  19 node tests) — the player stands on the highest reachable support
  with a ≤0.35m step-up: floor slabs (room polygons at their
  elevations), stair step-tops (exact same step field the 3D renders),
  always ground. Climbing a stair hands you to the upper floor at the
  top; walking off drops you to the support below.
- **Collision**: circle-vs-wall push-out (two passes for corners)
  against the current floor's walls — **doors pass through, windows
  don't**. Spawn is just inside the entrance door, facing into the
  room (falls back to the largest room's centroid).

## Session 6 — smart dimensions + opening variants

- **Smart dimension editing**: exterior dimension labels are live —
  click one, type a length (metres; large bare numbers read as mm),
  Enter. `resizeFootprintEdge` translates everything at/beyond the
  edited corner's perpendicular line along the edge axis: walls
  stretch, the far band moves rigidly, furniture/stairs/zones in the
  rigid band travel; items in the stretching region keep absolute
  position; openings clamp to their resized walls. One undo step.
  Store-tested (grow, shrink, contents, opening validity, undo).
- **Exact wall length**: selected walls get a Length field (Enter or
  blur commits) — `resizeWallLength` moves the END node along the wall
  axis; walls sharing that node follow.
- **Door variants**: single (default) / **double** (two half-leaves
  hinged at both jambs) / **sliding** (two overlapping face-offset
  panels, no swing). Panel select in the Inspector (hinge flip hidden
  for double, both flips for sliding); rendered in 2D and PDF —
  PDF geometry verified coordinate-exactly by parsing the vector
  content stream (900mm leaf, 800mm half-leaves 1600mm apart, 58%-span
  overlapping panels at 1:50). Schedule shows "Door (double/sliding)".
  Arched windows deferred (3D geometry work).

## Session 7 — sun & daylight simulation

- **Solar engine** (`sunGeo.js`, 15 known-answer tests): declination +
  equation of time + hour angle → azimuth/elevation. Verified against
  astronomy: solstice/equinox elevations within 1.5°, hemisphere
  behavior (June noon sun in the NORTH at 35°S), east-morning/
  west-evening azimuths, night detection. Timezone defaults to the
  longitude's natural zone.
- **3D lighting rig**: enable in Settings → "Sun & daylight". Pick a
  date, drag the time slider (05:00–22:00), set lat/lon (defaults to
  Bucharest). The directional light tracks the real sun — plan top =
  North — with warm color below 25° elevation, intensity following
  sin(elevation), a scene-sized shadow camera, and a dim cool night
  rig below the horizon. Window glazing casts no shadows, so sunlight
  falls through windows onto floors — drag the slider and watch the
  patches sweep the room. Live readout shows e.g. "sun 45° · SSE".
- **North arrow** on every PDF drawing page (orientation now means
  something), plus a ⌘K toggle.

## Hotfix — white screen on Mac (runtime bugs invisible to build + node tests)

Two Session-4 sed casualties, both found by executing the REAL bundled
app in happy-dom (new smoke harness):

1. `useAddDemoRoom`'s zustand selector: `(s) => s.plan.walls.length`
   was mechanically renamed to `s.floor.walls.length`, but the store
   has no `floor` field (it's derived per-component) → Inspector
   crashed on mount → white screen on EVERY plan.
2. Theme tokens `T.plan.furnitureMono` / `T.plan.furnitureText`
   contain the substring `plan.furniture`, so the rename mangled them
   to `T.floor.furniture…` → crash whenever furniture rendered
   (furnished plans only — which is why an empty fresh install worked).

Both fixed. **New permanent suite: `npm run test:smoke`** — bundles
the real app with esbuild, mounts it in happy-dom with a Proxy-mocked
2D canvas (Konva actually runs), and asserts a clean, non-trivial
render in two scenarios: fresh install (onboarding path) and legacy
v1-storage upgrade (migration path, furnished plan with door, zone,
room). This closes the exact gap that let these ship: `vite build`
can't see runtime errors, node tests never render components.
happy-dom is a devDependency (pure JS, no native builds).

## Session C — elevation views

- **`elevationGeo.js`** (18 tests): orthographic facades from the four
  cardinal directions (plan top = North; each view's horizontal axis is
  the viewer's right, so North/East read correctly mirrored). Per floor:
  wall bands as merged u-intervals of the footprint (handles setbacks
  and disjoint buildings — two buildings → two bands). Openings appear
  only on facades whose exterior wall faces the viewer, at true
  heights: doors from the floor line, windows from their sill; upper-
  storey openings offset by the stacked elevation. Roofs: flat = 200mm
  slab; pitched = the hip profile sampled from the distance-function
  surface on a 100mm grid (apex verified: 2400 + inset·tan(pitch)).
- **PDF**: a 2×2 "Elevations" page (South/North/East/West) with ground
  lines, glazed window rects with a transom line, filled door rects,
  roof profiles, and a building-height note per cell. Vector-verified
  from the content stream: facade band ratios (8000/2400 and
  5000/2400), exactly one door rect at 900/2100, one window at 1:1,
  four 20+-point roof polygons.
- Known simplification (documented in the module): no hidden-surface
  removal between building wings.

## Session D — quality pack

- **Door-swing clearance warnings** (`clearanceGeo.js`, 15 tests):
  every swinging door's quarter-circle swing area (single = full-width
  quarter at the hinge jamb honoring hinge/swing flips; double = two
  half-width quarters at both jambs; sliding = exempt) is checked
  against all furniture via sector-vs-rotated-rect intersection
  (corner-in-sector + dense boundary sampling — catches full
  containment and thin diagonal crossers). Blocking furniture renders
  with a dashed red outline and a "⚠ blocks door swing" tag in 2D;
  selecting the door shows "Swing blocked by: …" in the panel. Live —
  recomputed as you drag furniture or move doors.
- **Tape measure** (M): click two points — snaps to walls/corners like
  the wall tool — dashed line with architectural ticks and a live
  length label. Right-click or Esc exits; nothing is stored.

## Session E — AI plan generation

- **Project ▾ → "✨ Generate with AI…"** (also in ⌘K): describe the
  house, paste your Anthropic API key (stored only in this browser,
  sent directly to Anthropic, never in plan files), pick a model, and
  the reply is turned into a real, opened plan.
- The substance is the **robustness pipeline** (`src/ai/planGen.js`,
  27 tests): the model writes a simplified format (wall-index opening
  references — far more LLM-reliable than ids); extraction tolerates
  fences/prose/trailing junk via balanced-brace scanning; the
  normalizer coerces strings, clamps everything to sane ranges
  (type-sane opening widths, thickness 80–500, pitch 10–60), drops
  invalid entries with named warnings, dedupes walls, then runs the
  standard heal (endpoint snap + T-junction splits) and room
  detection. Garbage in → either a usable plan with a warnings list,
  or a loud, specific error. Sloppy 8mm corner gaps heal into rooms;
  a fully open loop imports with a "no rooms closed" warning.
- See HANDOFF.md — written for the next model taking over this
  codebase (architecture, invariants, verification contract, lessons,
  prioritized bug-hunt list).
