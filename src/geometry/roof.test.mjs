// Roof geometry tests. Run: node src/geometry/roof.test.mjs
import { buildHipRoofGeometry } from './roofGeo.testcopy.mjs'

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`)
  if (!cond) failures++
}

// --- 1. rectangle 8×4m at 30°: ridge height = inradius(2m)·tan30 ≈ 1.1547m
{
  const fp = [
    { x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 4000 }, { x: 0, y: 4000 },
  ]
  const res = buildHipRoofGeometry(fp, { pitchDeg: 30 })
  check('rect: geometry built', !!res?.geometry)
  check('rect: ridge height ≈ 1.155m (±5%)',
    res.maxZ > 1.09 && res.maxZ <= 1.16, res.maxZ.toFixed(4))
  // boundary vertices must sit at z≈0 (exact eaves)
  const pos = res.geometry.getAttribute('position')
  let boundaryOk = true
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), zz = pos.getZ(i)
    const onEdge = x < 1e-6 || x > 8 - 1e-6 || zz < 1e-6 || zz > 4 - 1e-6
    if (onEdge && y > 1e-6) { boundaryOk = false; break }
  }
  check('rect: eave (boundary) vertices at z=0', boundaryOk)
  // no negative heights
  let nonNeg = true
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) < -1e-9) nonNeg = false
  check('rect: all heights >= 0', nonNeg)
}

// --- 2. steeper pitch → proportionally taller
{
  const fp = [
    { x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 4000 }, { x: 0, y: 4000 },
  ]
  const r30 = buildHipRoofGeometry(fp, { pitchDeg: 30 })
  const r45 = buildHipRoofGeometry(fp, { pitchDeg: 45 })
  const ratio = r45.maxZ / r30.maxZ
  check('45° vs 30° ratio ≈ tan45/tan30 = 1.732', Math.abs(ratio - Math.sqrt(3)) < 0.05,
    ratio.toFixed(3))
}

// --- 3. L-shaped footprint builds a valid roof
{
  const fp = [
    { x: 0, y: -2000 }, { x: 3000, y: -2000 }, { x: 3000, y: 0 },
    { x: 6000, y: 0 }, { x: 6000, y: 3000 }, { x: 0, y: 3000 },
  ]
  const res = buildHipRoofGeometry(fp, { pitchDeg: 35 })
  check('L-shape: geometry built with many triangles',
    !!res?.geometry && res.geometry.getIndex().count / 3 > 200,
    res && res.geometry.getIndex().count / 3)
  // largest inscribed circle sits in the pocket bounded by the left
  // edge, top edge, and the reflex corner at (3000,0):
  // r = 3·√2/(1+√2) ≈ 1.757m  →  ridge = r·tan35 ≈ 1.230m.
  // Grid vertices slightly undershoot the exact ridge point.
  const r = (3 * Math.SQRT2) / (1 + Math.SQRT2)
  const expected = r * Math.tan((35 * Math.PI) / 180)
  check('L-shape: ridge ≈ 1.757m·tan35 ≈ 1.230m (−5%..+1%)',
    res.maxZ > expected * 0.95 && res.maxZ < expected * 1.01,
    `${res.maxZ.toFixed(4)} vs ${expected.toFixed(4)}`)
}

// --- 4. degenerate input
{
  check('degenerate: <3 points → null', buildHipRoofGeometry([{x:0,y:0},{x:1,y:1}]) === null)
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
