// AI plan pipeline tests (no network — fake model replies).
import { parseAiPlanJson, normalizeAiPlan, aiTextToPlan } from './planGen.js'

let failures = 0
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  → ' + detail}`)
  if (!cond) failures++
}

// ---- JSON extraction ------------------------------------------
{
  check('plain JSON', parseAiPlanJson('{"a":1}').data?.a === 1)
  check('fenced JSON', parseAiPlanJson('Here you go:\n```json\n{"a":2}\n```').data?.a === 2)
  check('prose before + after', parseAiPlanJson('Sure! {"a":3} Hope that helps.').data?.a === 3)
  check('nested braces + braces in strings',
    parseAiPlanJson('x {"a":{"b":"{not a brace}"},"c":4} y').data?.c === 4)
  check('broken JSON → error', !!parseAiPlanJson('{"a":').error)
  check('no JSON → error', !!parseAiPlanJson('I cannot do that.').error)
  check('empty → error', !!parseAiPlanJson('').error)
}

// ---- a realistic good reply ------------------------------------
const goodReply = `\`\`\`json
{
  "name": "Cottage",
  "roof": "pitched",
  "roofPitch": 35,
  "floors": [{
    "name": "Ground Floor",
    "walls": [
      {"x1":0,"y1":0,"x2":9000,"y2":0,"thickness":300},
      {"x1":9000,"y1":0,"x2":9000,"y2":7000,"thickness":300},
      {"x1":9000,"y1":7000,"x2":0,"y2":7000,"thickness":300},
      {"x1":0,"y1":7000,"x2":0,"y2":0,"thickness":300},
      {"x1":4000,"y1":0,"x2":4000,"y2":7000,"thickness":150}
    ],
    "doors": [
      {"wall":2,"offset":1000,"width":900},
      {"wall":4,"offset":3000,"width":900}
    ],
    "windows": [
      {"wall":0,"offset":1200,"width":1400,"sill":900},
      {"wall":1,"offset":2500,"width":1600}
    ]
  }]
}
\`\`\``
{
  const r = aiTextToPlan(goodReply)
  check('good reply: no error', !r.error, r.error)
  const g = r.plan.floors[0]
  check('good reply: 5 walls, split at the divider junctions',
    g.walls.length >= 5, g.walls.length)
  check('good reply: TWO rooms detected (divider works)',
    g.rooms.filter((x) => x.source === 'auto').length === 2,
    g.rooms.length)
  check('good reply: 2 doors + 2 windows survive',
    g.openings.filter((o) => o.type === 'door').length === 2 &&
    g.openings.filter((o) => o.type === 'window').length === 2)
  check('good reply: meta carried', r.plan.name === 'Cottage' && r.plan.roofPitch === 35)
  check('good reply: schema v2 importable shape',
    r.plan.schemaVersion === 2 && Array.isArray(r.plan.floors))
}

// ---- defensive coercion / clamping -----------------------------
{
  const messy = {
    name: 'Messy', roof: 'dome', roofPitch: '95',
    floors: [{
      walls: [
        { x1: '0', y1: 0, x2: '6000', y2: 0, thickness: 9999 },   // strings + silly thickness
        { x1: 6000, y1: 0, x2: 6000, y2: 5000 },
        { x1: 6000, y1: 5000, x2: 0, y2: 5000 },
        { x1: 0, y1: 5000, x2: 0, y2: 0 },
        { x1: 100, y1: 100, x2: 150, y2: 100 },                    // 50mm — too short
        { x1: 0, y1: 0, x2: 6000, y2: 0 },                          // duplicate
        { x1: 'abc', y1: 0, x2: 1000, y2: 0 },                      // garbage coords
      ],
      doors: [
        { wall: 0, offset: 999999, width: 900 },   // offset clamped into the wall
        { wall: 42, offset: 100 },                  // missing wall index
        { wall: 1, offset: 500, width: 99999 },     // wider than the wall
      ],
      windows: [{ wall: 2, offset: '2000', sill: '4000' }], // string coords, silly sill
    }],
  }
  const r = normalizeAiPlan(messy)
  check('messy: still produces a plan', !r.error, r.error)
  const g = r.plan.floors[0]
  check('messy: 4 clean walls survive', g.walls.length === 4, g.walls.length)
  check('messy: thickness clamped to 500', g.walls[0].thickness === 500)
  check('messy: roof falls back, pitch clamped to 60',
    r.plan.roof === 'pitched' && r.plan.roofPitch === 60)
  const doors = g.openings.filter((o) => o.type === 'door')
  // door (a): offset 999999 clamped inside wall 0; door (c): width
  // 99999 clamped to the sane door max (2400) and kept
  check('messy: 2 doors survive, offsets clamped, widths type-sane',
    doors.length === 2 &&
    doors.every((d) => d.width <= 2400) &&
    doors.every((d) => {
      const wl = d.wallId === g.walls[0].id ? 6000 : 5000
      return d.offset >= 50 && d.offset + d.width <= wl - 50 + 1
    }), JSON.stringify(doors))
  const win = g.openings.find((o) => o.type === 'window')
  check('messy: window sill clamped to 1500', win && win.sillHeight === 1500)
  check('messy: warnings name every drop (3 walls + 1 door)', r.warnings.length === 4, JSON.stringify(r.warnings))
  check('messy: room still detected', g.rooms.length === 1)
}

// ---- healing near-miss joins -----------------------------------
{
  const sloppy = {
    name: 'Sloppy',
    floors: [{
      walls: [
        { x1: 0, y1: 0, x2: 5000, y2: 0 },
        { x1: 5000, y1: 8, x2: 5000, y2: 4000 },   // 8mm gap at the corner
        { x1: 5000, y1: 4000, x2: 0, y2: 4005 },   // 5mm skew
        { x1: 0, y1: 4000, x2: 0, y2: 0 },
      ],
      doors: [{ wall: 0, offset: 800 }],
    }],
  }
  const r = normalizeAiPlan(sloppy)
  check('sloppy joins healed → room detected', !r.error && r.plan.floors[0].rooms.length === 1,
    JSON.stringify(r.plan?.floors[0].rooms.length))
}

// ---- hard failures ---------------------------------------------
{
  check('no floors → error', !!normalizeAiPlan({ name: 'x' }).error)
  check('all walls invalid → error',
    !!normalizeAiPlan({ floors: [{ walls: [{ x1: 0, y1: 0, x2: 10, y2: 0 }] }] }).error)
  check('non-object → error', !!normalizeAiPlan('hello').error)
  const open = normalizeAiPlan({
    floors: [{ walls: [
      { x1: 0, y1: 0, x2: 5000, y2: 0 },
      { x1: 5000, y1: 0, x2: 5000, y2: 4000 },
      { x1: 0, y1: 4000, x2: 0, y2: 0 },
    ] }],
  })
  check('open loop → plan with a no-rooms warning', !open.error &&
    open.warnings.some((w) => w.includes('do not close')), JSON.stringify(open.warnings))
}

// ---- two floors -------------------------------------------------
{
  const shell = [
    { x1: 0, y1: 0, x2: 8000, y2: 0 }, { x1: 8000, y1: 0, x2: 8000, y2: 6000 },
    { x1: 8000, y1: 6000, x2: 0, y2: 6000 }, { x1: 0, y1: 6000, x2: 0, y2: 0 },
  ]
  const r = normalizeAiPlan({ floors: [
    { name: 'G', walls: shell, doors: [{ wall: 0, offset: 900 }] },
    { name: 'Up', walls: shell, windows: [{ wall: 1, offset: 2000 }] },
  ] })
  check('two floors: both built with their own rooms',
    !r.error && r.plan.floors.length === 2 &&
    r.plan.floors.every((f) => f.rooms.length === 1))
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
