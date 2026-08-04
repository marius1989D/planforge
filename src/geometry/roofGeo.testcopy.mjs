// ============================================================
// PlanForge — pitched (hip) roof geometry
// ------------------------------------------------------------
// Key fact: for a uniform-pitch hip roof, the roof surface is
// EXACTLY  z = tan(pitch) × distance-to-footprint-boundary —
// that's the surface the straight skeleton describes. So rather
// than implementing skeleton event handling (fragile), we:
//   1. earcut-triangulate the footprint,
//   2. subdivide triangles (midpoint 4-way) until edges are short,
//   3. displace every vertex by the distance function.
// Ridges and hips emerge naturally; eaves are exact (boundary
// vertices have distance 0); the mesh is watertight by
// construction (midpoints deduped via edge cache).
// Footprint comes in as plan mm (y-down); output geometry is in
// world metres with plan y mapped to world z and height on +y,
// ready to place at wall-top height.
// ============================================================
import * as THREE from 'three'
import { pointToSegmentDist } from './geo.js'

const M = 1 / 1000

export function buildHipRoofGeometry(footprintMm, { pitchDeg = 30, targetEdgeM = 0.35 } = {}) {
  if (!footprintMm || footprintMm.length < 3) return null
  const slope = Math.tan((pitchDeg * Math.PI) / 180)

  // metres, keeping plan axes (x, y) — mapped to world (x, z) at the end
  const boundary = footprintMm.map((p) => ({ x: p.x * M, y: p.y * M }))

  // 1. triangulate
  const contour = boundary.map((p) => new THREE.Vector2(p.x, p.y))
  const triIdx = THREE.ShapeUtils.triangulateShape(contour, [])
  let vertices = boundary.map((p) => ({ x: p.x, y: p.y }))
  let faces = triIdx.map(([a, b, c]) => [a, b, c])

  // 2. midpoint subdivision until the longest edge is short enough
  const edgeLen = (i, j) =>
    Math.hypot(vertices[i].x - vertices[j].x, vertices[i].y - vertices[j].y)
  for (let iter = 0; iter < 7; iter++) {
    const maxEdge = Math.max(
      ...faces.map(([a, b, c]) => Math.max(edgeLen(a, b), edgeLen(b, c), edgeLen(c, a))),
    )
    if (maxEdge <= targetEdgeM) break
    const midCache = new Map()
    const midpoint = (i, j) => {
      const key = i < j ? `${i}:${j}` : `${j}:${i}`
      if (midCache.has(key)) return midCache.get(key)
      const idx = vertices.length
      vertices.push({
        x: (vertices[i].x + vertices[j].x) / 2,
        y: (vertices[i].y + vertices[j].y) / 2,
      })
      midCache.set(key, idx)
      return idx
    }
    const next = []
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca])
    }
    faces = next
  }

  // 3. displace by distance to boundary
  const distToBoundary = (p) => {
    let best = Infinity
    for (let i = 0; i < boundary.length; i++) {
      const a = boundary[i]
      const b = boundary[(i + 1) % boundary.length]
      const d = pointToSegmentDist(p, a, b)
      if (d < best) best = d
    }
    return best
  }
  const z = vertices.map((v) => distToBoundary(v) * slope)
  const maxZ = Math.max(...z)

  // 4. BufferGeometry in world coords: (plan x, height, plan y)
  const positions = new Float32Array(vertices.length * 3)
  vertices.forEach((v, i) => {
    positions[i * 3] = v.x
    positions[i * 3 + 1] = z[i]
    positions[i * 3 + 2] = v.y
  })
  const index = new Uint32Array(faces.length * 3)
  faces.forEach(([a, b, c], i) => {
    index[i * 3] = a
    index[i * 3 + 1] = b
    index[i * 3 + 2] = c
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  geometry.computeVertexNormals()
  return { geometry, maxZ }
}
