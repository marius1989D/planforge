# PlanForge — Project Status & Handoff

_Last updated: 2026-08-25. This document is a cold-start handoff so a fresh session can pick up without re-reading the whole history._

---

## TL;DR / quick facts

| | |
|---|---|
| **What** | Client-side 2D/3D house planner (draw walls → rooms auto-detect → 3D view → walk-through → PDF/PNG/JSON export). |
| **Live URL** | https://planforge.creion-m.workers.dev |
| **Repo** | https://github.com/marius1989D/planforge (public, `main`) · SSH remote `git@github.com:marius1989D/planforge.git` |
| **Host** | Cloudflare Workers (static assets), free tier |
| **Deploy** | Push to `main` → GitHub Actions builds and runs `wrangler deploy`. Fully automatic. |
| **Stack** | Vite + React 18, Konva/react-konva (2D), three.js + @react-three/fiber + drei (3D), Zustand (state), jsPDF (export). No backend. |
| **Local dev** | `npm run dev` (Vite). `npm run build` → `dist/`. `npm run preview` serves the build. |
| **Default theme** | **Studio** (warm light). |

There is **no backend, no database, no env vars, no API keys** required to run. The only network call is the optional "Generate with AI" dialog, which uses a key the *user* pastes in (`src/ai/planGen.js`).

---

## Deployment & CI

- **CI:** `.github/workflows/deploy.yml` — on push to `main` (or manual dispatch): `npm ci` → `npm run build` → verify `dist/index.html` exists → `npx wrangler deploy`.
- **Cloudflare config:** `wrangler.toml` — static-assets-only Worker (no `main`, no bindings), `not_found_handling = "single-page-application"`.
- **Required GitHub secrets** (already set): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **Manual deploy** (if ever needed): `npm run deploy` (= `npm run build && wrangler deploy`) locally, or `gh workflow run deploy.yml --repo marius1989D/planforge`.
- `gh` CLI is installed and authenticated as `marius1989D` (SSH).

---

## Architecture map (`src/`)

- **`App.jsx`** — top-level shell: topbar, the **mobile sub-toolbar**, workspace layout (`ToolRail` + `Editor2D`/`View3D` + `Inspector`), command palette, AI dialog. Applies the active design system's tokens as CSS variables in a `useEffect` (colors + fonts + radius + shadow + `data-theme`). Also holds `Menu` (Project/Export dropdowns) and `SettingsMenu` (mobile gear → theme popover).
- **`components/`**
  - `Editor2D.jsx` (~1.4k lines) — the Konva 2D canvas: pan/zoom, draw/select/drag, snapping, dimensions, **touch handlers** (1-finger = mouse logic, 2-finger = pinch-zoom/pan). Overlays: wall-thickness bar, status hint, onboarding empty-state, inline dimension editor, context menu.
  - `View3D.jsx` — three.js scene: walls/rooms/roof/furniture/stairs, lighting (incl. sun sim), **FrameCamera** (aspect-aware framing), OrbitControls, and **WalkMode** (first-person; desktop = PointerLock + WASD, touch = on-screen **left move joystick** + **swipe-to-look** + **pinch/±FOV zoom** + Exit).
  - `Inspector.jsx` — right property panel (plan stats, floors, rooms, appearance picker, settings, cost). On mobile it's a bottom sheet.
  - `ToolRail.jsx` — the editor tool bar (store-driven). Desktop = docked left icon rail; mobile = bottom icon+label bar. Uses `ToolIcon.jsx`.
  - `ToolIcon.jsx` — stroke tool icons (select/wall/door/window/furniture/zone/stair/measure).
  - `ActionIcon.jsx` — stroke UI icons for the mobile sub-toolbar (settings gear/undo/redo/trash/duplicate).
  - `CommandPalette.jsx` — ⌘K palette; also the mobile ☰ menu (every action).
  - `AiGenerate.jsx` — optional AI plan generation dialog (user's own Anthropic key).
- **`store/planStore.js`** — Zustand store: the plan model, history (undo/redo), selection, tool, view, theme, walkMode, and all mutations (addWall, moveNodes, translateWalls, detachRoom, healWalls, furnishRoom, etc.). Theme persisted in `localStorage` (`planforge_theme`), default `studio`.
- **`model/`** — `themes.js` (the design systems — see below), `schema.js` (plan/floor/wall/… factories + migration), `samplePlan.js`, `furnitureLibrary.js`, `units.js`, `styleOptions.js`.
- **`geometry/`** — pure, test-covered geometry: `geo.js` (walls/rooms/heal), `roofGeo.js`, `walkGeo.js` (collision + ground-follow), `sunGeo.js`, `furnishGeo.js`, `quantities.js`, `clearanceGeo.js`, `elevationGeo.js`. Many `*.test.mjs` alongside.
- **`export/pdfExport.js`** — PDF drawing + schedules via jsPDF.
- **`styles.css`** — all chrome styling; **token-driven**. Mobile overrides live at the **end of the file** (so they win by source order). `@media (max-width: 760px)` = mobile; `@media (pointer: coarse)` = touch sizing.
- **`index.html`** — loads Google Fonts for all four design systems.

---

## Design system — the four "directions"

The app ships **four complete, switchable design systems** (chosen via the Appearance picker in the Inspector, or the mobile settings gear). Each is a full identity — palette + typography + radius + shadow + canvas/3D colors — not just a recolor. **Studio is the default.**

| id | Label | Feel | Accent | Fonts (display / ui / mono) |
|----|-------|------|--------|------------------------------|
| `studio` | Studio | warm light, rounded | terracotta `#cf6f4e` | Bricolage Grotesque / Figtree / Figtree |
| `precision` | Precision | dark technical | blue `#5b9dff` | Archivo / Hanken Grotesk / IBM Plex Mono |
| `blueprint` | Blueprint | cyanotype navy | cyan `#57c8ff` | Space Mono / IBM Plex Sans / Space Mono |
| `atelier` | Atelier | quiet light minimal | slate `#45566d` | Instrument Serif / Hanken Grotesk / Hanken Grotesk |

### How theming flows
1. **`model/themes.js`** defines each theme object: `{ id, label, swatch[4], type{ui,display,mono}, shape{radius,radiusLg}, depth{shadow,glass}, chrome{…}, canvas{…}, plan{…}, three{…}, pdf{…} }`.
2. **`App.jsx`** (`useEffect` on `themeId`) writes `chrome`/`type`/`shape`/`depth` to `:root` as CSS variables: `--paper --panel --panel-2 --line --ink --ink-soft --accent --accent-ink --danger --success --rail-bg --rail-ink --topbar-* --font-ui --font-display --font-mono --radius --radius-lg --shadow`, and sets `data-theme`.
3. **`styles.css`** styles all chrome through those variables (solid surfaces — the old frosted-glass system is gone). `:root` also holds Studio defaults so there's no flash before JS runs.
4. **Konva** (`Editor2D`) reads `theme.canvas` + `theme.plan` directly; **three.js** (`View3D`) reads `theme.three`; **PDF** reads `theme.pdf`. These consume the theme *object*, not CSS vars.
5. `getTheme(id)` falls back to `studio`; the store sanitizes stale stored ids.

**To add/edit a theme:** edit `model/themes.js` only (keep all the color groups filled), and load any new font in `index.html`. The Inspector picker and mobile gear enumerate `THEMES` automatically.

---

## Layout (post-redesign)

- **Desktop:** 3-column docked layout — left **icon rail** (`ToolRail`, flush), **inset canvas**, right docked **Inspector** (collapses to a slim strip; canvas widens). Rail/inspector are flex siblings of the canvas (not overlays), so the canvas insets correctly and Konva's own container measurement keeps stage-relative overlays (e.g. inline dimension editor) aligned. **Do not** inset via padding on `.editor2d` — `dimEdit.sx` is stage-relative and padding would misalign it.
- **Mobile (`≤760px`):** topbar (plan name + 2D/3D + ☰) → **sub-toolbar** (settings gear + `|` + undo/redo/delete/duplicate) → canvas → bottom **tool bar** (icon+label, scrollable). Inspector = bottom sheet via a floating ◧ FAB. Rail/inspector/FAB switch to `position: fixed` on mobile so they overlay instead of consuming flex space.

---

## Mobile & touch support (all implemented)

- **2D canvas:** 1-finger draw/select/drag/pan, 2-finger pinch-zoom + pan (`touch-action: none` on the Konva canvas). Selecting an item on mobile shows handles but does **not** auto-open the inspector sheet (so drags aren't buried) — see `setSelection` in the store.
- **3D:** aspect-aware camera framing (fits portrait), touch orbit/pinch via drei OrbitControls.
- **Walk mode (touch):** left move joystick + swipe-anywhere-to-look (delta-based, tunable via `lookSens` in `View3D`) + pinch/± buttons for FOV zoom (`WALK_FOV*` constants) + Exit button. Desktop keeps PointerLock + WASD.
- **Touch detection:** `(pointer: coarse) || navigator.maxTouchPoints > 0` (`isCoarsePointer` in `View3D`).

---

## What was done this session (commit-by-commit)

1. **Deploy setup** — `.gitignore`, `wrangler.toml`, CI workflow, first push, Cloudflare deploy.
2. `b255f77` **Phase 1** — responsive mobile chrome (compact topbar, bottom tool bar, inspector sheet, ☰ menu, dvh, coarse-pointer sizing).
3. `59612eb` **Phase 2** — 2D canvas touch (draw/select/drag/pan + pinch-zoom).
4. `9a81746` **Phase 3** — mobile 3D (portrait framing, touch orbit, walk-mode joysticks — later revised).
5. `87f8616` **Four fixes** — command-palette list scroll (`flex:1;min-height:0`), swipe-to-look replacing the too-fast right joystick, walk zoom (pinch + ± buttons), and **wall-drag now detaches neighbors** (uses `translateWalls([id])` instead of `moveNodes`, so you reshape one wall at a time).
6. `7b9235b` **Redesign** — four switchable design systems (Studio default); tokens for type/shape/depth; App applies them as CSS vars; styles.css dropped frosted glass for solid token-driven surfaces; fonts in index.html.
7. `16b0846` **Icon-first toolbar** (`ToolIcon`).
8. `0778aeb` **Docked left rail** (desktop).
9. `8a09ea6` **Polish** — solid dropdown menus, tokenized radii, light-topbar hover fixes.
10. `df7a0be` **Docked inspector + inset canvas** — extracted `ToolRail`, made rail/inspector flex siblings (true 3-column), mobile switched to `position: fixed` overlays.
11. `7ba5ed0` **Mobile sub-toolbar** — settings gear (theme popover) + `|` + undo/redo/delete/duplicate (`ActionIcon`).

The design exploration that led to the four directions is a private Artifact (comparison mockup): https://claude.ai/code/artifact/9e211c80-1731-4130-b463-a4089b69e0af

---

## Open items / possible next steps

- **User raised a question, not yet actioned:** whether undo/redo in the mobile sub-toolbar should be gated on *selection* (currently they follow history availability; delete/duplicate follow selection, delete stays off for rooms). One-liner per button if they want the strict version.
- The user said "we'll go for some more after" re: the sub-toolbar — expect follow-up organizing requests.
- Per-theme color fine-tuning (e.g. Blueprint room fills, Atelier contrast).
- Secondary-surface pixel polish (AI dialog, command palette) — inherit tokens but not individually polished.
- Optional **auto light/dark** that follows the OS.
- Main JS bundle is ~1.8 MB (546 KB gzipped) from three.js + konva — could code-split the 3D view behind a dynamic import if first-paint matters.
- Custom domain (Cloudflare dashboard) if the `.workers.dev` URL isn't wanted.

---

## Dev workflow, conventions & gotchas

- **Commit style:** concise subject + explanatory body; end every commit with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Work on `main` (that's what deploys); push only when the user asks (they've been asking).
- **Tests:** geometry has `*.test.mjs` files (run with `node`). Smoke: `npm run test:smoke`.
- **Verifying UI in a session:** run `npm run preview`, then drive the in-app browser (`preview_start` → `navigate` to `http://localhost:4173/`). **After a rebuild, reload the tab** — the pane doesn't auto-refresh.
- **Browser-pane gotchas observed this session:**
  - Click coordinates are in the **logical viewport** space the screenshot reports (e.g. 375-wide), even though the returned image may be 2× — prefer element refs or dispatch synthetic events via `javascript_tool`.
  - The pane sometimes returns blank frames after scrolling; reload or verify via computed styles / DOM reads instead.
  - The emulated mobile viewport reports `pointer: fine` / `maxTouchPoints: 0`, so touch-gated code (walk joysticks) won't auto-activate there — test by dispatching synthetic `TouchEvent`s, or temporarily patch `window.matchMedia`.
  - React attaches touch listeners as **passive** — never call `preventDefault()` in React `onTouch*`; rely on `touch-action: none` (Konva's own listeners are non-passive, so `e.evt.preventDefault()` there is fine).
- **CSS ordering:** mobile overrides are intentionally at the **end** of `styles.css` so they win by source order over the base (desktop) rules. Keep new mobile rules there.
- **Coordinate safety:** Konva measures its own container, so keep `.editor2d` as the true Stage container (no internal padding offset). Overlay positions computed from `viewport.scale/x/y` are stage-relative.
