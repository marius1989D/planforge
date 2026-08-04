// Furniture presets. Dimensions in mm: w = width, d = depth, h = height.
// position in the schema is the item's CENTER; rotation in degrees.
export const FURNITURE_LIBRARY = [
  { type: 'bed_double', label: 'Double Bed', w: 1600, d: 2000, h: 500, color: '#8fa3b8' },
  { type: 'bed_single', label: 'Single Bed', w: 900, d: 2000, h: 500, color: '#8fa3b8' },
  { type: 'sofa', label: 'Sofa', w: 1800, d: 850, h: 800, color: '#7d8ca3' },
  { type: 'armchair', label: 'Armchair', w: 850, d: 850, h: 800, color: '#7d8ca3' },
  { type: 'dining_table', label: 'Dining Table', w: 1600, d: 900, h: 750, color: '#a3927d' },
  { type: 'chair', label: 'Chair', w: 450, d: 450, h: 900, color: '#a3927d' },
  { type: 'desk', label: 'Desk', w: 1400, d: 700, h: 750, color: '#a3927d' },
  { type: 'wardrobe', label: 'Wardrobe', w: 1200, d: 600, h: 2000, color: '#95867a' },
  { type: 'counter', label: 'Kitchen Counter', w: 600, d: 600, h: 900, color: '#9aa5a1' },
  { type: 'fridge', label: 'Fridge', w: 700, d: 700, h: 1800, color: '#b9c2c9' },
  { type: 'bathtub', label: 'Bathtub', w: 1700, d: 750, h: 550, color: '#a9c4cc' },
  { type: 'toilet', label: 'Toilet', w: 400, d: 650, h: 400, color: '#c9c9c9' },
  { type: 'sink', label: 'Sink', w: 600, d: 450, h: 850, color: '#c0c9c9' },
  { type: 'coffee_table', label: 'Coffee Table', w: 1100, d: 600, h: 450, color: '#a3927d' },
  { type: 'tv_stand', label: 'TV Stand', w: 1400, d: 450, h: 550, color: '#8a8f99' },
  { type: 'bedside', label: 'Bedside Table', w: 450, d: 400, h: 550, color: '#95867a' },
  { type: 'bookshelf', label: 'Bookshelf', w: 900, d: 350, h: 1900, color: '#95867a' },
  { type: 'shower', label: 'Shower', w: 900, d: 900, h: 2000, color: '#a9c4cc' },
]
export const FURNITURE_BY_TYPE = Object.fromEntries(
  FURNITURE_LIBRARY.map((f) => [f.type, f]),
)
