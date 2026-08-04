// ============================================================
// PlanForge — design tokens / themes
// ------------------------------------------------------------
// Every color in the app lives here. Consumers:
//   • App.jsx sets the `chrome` group as CSS variables on :root
//   • Editor2D reads `canvas` + `plan` directly into Konva
//   • View3D reads `three` (plan-level wallColor/floorColor
//     overrides still win over theme defaults)
//   • pdfExport reads `pdf` (solid hex only — PDF has no alpha
//     here, so translucent screen fills get solid print
//     equivalents)
// `plan.furnitureMono`, when set, overrides the per-item library
// colors (used by monochrome/duotone themes).
// Theme choice is app-level (not per-plan), persisted in
// localStorage as 'planforge_theme'.
// ============================================================

export const THEMES = {
  // ---------------------------------------------------------- Daylight
  daylight: {
    id: 'daylight',
    label: 'Daylight',
    swatch: ['#f8fafb', '#2b3a48', '#1f6f8b', '#dbe9f4'],
    chrome: {
      paper: '#f4f6f8', panel: '#ffffff', line: '#dbe3e9',
      ink: '#22303c', inkSoft: '#5a6b7a',
      accent: '#1f6f8b', accentInk: '#ffffff', danger: '#c0392b',
      topbarBg: '#22303c', topbarBorder: '#4a5c6b',
      topbarInk: '#eef3f7', topbarInkSoft: '#b9c6d1',
    },
    canvas: { bg: '#f8fafb', gridMinor: '#e4eaef', gridMajor: '#c9d4dd' },
    plan: {
      wall: '#2b3a48', wallSelected: '#1f6f8b', wallLabel: '#5a6b7a',
      roomFills: ['#dbe9f4', '#e4f0e2', '#f4ead9', '#ece1f0', '#e0eef0'],
      roomText: '#3c4c5a',
      zoneColors: ['#e07a5f', '#3d8b7d', '#e0a458', '#7d6d9e', '#5b8bd0'],
      door: '#5a6b7a', window: '#5b9bd0', gap: '#ffffff',
      dimension: '#7d8ca3', dimensionExt: '#8aa0b2', dimensionText: '#5a6b7a',
      snapEndpoint: '#2a9d5c', snapWall: '#e0a458', snapGrid: '#8aa0b2',
      handleFill: '#ffffff', handleStroke: '#1f6f8b',
      furnitureMono: null, furnitureText: '#3c4c5a',
    },
    three: {
      bg: '#22303c', wall: '#d9d2c5', floor: '#b8a98e', roof: '#6e7d8a',
      glass: '#9fc6e0', gridCell: '#3a4a58', gridSection: '#54677a',
    },
    pdf: {
      pageBg: '#ffffff', ink: '#22303c', inkSoft: '#5a6b7a', line: '#dbe3e9',
      wall: '#2b3a48', door: '#5a6b7a', window: '#5b9bd0',
      roomFills: ['#dbe9f4', '#e4f0e2', '#f4ead9', '#ece1f0', '#e0eef0'],
      roomText: '#3c4c5a',
      zoneColors: ['#e07a5f', '#3d8b7d', '#e0a458', '#7d6d9e', '#5b8bd0'],
      dimension: '#7d8ca3', dimensionExt: '#8aa0b2',
      tableHead: '#22303c', tableHeadText: '#ffffff', tableFoot: '#f4f6f8',
      furnitureMono: null,
    },
  },

  // ---------------------------------------------------------- Blueprint
  blueprint: {
    id: 'blueprint',
    label: 'Blueprint',
    swatch: ['#0f2456', '#eaf2ff', '#4fd8ff', '#1e4080'],
    chrome: {
      paper: '#0c1d47', panel: '#152c66', line: '#2a4a94',
      ink: '#e8f0ff', inkSoft: '#9fb6e6',
      accent: '#4fd8ff', accentInk: '#06213f', danger: '#ff8f7a',
      topbarBg: '#0a173a', topbarBorder: '#2a4a94',
      topbarInk: '#e8f0ff', topbarInkSoft: '#9fb6e6',
    },
    canvas: {
      bg: '#0f2456',
      gridMinor: 'rgba(255,255,255,0.07)',
      gridMajor: 'rgba(255,255,255,0.16)',
    },
    plan: {
      wall: '#eaf2ff', wallSelected: '#4fd8ff', wallLabel: '#9fb6e6',
      roomFills: [
        'rgba(122,184,255,0.12)', 'rgba(122,224,195,0.10)',
        'rgba(255,217,122,0.09)', 'rgba(195,168,255,0.10)',
        'rgba(122,208,255,0.10)',
      ],
      roomText: '#cfe0ff',
      zoneColors: ['#ffb07a', '#7ae0c3', '#ffd97a', '#c3a8ff', '#7ab8ff'],
      door: '#cfe0ff', window: '#7ad0ff', gap: '#0f2456',
      dimension: '#8fb0e8', dimensionExt: '#5f7ec0', dimensionText: '#b7cdf5',
      snapEndpoint: '#59e0a0', snapWall: '#ffd97a', snapGrid: '#6f8ecb',
      handleFill: '#0f2456', handleStroke: '#4fd8ff',
      furnitureMono: '#8fb0e8', furnitureText: '#cfe0ff',
    },
    three: {
      bg: '#0c1d47', wall: '#dfe9ff', floor: '#28407a', roof: '#1d3266',
      glass: '#7ad0ff', gridCell: '#22407f', gridSection: '#33559f',
    },
    pdf: {
      pageBg: '#12295e', ink: '#eaf2ff', inkSoft: '#9fb6e6', line: '#3a5aa4',
      wall: '#eaf2ff', door: '#cfe0ff', window: '#7ad0ff',
      roomFills: ['#1b3a78', '#1b4070', '#243a80', '#1e4080', '#1a4278'],
      roomText: '#cfe0ff',
      zoneColors: ['#ffb07a', '#7ae0c3', '#ffd97a', '#c3a8ff', '#7ab8ff'],
      dimension: '#8fb0e8', dimensionExt: '#5f7ec0',
      tableHead: '#eaf2ff', tableHeadText: '#12295e', tableFoot: '#1b3a78',
      furnitureMono: '#8fb0e8',
    },
  },

  // ---------------------------------------------------------- Midnight
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    swatch: ['#15181d', '#e6e9ee', '#5eead4', '#23272f'],
    chrome: {
      paper: '#101317', panel: '#1b1f26', line: '#2c323c',
      ink: '#e6e9ee', inkSoft: '#8b94a3',
      accent: '#5eead4', accentInk: '#062a24', danger: '#f2977a',
      topbarBg: '#0c0e12', topbarBorder: '#2c323c',
      topbarInk: '#e6e9ee', topbarInkSoft: '#8b94a3',
    },
    canvas: { bg: '#15181d', gridMinor: '#20242b', gridMajor: '#2a2f38' },
    plan: {
      wall: '#e6e9ee', wallSelected: '#5eead4', wallLabel: '#8b94a3',
      roomFills: [
        'rgba(94,234,212,0.09)', 'rgba(167,139,250,0.10)',
        'rgba(109,182,255,0.09)', 'rgba(234,195,94,0.08)',
        'rgba(242,151,122,0.08)',
      ],
      roomText: '#c6cdd7',
      zoneColors: ['#f2977a', '#5eead4', '#eac35e', '#a78bfa', '#6db6ff'],
      door: '#aab3c0', window: '#6db6ff', gap: '#15181d',
      dimension: '#5f6875', dimensionExt: '#4a525e', dimensionText: '#8b94a3',
      snapEndpoint: '#5eead4', snapWall: '#eac35e', snapGrid: '#5f6875',
      handleFill: '#15181d', handleStroke: '#5eead4',
      furnitureMono: null, furnitureText: '#c6cdd7',
    },
    three: {
      bg: '#0c0e12', wall: '#b9bfc9', floor: '#3a3f48', roof: '#262b33',
      glass: '#5eead4', gridCell: '#242a33', gridSection: '#333b47',
    },
    pdf: {
      pageBg: '#15181d', ink: '#e6e9ee', inkSoft: '#8b94a3', line: '#2c323c',
      wall: '#e6e9ee', door: '#aab3c0', window: '#6db6ff',
      roomFills: ['#1d2b2c', '#242233', '#1c2733', '#2d2820', '#2d221f'],
      roomText: '#c6cdd7',
      zoneColors: ['#f2977a', '#5eead4', '#eac35e', '#a78bfa', '#6db6ff'],
      dimension: '#5f6875', dimensionExt: '#4a525e',
      tableHead: '#e6e9ee', tableHeadText: '#15181d', tableFoot: '#1b1f26',
      furnitureMono: null,
    },
  },

  // ---------------------------------------------------------- Graphite
  graphite: {
    id: 'graphite',
    label: 'Graphite',
    swatch: ['#f4f4f5', '#27272a', '#3b82f6', '#e6e6e9'],
    chrome: {
      paper: '#fafafa', panel: '#ffffff', line: '#e4e4e7',
      ink: '#18181b', inkSoft: '#71717a',
      accent: '#3b82f6', accentInk: '#ffffff', danger: '#b91c1c',
      topbarBg: '#18181b', topbarBorder: '#3f3f46',
      topbarInk: '#f4f4f5', topbarInkSoft: '#a1a1aa',
    },
    canvas: { bg: '#f4f4f5', gridMinor: '#e7e7ea', gridMajor: '#d4d4d8' },
    plan: {
      wall: '#27272a', wallSelected: '#3b82f6', wallLabel: '#71717a',
      roomFills: ['#ececee', '#e6e6e9', '#f0f0f2', '#e9e9ec', '#f2f2f4'],
      roomText: '#3f3f46',
      zoneColors: ['#52525b', '#71717a', '#3f3f46', '#a1a1aa', '#27272a'],
      door: '#52525b', window: '#71717a', gap: '#f4f4f5',
      dimension: '#a1a1aa', dimensionExt: '#c4c4c9', dimensionText: '#71717a',
      snapEndpoint: '#3b82f6', snapWall: '#71717a', snapGrid: '#a1a1aa',
      handleFill: '#ffffff', handleStroke: '#3b82f6',
      furnitureMono: '#9d9da4', furnitureText: '#3f3f46',
    },
    three: {
      bg: '#26262a', wall: '#d4d4d8', floor: '#a1a1aa', roof: '#52525b',
      glass: '#93c5fd', gridCell: '#3a3a3f', gridSection: '#4c4c52',
    },
    pdf: {
      pageBg: '#ffffff', ink: '#18181b', inkSoft: '#71717a', line: '#e4e4e7',
      wall: '#27272a', door: '#52525b', window: '#71717a',
      roomFills: ['#ececee', '#e6e6e9', '#f0f0f2', '#e9e9ec', '#f2f2f4'],
      roomText: '#3f3f46',
      zoneColors: ['#52525b', '#71717a', '#3f3f46', '#a1a1aa', '#27272a'],
      dimension: '#a1a1aa', dimensionExt: '#c4c4c9',
      tableHead: '#18181b', tableHeadText: '#ffffff', tableFoot: '#f4f4f5',
      furnitureMono: '#9d9da4',
    },
  },
}

export const THEME_IDS = Object.keys(THEMES)
export const getTheme = (id) => THEMES[id] || THEMES.daylight
