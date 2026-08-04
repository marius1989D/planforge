// All internal values are mm. Only display strings go through here.

const MM_PER_FT = 304.8

export function formatLength(mm, units = 'mm') {
  if (units === 'ft') {
    const totalIn = mm / 25.4
    const ft = Math.floor(totalIn / 12)
    const inches = Math.round(totalIn - ft * 12)
    return inches === 12 ? `${ft + 1}'0"` : `${ft}'${inches}"`
  }
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`
  return `${Math.round(mm)} mm`
}

export function formatArea(m2, units = 'mm') {
  if (units === 'ft') return `${(m2 * 10.7639).toFixed(1)} sq ft`
  return `${m2.toFixed(1)} m²`
}

export const mmToFt = (mm) => mm / MM_PER_FT
export const ftToMm = (ft) => ft * MM_PER_FT
