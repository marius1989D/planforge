# PlanForge — Handoff Notes

Written by Claude Fable 5 for the next model working on this project
(likely Claude Opus 4.8), July 2026. Read this before touching code.

## What this is

A web-based 2D/3D house planner (React 18 + Vite, Konva for 2D,
react-three-fiber for 3D, Zustand for state, jspdf for export).
Original product inspired by Plan7Architect. MD (the user) runs it
locally on a MacBook: `npm install && npm run dev`.

Feature surface: chained wall drawing with snapping/healing, automatic
room detection, open-plan zones, doors (single/double/sliding) and
windows, furniture (18 types) with auto-furnish, stairs, multi-floor
(schema v2), 3D with stacked storeys + hip/flat roofs + sun/daylight
simulation, first-person walkthrough, smart dimension editing, door-
swing clearance warnings, tape measure, themed multi-page PDF export
(per-floor drawings, schedules, elevations, cost estimate), multi-plan
management with undo/redo, four visual themes, ⌘K palette, AI plan
generation via the user's Anthropic API key.

## The verification contract (do not lower this bar)

The user tests rarely; correctness comes from the suites. The
workflow that kept 300+ tests green:

1. **Geometry before UI.** Every algorithm lives in `src/geometry/*`
   or `src/ai/*` as pure functions with a `*.test.mjs` beside it,
   written and passing BEFORE any UI wiring. Run any suite directly:
   `node src/geometry/<name>.test.mjs`.
2. **`npm run test:smoke` after ANY UI change.** It esbuild-bundles
   the real app, mounts it in happy-dom with a Proxy-mocked 2D canvas
   (Konva genuinely renders), and asserts a clean non-trivial render
   in two scenarios: fresh install and legacy-v1-storage upgrade with
   a furnished plan. `vite build` passing means nothing about runtime;
   this suite exists because two render crashes shipped invisibly
   (see Lessons).
3. **PDF changes get content-stream verification.** jsPDF output is
   uncompressed; parse `stream…endstream`, read `x y m/l` and
   `x y w h re` operators, and assert coordinate ratios (see
   Session 6 and Session C notes in README for worked examples).
   Raster screenshots proved unreliable; vectors are exact.
   Note: jsPDF methods are instance-bound — `jsPDF.API.line` cannot
   be monkey-patched; parse the output instead.
4. **Run everything before shipping a zip:**
   `for t in src/geometry/*.test.mjs src/ai/*.test.mjs src/store/planStore.test.mjs; do node $t; done`
   then `npm run build` then `npm run test:smoke`.
5. **Rezip protocol:** from `/home/claude`:
   `zip -rq planforge.zip planforge -x "planforge/node_modules/*" "planforge/dist/*" "planforge/smoke/.*.tmp.mjs"`
   → copy to `/mnt/user-data/outputs/planforge.zip`.

## Architecture map

- `src/model/schema.js` — the contract. Factories, `migratePlan`
  (v1→v2), `isValidPlan`, `openingTags`. Schema v2: plan meta at the
  top; ALL content (walls/openings/rooms/furniture/stairs) inside
  `floors[]`. `plan.sun`, `plan.costRates` are meta.
- `src/model/` — furnitureLibrary (18 items), themes (4 themes; token
  groups chrome/canvas/plan/three/pdf), units, styleOptions,
  samplePlan (furnished bungalow).
- `src/geometry/` — the crown jewels, all pure:
  - `geo.js` — planar-graph face extraction (`detectRooms`),
    footprints, `healPlanWalls` (endpoint snap + T-junction splits
    with opening reassignment), `splitPlanWalls` (single-wall draw-time
    variant — different signature, don't confuse them), snapping,
    point/segment predicates.
  - `roofGeo.js` — hip roof as z = tan(pitch)·distance-to-boundary,
    earcut + subdivision.
  - `walkGeo.js` — walkthrough physics: elevations, stair step field,
    support sampling (0.35m step-up, later floors win ties), circle-
    vs-wall collision with door pass-through, spawn pose.
  - `sunGeo.js` — solar position (Cooper + EoT + hour angle),
    world-space sun vector. Convention: plan top = North = world −z.
  - `furnishGeo.js` — auto-furnish: probed inward normals, door/window
    keep-outs, SAT with 0.5mm adjacency epsilon, six templates.
  - `quantities.js` — takeoff + cost lines. Pitched roof area =
    footprint / cos(pitch), exact for this roof.
  - `elevationGeo.js` — facade projections. u = viewer's right.
  - `clearanceGeo.js` — swing sectors vs furniture rects.
- `src/ai/planGen.js` — prompt → JSON extraction (balanced-brace,
  fence-tolerant) → defensive normalize (coerce/clamp/drop with
  warnings) → heal → detectRooms. The browser API call sends
  `anthropic-dangerous-direct-browser-access: true`.
- `src/store/planStore.js` — Zustand. `activeFloorOf(plan)` is THE
  accessor; all content mutations go through `mutateFloor`/
  `commitFloor` and target the active floor. Undo/redo caps at 50
  with tag coalescing; drags snapshot once then commit history:false.
  Persistence: `planforge_index` / `planforge_plan_<id>` /
  `planforge_current_id` (+ legacy single-plan key migration).
- `src/components/` — Editor2D (the big one, ~1400 lines), View3D
  (stacked floors, WalkMode, Lighting rig), Inspector (floors, panels,
  sun, cost, furnish), App (topbar, menus, ⌘K), CommandPalette,
  AiGenerate.
- `src/export/pdfExport.js` — themed multi-page PDF. Page order:
  per-floor drawings, schedules, elevations, cost.

## Invariants (breaking these breaks everything)

- Walls are the source of truth; rooms are DERIVED. Auto rooms get
  deterministic ids from their geometry so user renames survive
  recomputation. Never hand-edit `rooms` except zones (source
  'manual').
- All internal lengths are millimetres. Display conversion only in
  `model/units.js`.
- Openings reference `wallId + offset`; anything that moves/splits
  walls must carry openings (heal and dimension-resize already do —
  copy their patterns).
- Plan top = North everywhere (sun, elevations, PDF north arrow).
- The store has NO `floor` field. `floor` is derived per-component
  via `activeFloorOf(plan)`. A zustand selector reading `s.floor.*`
  is a bug (it shipped once; see Lessons).

## Hard-won lessons (each of these cost real debugging)

1. **sed/mechanical renames have substring collisions.** The two
   white-screen bugs: `s.plan.walls` → `s.floor.walls` inside a
   zustand selector (store has no `floor`), and `T.plan.furnitureMono`
   mangled to `T.floor.furnitureMono` because the theme token contains
   the substring `plan.furniture`. After ANY multi-file rename, grep
   for the new prefix in impossible positions and run the smoke suite.
2. **Multi-replace under one assert half-applies silently.** Use the
   per-replacement pattern: a list of (old, new, label) where each
   miss is reported by label. Then audit identifiers cross-file with
   a node script.
3. **Node scripts that import project deps must run from the project
   dir**, not /tmp — module resolution walks up from the script path.
4. **View output goes stale after edits**; re-view before further
   str_replace on the same region.
5. **happy-dom + Proxy canvas mock renders Konva fine; WebGL/three
   does not mount headlessly** — the 3D view is smoke-tested only up
   to module init, not render. Treat View3D changes with extra care.

## Known limitations (documented, deliberate)

- Upper floor smaller than the one below: the exposed lower area is
  not separately roofed (needs polygon boolean ops).
- Elevations: no hidden-surface removal between building wings.
- Walkthrough: collision tests only the current floor's walls; brief
  snags possible mid-stair near walls of the other floor.
- Auto-furnish is greedy; small/awkward rooms may get partial sets
  (by design — it skips rather than overlaps).
- Arched windows, curved walls: deferred. Curved walls in particular
  would destabilize face extraction/healing/3D — do not attempt as a
  quick fix.
- Deferred features: collaboration (needs backend), photo-to-plan,
  VR/AR, GLTF furniture models, terrain.

## Where bugs are most likely (prioritized hunt list)

The user has barely tested anything after Session 3. In order of
risk × usage:

1. **Editor2D interaction feel** — drag thresholds, snapping
   priorities, opening handle edge cases, room-drag containing stairs
   + zones, dimension-edit popover positioning at odd zoom levels.
2. **Walkthrough feel** — speed/sensitivity constants (single
   constants in WalkMode/walkGeo), pointer-lock entry via ⌘K
   (transient-activation timing), camera restore on exit.
3. **Multi-floor UX** — ghost underlay opacity, floor deletion
   confirmations, stairs near floor edges.
4. **3D visuals** — sun shadow acne/bias at low elevations, shadow
   camera bounds for large plans (fixed ±25), glazing z-fighting.
5. **AI generation** — real model outputs will find normalize-pipeline
   gaps the fake replies didn't; the system prompt likely needs
   iteration on interior-wall closure quality.
6. **PDF at extremes** — very large/small plans, many floors
   (elevations page assumes ≤ 4-ish storeys visually), long room
   names in schedules.

## Test inventory (all green at handoff)

geometry: geo 17, split 16, heal 11, footprint 11, roof 8, walk 19,
sun 15, furnish 29, quantities 16, elevation 18, clearance 15 ·
ai: planGen 27 · store: 101 · smoke: 2 scenarios.
Total: 303 unit tests + smoke.

Keep them green. Add to them. Good luck — it's a lovely codebase to
work in when the suites are on your side.
