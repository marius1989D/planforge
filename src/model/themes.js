// ============================================================
// PlanForge — design systems ("directions")
// ------------------------------------------------------------
// Each entry is a COMPLETE design system, switchable from the
// Appearance picker. Beyond colour it carries typography, shape
// (radius) and depth (shadow) so switching restyles the whole
// chrome, not just the canvas. Consumers:
//   • App.jsx applies `chrome` + `type` + `shape` + `depth` as
//     CSS variables on :root (see applyTheme there)
//   • Editor2D reads `canvas` + `plan` directly into Konva
//   • View3D reads `three`
//   • pdfExport reads `pdf`
//   • Inspector renders `swatch` + `label` in the picker
// `plan.furnitureMono`, when set, overrides per-item library
// colours (monochrome/duotone looks).
// Studio is the default (getTheme fallback + store default).
// ============================================================

export const THEMES = {
  // ---------------------------------------------------------- Studio
  studio: {
    id: 'studio',
    label: 'Studio',
    swatch: ['#f7f4ef', '#cf6f4e', '#4c9e86', '#2b2825'],
    type: {
      ui: "'Figtree', system-ui, sans-serif",
      display: "'Bricolage Grotesque', system-ui, sans-serif",
      mono: "'Figtree', system-ui, sans-serif",
    },
    shape: { radius: '11px', radiusLg: '16px' },
    depth: { shadow: '0 1px 2px rgba(43,40,37,.05), 0 10px 30px -12px rgba(43,40,37,.18)', glass: false },
    chrome: {
      paper: '#f7f4ef', panel: '#ffffff', panel2: '#faf6f0', line: '#ece5da',
      ink: '#2b2825', inkSoft: '#857c70',
      accent: '#cf6f4e', accentInk: '#ffffff', danger: '#c0392b', success: '#4c9e86',
      railBg: '#ffffff', railInk: '#8a8074',
      topbarBg: '#ffffff', topbarBorder: '#ece5da',
      topbarInk: '#2b2825', topbarInkSoft: '#857c70',
    },
    canvas: { bg: '#fbf9f5', gridMinor: '#efe9df', gridMajor: '#e1d8c8' },
    plan: {
      wall: '#2b2825', wallSelected: '#cf6f4e', wallLabel: '#857c70',
      roomFills: ['#e9f0ea', '#f5ece0', '#eceef6', '#f4e9ee', '#e6f0ec'],
      roomText: '#6f665a',
      zoneColors: ['#cf6f4e', '#4c9e86', '#e8b04b', '#7d6d9e', '#5b8bd0'],
      door: '#a99a86', window: '#6aa0c4', gap: '#fbf9f5',
      dimension: '#b3a48f', dimensionExt: '#c3b7a4', dimensionText: '#857c70',
      snapEndpoint: '#4c9e86', snapWall: '#e8b04b', snapGrid: '#b3a48f',
      handleFill: '#ffffff', handleStroke: '#cf6f4e',
      furnitureMono: null, furnitureText: '#6f665a',
    },
    three: {
      bg: '#2b2825', wall: '#e8e0d2', floor: '#c9b79a', roof: '#9a8f80',
      glass: '#a9c9d8', gridCell: '#3d3833', gridSection: '#4f4840',
    },
    pdf: {
      pageBg: '#ffffff', ink: '#2b2825', inkSoft: '#857c70', line: '#ece5da',
      wall: '#2b2825', door: '#a99a86', window: '#6aa0c4',
      roomFills: ['#e9f0ea', '#f5ece0', '#eceef6', '#f4e9ee', '#e6f0ec'],
      roomText: '#6f665a',
      zoneColors: ['#cf6f4e', '#4c9e86', '#e8b04b', '#7d6d9e', '#5b8bd0'],
      dimension: '#b3a48f', dimensionExt: '#c3b7a4',
      tableHead: '#2b2825', tableHeadText: '#ffffff', tableFoot: '#f7f4ef',
      furnitureMono: null,
    },
  },

  // ---------------------------------------------------------- Precision
  precision: {
    id: 'precision',
    label: 'Precision',
    swatch: ['#0e1216', '#5b9dff', '#37b26b', '#e7edf3'],
    type: {
      ui: "'Hanken Grotesk', system-ui, sans-serif",
      display: "'Archivo', system-ui, sans-serif",
      mono: "'IBM Plex Mono', ui-monospace, monospace",
    },
    shape: { radius: '6px', radiusLg: '10px' },
    depth: { shadow: '0 1px 2px rgba(0,0,0,.4), 0 12px 30px -14px rgba(0,0,0,.6)', glass: false },
    chrome: {
      paper: '#0e1216', panel: '#171d23', panel2: '#1c242b', line: '#232c34',
      ink: '#e7edf3', inkSoft: '#8a97a4',
      accent: '#5b9dff', accentInk: '#04122a', danger: '#e5484d', success: '#37b26b',
      railBg: '#12181e', railInk: '#8a97a4',
      topbarBg: '#12181e', topbarBorder: '#232c34',
      topbarInk: '#e7edf3', topbarInkSoft: '#8a97a4',
    },
    canvas: { bg: '#0b0f13', gridMinor: '#151d24', gridMajor: '#1e2831' },
    plan: {
      wall: '#c6d2dd', wallSelected: '#5b9dff', wallLabel: '#8a97a4',
      roomFills: [
        'rgba(91,157,255,0.10)', 'rgba(167,139,250,0.10)',
        'rgba(94,234,212,0.08)', 'rgba(234,195,94,0.08)', 'rgba(242,151,122,0.08)',
      ],
      roomText: '#aeb9c4',
      zoneColors: ['#f2977a', '#5eead4', '#eac35e', '#a78bfa', '#6db6ff'],
      door: '#93a3b1', window: '#6db6ff', gap: '#0b0f13',
      dimension: '#5f7183', dimensionExt: '#4a5563', dimensionText: '#8a97a4',
      snapEndpoint: '#37b26b', snapWall: '#e0a44a', snapGrid: '#5f7183',
      handleFill: '#0b0f13', handleStroke: '#5b9dff',
      furnitureMono: null, furnitureText: '#aeb9c4',
    },
    three: {
      bg: '#0b0f13', wall: '#cbd4dd', floor: '#384049', roof: '#232a32',
      glass: '#5b9dff', gridCell: '#1c242c', gridSection: '#2b3540',
    },
    pdf: {
      pageBg: '#0e1216', ink: '#e7edf3', inkSoft: '#8a97a4', line: '#232c34',
      wall: '#e7edf3', door: '#93a3b1', window: '#6db6ff',
      roomFills: ['#14212e', '#1f1d2e', '#132524', '#241f16', '#241713'],
      roomText: '#aeb9c4',
      zoneColors: ['#f2977a', '#5eead4', '#eac35e', '#a78bfa', '#6db6ff'],
      dimension: '#5f7183', dimensionExt: '#4a5563',
      tableHead: '#e7edf3', tableHeadText: '#0e1216', tableFoot: '#171d23',
      furnitureMono: null,
    },
  },

  // ---------------------------------------------------------- Blueprint
  blueprint: {
    id: 'blueprint',
    label: 'Blueprint',
    swatch: ['#0a1633', '#57c8ff', '#e4ecff', '#233f75'],
    type: {
      ui: "'IBM Plex Sans', system-ui, sans-serif",
      display: "'Space Mono', ui-monospace, monospace",
      mono: "'Space Mono', ui-monospace, monospace",
    },
    shape: { radius: '5px', radiusLg: '8px' },
    depth: { shadow: '0 1px 2px rgba(0,0,0,.5), 0 14px 34px -14px rgba(0,0,0,.7)', glass: false },
    chrome: {
      paper: '#0a1633', panel: '#0e1f45', panel2: '#12244f', line: '#233f75',
      ink: '#e4ecff', inkSoft: '#93a9da',
      accent: '#57c8ff', accentInk: '#04152e', danger: '#ff8f7a', success: '#52d0a0',
      railBg: '#0e1f45', railInk: '#93a9da',
      topbarBg: '#0c1a3e', topbarBorder: '#233f75',
      topbarInk: '#e4ecff', topbarInkSoft: '#93a9da',
    },
    canvas: {
      bg: '#0a1633',
      gridMinor: 'rgba(120,180,255,0.08)',
      gridMajor: 'rgba(120,180,255,0.16)',
    },
    plan: {
      wall: '#e4ecff', wallSelected: '#57c8ff', wallLabel: '#93a9da',
      roomFills: [
        'rgba(122,184,255,0.10)', 'rgba(122,224,195,0.09)',
        'rgba(255,217,122,0.08)', 'rgba(195,168,255,0.09)', 'rgba(122,208,255,0.09)',
      ],
      roomText: '#cfe0ff',
      zoneColors: ['#ffb07a', '#7ae0c3', '#ffd97a', '#c3a8ff', '#7ab8ff'],
      door: '#cfe0ff', window: '#7ad0ff', gap: '#0a1633',
      dimension: '#7fb8e6', dimensionExt: '#5a86c4', dimensionText: '#b7cdf5',
      snapEndpoint: '#52d0a0', snapWall: '#ffd97a', snapGrid: '#6f8ecb',
      handleFill: '#0a1633', handleStroke: '#57c8ff',
      furnitureMono: '#7fb8e6', furnitureText: '#cfe0ff',
    },
    three: {
      bg: '#0a1633', wall: '#dfe9ff', floor: '#223a70', roof: '#1a2d5e',
      glass: '#7ad0ff', gridCell: '#1d3a72', gridSection: '#2e4f93',
    },
    pdf: {
      pageBg: '#0e2150', ink: '#eaf2ff', inkSoft: '#9fb6e6', line: '#3a5aa4',
      wall: '#eaf2ff', door: '#cfe0ff', window: '#7ad0ff',
      roomFills: ['#1b3a78', '#1b4070', '#243a80', '#1e4080', '#1a4278'],
      roomText: '#cfe0ff',
      zoneColors: ['#ffb07a', '#7ae0c3', '#ffd97a', '#c3a8ff', '#7ab8ff'],
      dimension: '#8fb0e8', dimensionExt: '#5f7ec0',
      tableHead: '#eaf2ff', tableHeadText: '#0e2150', tableFoot: '#1b3a78',
      furnitureMono: '#8fb0e8',
    },
  },

  // ---------------------------------------------------------- Atelier
  atelier: {
    id: 'atelier',
    label: 'Atelier',
    swatch: ['#f4f4f1', '#45566d', '#8a877f', '#1c1b19'],
    type: {
      ui: "'Hanken Grotesk', system-ui, sans-serif",
      display: "'Instrument Serif', Georgia, serif",
      mono: "'Hanken Grotesk', system-ui, sans-serif",
    },
    shape: { radius: '8px', radiusLg: '12px' },
    depth: { shadow: '0 1px 2px rgba(28,27,25,.04), 0 8px 24px -14px rgba(28,27,25,.14)', glass: false },
    chrome: {
      paper: '#f4f4f1', panel: '#faf9f6', panel2: '#f1f1ec', line: '#e6e4dc',
      ink: '#1c1b19', inkSoft: '#8a877f',
      accent: '#45566d', accentInk: '#ffffff', danger: '#a1443a', success: '#5a8a72',
      railBg: '#faf9f6', railInk: '#8a877f',
      topbarBg: '#faf9f6', topbarBorder: '#e6e4dc',
      topbarInk: '#1c1b19', topbarInkSoft: '#8a877f',
    },
    canvas: { bg: '#f7f7f4', gridMinor: '#ecebe4', gridMajor: '#dedbcf' },
    plan: {
      wall: '#26251f', wallSelected: '#45566d', wallLabel: '#8a877f',
      roomFills: ['#eeefe9', '#f0ece5', '#edeef0', '#f1eceb', '#eceeec'],
      roomText: '#615e55',
      zoneColors: ['#8a7f6d', '#5f6b5c', '#9a8c78', '#6d6d7e', '#5b6b7d'],
      door: '#b4b1a6', window: '#8fa0b8', gap: '#f7f7f4',
      dimension: '#a8a598', dimensionExt: '#c0bdb0', dimensionText: '#8a877f',
      snapEndpoint: '#5a8a72', snapWall: '#b39a6a', snapGrid: '#b6b3a6',
      handleFill: '#faf9f6', handleStroke: '#45566d',
      furnitureMono: '#b8b3a8', furnitureText: '#615e55',
    },
    three: {
      bg: '#33322e', wall: '#e6e2d8', floor: '#c3bdae', roof: '#918b7e',
      glass: '#9fb0c4', gridCell: '#45433d', gridSection: '#57544c',
    },
    pdf: {
      pageBg: '#ffffff', ink: '#1c1b19', inkSoft: '#8a877f', line: '#e6e4dc',
      wall: '#26251f', door: '#b4b1a6', window: '#8fa0b8',
      roomFills: ['#eeefe9', '#f0ece5', '#edeef0', '#f1eceb', '#eceeec'],
      roomText: '#615e55',
      zoneColors: ['#8a7f6d', '#5f6b5c', '#9a8c78', '#6d6d7e', '#5b6b7d'],
      dimension: '#a8a598', dimensionExt: '#c0bdb0',
      tableHead: '#1c1b19', tableHeadText: '#ffffff', tableFoot: '#f4f4f1',
      furnitureMono: '#b8b3a8',
    },
  },
}

export const THEME_IDS = Object.keys(THEMES)
export const getTheme = (id) => THEMES[id] || THEMES.studio
