// ============================================================
// Browser smoke test: bundles the REAL app, mounts it in
// happy-dom with a Proxy-mocked 2D canvas (Konva runs), and
// asserts a clean render in two scenarios:
//   1. fresh install (empty localStorage → onboarding path)
//   2. legacy upgrade (v1 plan in storage → migration path)
// Catches runtime-render crashes that `vite build` and the node
// geometry/store suites structurally cannot (this exact harness
// found the schema-v2 white-screen selector bug).
// Run: npm run test:smoke
// ============================================================
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { fork } from 'child_process'

const dir = mkdtempSync(join(tmpdir(), 'pf-smoke-'))
const bundle = join(process.cwd(), 'smoke', '.bundle.tmp.mjs')

await build({
  entryPoints: ['src/main.jsx'],
  bundle: true,
  format: 'esm',
  outfile: bundle,
  loader: { '.jsx': 'jsx' },
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
})

const runner = join(process.cwd(), 'smoke', '.runner.tmp.mjs')
writeFileSync(runner, `
import { GlobalRegistrator } from '@happy-dom/global-registrator'
GlobalRegistrator.register()
const scenario = process.argv[2]

const ctxMock = () => new Proxy({ canvas: {}, measureText: () => ({ width: 10 }) }, {
  get(t, k) {
    if (k in t) return t[k]
    if (k === 'createLinearGradient' || k === 'createPattern' || k === 'createRadialGradient')
      return () => ({ addColorStop() {} })
    if (typeof k === 'string') return () => undefined
    return undefined
  },
  set() { return true },
})
window.HTMLCanvasElement.prototype.getContext = function (type) {
  return type === '2d' ? ctxMock() : null
}

if (scenario === 'legacy') {
  const v1 = {
    schemaVersion: 1, id: 'plan_legacy1', name: 'My Old Plan', units: 'mm', gridSize: 100,
    roof: 'flat', roofPitch: 30, wallColor: null, floorColor: null, showDimensions: true,
    walls: [
      { id: 'w1', start: { x: 0, y: 0 }, end: { x: 4000, y: 0 }, thickness: 150, height: 2400 },
      { id: 'w2', start: { x: 4000, y: 0 }, end: { x: 4000, y: 3000 }, thickness: 150, height: 2400 },
      { id: 'w3', start: { x: 4000, y: 3000 }, end: { x: 0, y: 3000 }, thickness: 150, height: 2400 },
      { id: 'w4', start: { x: 0, y: 3000 }, end: { x: 0, y: 0 }, thickness: 150, height: 2400 },
    ],
    openings: [{ id: 'o1', wallId: 'w1', type: 'door', offset: 800, width: 900, height: 2100, sillHeight: 0 }],
    rooms: [
      { id: 'r1', name: 'Old Room', source: 'auto', polygon: [{x:0,y:0},{x:4000,y:0},{x:4000,y:3000},{x:0,y:3000}], area: 12, wallIds: ['w1','w2','w3','w4'] },
      { id: 'z1', name: 'Dining', source: 'manual', polygon: [{x:500,y:500},{x:1500,y:500},{x:1500,y:1500},{x:500,y:1500}], area: 1 },
    ],
    furniture: [{ id: 'f1', type: 'sofa', position: { x: 2000, y: 1500 }, rotation: 0, dimensions: { w: 1800, d: 850, h: 800 } }],
    // note: v1 had no stairs; the zone exercises the manual-room path
    zones_note: undefined,
  }
  localStorage.setItem('planforge_index', JSON.stringify([{ id: 'plan_legacy1', name: 'My Old Plan', updatedAt: 1 }]))
  localStorage.setItem('planforge_plan_plan_legacy1', JSON.stringify(v1))
  localStorage.setItem('planforge_current_id', 'plan_legacy1')
}

document.body.innerHTML = '<div id="root"></div>'
const errors = []
window.addEventListener('error', (e) => errors.push(String(e.error?.stack || e.message)))
process.on('unhandledRejection', (e) => errors.push('unhandledRejection: ' + (e?.stack || e)))
const origErr = console.error
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 400)); origErr(...a) }

try {
  await import(${JSON.stringify(pathToFileURL(bundle).href)})
} catch (e) {
  errors.push('IMPORT CRASH: ' + e.stack)
}
await new Promise((r) => setTimeout(r, 700))
const html = document.getElementById('root')?.innerHTML || ''
const ok = errors.length === 0 && html.length > 1000
console.log((ok ? 'PASS' : 'FAIL') + '  ' + scenario + ' render (' + html.length + ' bytes, ' + errors.length + ' errors)')
for (const e of errors.slice(0, 3)) console.log('  → ' + e.split('\\n').slice(0, 6).join('\\n    '))
process.exit(ok ? 0 : 1)
`)

let failures = 0
for (const scenario of ['fresh', 'legacy']) {
  const code = await new Promise((resolve) => {
    const p = fork(runner, [scenario], { stdio: 'inherit' })
    p.on('exit', resolve)
  })
  if (code !== 0) failures++
}
rmSync(bundle, { force: true })
rmSync(runner, { force: true })
rmSync(dir, { recursive: true, force: true })
console.log(failures === 0 ? '\nSMOKE PASSED' : `\n${failures} SMOKE FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
