// Solar position tests against known astronomy. Run: node src/geometry/sun.test.mjs
import { solarPosition, sunVector, sunLabel } from './sunGeo.js'

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`)
  if (!cond) failures++
}
// scan a window of clock times and return the position at max elevation
const noonMax = (args) => {
  let best = null
  for (let m = 600; m <= 900; m += 5) {
    const p = solarPosition({ ...args, minutes: m })
    if (!best || p.elevationDeg > best.elevationDeg) best = p
  }
  return best
}

// 1. equinox at the equator: sun passes essentially overhead
{
  const p = noonMax({ dateISO: '2026-03-20', lat: 0, lon: 0, tz: 0 })
  check('equator equinox: noon sun ≈ overhead (>87°)', p.elevationDeg > 87, p.elevationDeg.toFixed(2))
}
// 2. summer solstice 45°N: max el ≈ 90 − 45 + 23.45 = 68.45°, due south
{
  const p = noonMax({ dateISO: '2026-06-21', lat: 45, lon: 0, tz: 0 })
  check('45N Jun 21: noon el ≈ 68.45° (±1.5)', Math.abs(p.elevationDeg - 68.45) < 1.5, p.elevationDeg.toFixed(2))
  check('45N Jun 21: noon azimuth ≈ 180 (±6)', Math.abs(p.azimuthDeg - 180) < 6, p.azimuthDeg.toFixed(1))
}
// 3. winter solstice 45°N: max el ≈ 21.55°
{
  const p = noonMax({ dateISO: '2026-12-21', lat: 45, lon: 0, tz: 0 })
  check('45N Dec 21: noon el ≈ 21.55° (±1.5)', Math.abs(p.elevationDeg - 21.55) < 1.5, p.elevationDeg.toFixed(2))
}
// 4. morning sun rises in the east; evening sets in the west
{
  const am = solarPosition({ dateISO: '2026-06-21', minutes: 7 * 60, lat: 45, lon: 0, tz: 0 })
  const pm = solarPosition({ dateISO: '2026-06-21', minutes: 18 * 60, lat: 45, lon: 0, tz: 0 })
  check('07:00 sun in the eastern half (az 55–115)', am.azimuthDeg > 55 && am.azimuthDeg < 115, am.azimuthDeg.toFixed(1))
  check('18:00 sun in the western half (az 245–305)', pm.azimuthDeg > 245 && pm.azimuthDeg < 305, pm.azimuthDeg.toFixed(1))
}
// 5. night: negative elevation at midnight
{
  const p = solarPosition({ dateISO: '2026-06-21', minutes: 0, lat: 45, lon: 0, tz: 0 })
  check('midnight is night (el < −15°)', p.elevationDeg < -15, p.elevationDeg.toFixed(1))
  check('label says below horizon', sunLabel(p) === 'below horizon')
}
// 6. southern hemisphere: June noon sun sits in the NORTH
{
  const p = noonMax({ dateISO: '2026-06-21', lat: -35, lon: 0, tz: 0 })
  check('35S Jun 21: noon azimuth ≈ 0/360 (north)', p.azimuthDeg < 8 || p.azimuthDeg > 352, p.azimuthDeg.toFixed(1))
  check('35S Jun 21: noon el ≈ 31.5° (±1.5)', Math.abs(p.elevationDeg - 31.55) < 1.5, p.elevationDeg.toFixed(2))
}
// 7. timezone default: Bucharest (lon 26.1 → tz 2) noon-ish sanity
{
  const p = noonMax({ dateISO: '2026-06-21', lat: 44.43, lon: 26.1 })
  check('Bucharest Jun 21 max el ≈ 69 (±2)', Math.abs(p.elevationDeg - 69) < 2, p.elevationDeg.toFixed(2))
}
// 8. sun vector mapping (plan top = North → world −z)
{
  const south45 = sunVector({ azimuthDeg: 180, elevationDeg: 45 })
  check('az 180, el 45 → (0, .707, +.707): sun to the south = +z',
    Math.abs(south45.x) < 1e-9 && Math.abs(south45.y - Math.SQRT1_2) < 1e-9 && Math.abs(south45.z - Math.SQRT1_2) < 1e-9,
    JSON.stringify(south45))
  const east0 = sunVector({ azimuthDeg: 90, elevationDeg: 0 })
  check('az 90, el 0 → (1, 0, 0): sun east = +x',
    Math.abs(east0.x - 1) < 1e-9 && Math.abs(east0.y) < 1e-9 && Math.abs(east0.z) < 1e-9)
  const north0 = sunVector({ azimuthDeg: 0, elevationDeg: 0 })
  check('az 0 → −z (north)', Math.abs(north0.z + 1) < 1e-9)
}
// 9. label formatting
{
  check('label: 45° SSE', sunLabel({ elevationDeg: 45.2, azimuthDeg: 157 }) === '45° · SSE',
    sunLabel({ elevationDeg: 45.2, azimuthDeg: 157 }))
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
