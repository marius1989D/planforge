// ============================================================
// PlanForge — solar position (pure, testable)
// ------------------------------------------------------------
// Standard simplified solar algorithm (Cooper declination +
// equation of time + hour angle). Accurate to well under a degree
// for daylight-visualization purposes.
// Conventions:
//   • azimuth: degrees from North, clockwise (N=0, E=90, S=180)
//   • elevation: degrees above the horizon (negative = night)
//   • the 2D plan's top (−y screen) is North → world −z = North,
//     world +x = East (plan x → world x, plan y → world z)
// ============================================================

export const SUN_DEFAULTS = {
  enabled: false,
  dateISO: '2026-06-21',
  minutes: 14 * 60, // local clock time, minutes from midnight
  lat: 44.43, // Bucharest
  lon: 26.1,
}

export function solarPosition({ dateISO, minutes, lat, lon, tz }) {
  const [y, m, d] = dateISO.split('-').map(Number)
  const n = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1
  const rad = Math.PI / 180

  // declination (Cooper) and equation of time (minutes)
  const decl = 23.45 * Math.sin(rad * (360 / 365) * (284 + n))
  const B = rad * (360 / 365) * (n - 81)
  const eotMin = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B)

  // local solar time: clock time + time correction for longitude vs
  // the timezone meridian (tz defaults to the natural zone of lon)
  const tzH = tz ?? Math.round(lon / 15)
  const tcMin = 4 * (lon - 15 * tzH) + eotMin
  const H = 15 * ((minutes + tcMin) / 60 - 12) // hour angle, degrees

  const sinEl =
    Math.sin(rad * decl) * Math.sin(rad * lat) +
    Math.cos(rad * decl) * Math.cos(rad * lat) * Math.cos(rad * H)
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl))) / rad

  const cosAz =
    (Math.sin(rad * decl) * Math.cos(rad * lat) -
      Math.cos(rad * decl) * Math.sin(rad * lat) * Math.cos(rad * H)) /
    Math.max(1e-9, Math.cos(rad * el))
  let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) / rad
  if (H > 0) az = 360 - az // afternoon → sun in the western half

  return { elevationDeg: el, azimuthDeg: az, declinationDeg: decl, eotMin }
}

// Unit vector pointing FROM the scene TOWARD the sun in world coords.
export function sunVector({ azimuthDeg, elevationDeg }) {
  const rad = Math.PI / 180
  const el = elevationDeg * rad
  const az = azimuthDeg * rad
  return {
    x: Math.sin(az) * Math.cos(el), // East
    y: Math.sin(el), // up
    z: -Math.cos(az) * Math.cos(el), // North is −z
  }
}

// Compact human label like "34° · SSE" (or "below horizon").
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
export function sunLabel(pos) {
  if (pos.elevationDeg <= 0) return 'below horizon'
  const idx = Math.round(pos.azimuthDeg / 22.5) % 16
  return `${Math.round(pos.elevationDeg)}° · ${POINTS[idx]}`
}
