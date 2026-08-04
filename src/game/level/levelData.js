// Authored skatepark layout. Single source of truth: the renderer draws from it
// and the collision system builds simplified colliders from the same records.
//
// World axes: +X right, +Z toward the camera, Y up. 1 unit ~= 1 metre.
//
// Conventions
//   box    { x,z,w,d,rot, base, top }   walkable top at `top`, solid below
//   ramp   { x,z,w,d,rot, y0,y1 }       uphill runs along LOCAL +Z, y0 = bottom
//   stairs same as ramp; collides as a smooth ramp, draws as steps
//   rot rotates about Y; local +Z maps to world (sin rot, cos rot)

export const DECK = 1.6 // back-right raised deck
export const PAD1 = 1.2 // mid-plaza raised pad
export const PAD2 = 0.9 // south low deck
export const HP_BASE = 0.35 // halfpipe platform height — must stay under STEP_UP (0.55)
// Wall height above the platform, and the flat between the two low edges. At
// DECK (1.6) over 4.6m of flat the pipe rode shallow and wide; 2.0 over a 2.4m
// run puts the lip at 80deg (R = (run^2+h^2)/2h = 2.42, barely over the run —
// h == run would be dead vertical and the arc degenerate), and the shorter flat
// means less rolling between transitions.
export const HP_H = 2.0
const HP_FLAT = 3.2

// The perimeter tree/shrub rings are ellipses that dip INSIDE the rectangular
// play area at its corners — exactly where the halfpipe sits. Keep-out box.
const HP_CLEAR = { minX: -33.5, maxX: -18.5, minZ: 18, maxZ: 31 }
const inHpClear = (x, z) => x > HP_CLEAR.minX && x < HP_CLEAR.maxX && z > HP_CLEAR.minZ && z < HP_CLEAR.maxZ

// ---------------------------------------------------------------- bowl
// Kidney footprint as a polar radius function around (cx, cz).
// Kept gently concave so inward offsetting for the transition never folds.
export const BOWL = {
  cx: -15,
  cz: -4,
  r0: 5.85,
  harmonics: [
    // [amplitude, harmonic, phase]
    [0.15, 2, 0.35],
    [0.1, 1, 0.95],
    [-0.055, 3, -0.4],
  ],
  depthMid: 2.05,
  depthAmp: 0.4,
  depthPhase: 2.2, // bearing of the deep end
  copingWidth: 0.62,
}

export function bowlRadius(phi) {
  let r = 1
  for (const [a, n, p] of BOWL.harmonics) r += a * Math.cos(n * phi + p)
  return BOWL.r0 * r
}

export function bowlDepth(phi) {
  return BOWL.depthMid + BOWL.depthAmp * Math.cos(phi - BOWL.depthPhase)
}

// ---------------------------------------------------------------- solids
const box = (o) => ({ kind: 'box', rot: 0, base: 0, style: 'concrete', ...o })
const ramp = (o) => ({ kind: 'ramp', rot: 0, curve: 'linear', ...o })
const stair = (o) => ({ kind: 'stairs', rot: 0, ...o })

export const SOLIDS = [
  // ---- raised decks -----------------------------------------------------
  box({ id: 'deckA', x: 20, z: -22, w: 28, d: 20, top: DECK, style: 'deck' }),
  box({ id: 'deckB', x: 30, z: -6, w: 8, d: 12, top: DECK, style: 'deck' }),
  box({ id: 'pad1', x: -9, z: 15, w: 14, d: 12, top: PAD1, style: 'deck' }),
  box({ id: 'pad2', x: 2, z: 26, w: 20, d: 8, top: PAD2, style: 'deck' }),

  // ---- ledges / manual pads --------------------------------------------
  // ledge2 (19,13), ledge3 (-3,-12) and the two mid-plaza planters are gone —
  // the centre read as a field of random squares. ledge1 is the one grind
  // feature left there, stretched to match its longer rail.
  box({ id: 'ledge1', x: 11, z: 5, w: 15, d: 1.9, top: 0.42, style: 'ledge' }),
  box({ id: 'ledge4', x: 17, z: -20, w: 9, d: 1.8, base: DECK, top: DECK + 0.42, style: 'ledge' }),

  // ---- transitions (uphill = local +Z) ---------------------------------
  ramp({ id: 'qp1', x: 18, z: -10.8, w: 9, d: 2.4, rot: Math.PI, y0: 0, y1: DECK, curve: 'quarter' }),
  // bank1 was here (x 29.5, z -10.2, rising 0 -> DECK) and it was dead geometry:
  // deckB spans x 26..34, z -12..0 with its top already AT DECK, so the ramp was
  // buried inside the slab — invisible, and its only approach ran through 4m of
  // solid deck. There is no face left to move it to (deckA is walled west and
  // north, its south face is stairB + qp1 between two dividers, and deckB is a
  // walled platform already fed by stairC and bank2), so it is gone rather than
  // sitting in the collider grid pretending to be a transition.
  ramp({ id: 'bank2', x: 24.2, z: -2.4, w: 4, d: 3.6, rot: Math.PI / 2, y0: 0, y1: DECK }),
  ramp({ id: 'bank3', x: -17.6, z: 16.5, w: 6.5, d: 3.2, rot: Math.PI / 2, y0: 0, y1: PAD1 }),
  ramp({ id: 'bank4', x: -3.5, z: 20.4, w: 7, d: 3.2, rot: 0, y0: 0, y1: PAD2 }),
  ramp({ id: 'bank5', x: 8.5, z: 20.6, w: 6, d: 2.8, rot: 0, y0: 0, y1: PAD2, curve: 'quarter' }),

  // ---- halfpipe ---------------------------------------------------------
  // Two facing quarters on a raised solid platform in the south-west corner,
  // 4.6m of flat between the low edges. The 0.35 base is under STEP_UP (0.55)
  // so you roll straight onto it; the quarters ride from the platform top.
  // style 'solid' renders the ridden surface (quarter faces + hpDeck top) in
  // pale blue sheet (hpSurfMap) over a birch plywood structure (woodMap) —
  // it reads as a built wooden ramp. Approached from
  // behind, a quarter's footprint reads as a wall at its top height (rampTopAt
  // measures the nearest edge), which is what a halfpipe's back should do.
  // All four boxes share the quarters' width (12) and style 'solid' so the
  // platform, transitions and top decks render flush in the same plywood —
  // at the old w:9 the masonry deck slabs stuck 0.5m past the ramp faces and
  // the whole structure read as a walled courtyard, not one U-shaped ramp.
  // z geometry hangs off the centre (24.5): half-flat 1.6, then a 2.4 run, then
  // a 1.4 deck — the platform spans the lot.
  box({ id: 'hpDeck', x: -26, z: 24.5, w: 12, d: HP_FLAT + 2 * (2.4 + 1.4), top: HP_BASE, style: 'solid' }),
  ramp({ id: 'hpN', x: -26, z: 24.5 - HP_FLAT / 2 - 1.2, w: 12, d: 2.4, rot: Math.PI, y0: HP_BASE, y1: HP_BASE + HP_H, curve: 'quarter', style: 'solid' }),
  ramp({ id: 'hpS', x: -26, z: 24.5 + HP_FLAT / 2 + 1.2, w: 12, d: 2.4, rot: 0, y0: HP_BASE, y1: HP_BASE + HP_H, curve: 'quarter', style: 'solid' }),
  // Top decks behind the coping, like a real vert ramp. Without them the
  // quarter is zero-thickness at its lip, and a dog CRESTING slowly straddles
  // the top with half its body printed out the back face — a lift can't fix
  // "the surface ends here". The ramp collider's 1m top overhang hands off to
  // these seamlessly; qp1 never had the problem because deckA is its deck.
  box({ id: 'hpDeckN', x: -26, z: 24.5 - HP_FLAT / 2 - 2.4 - 0.7, w: 12, d: 1.4, top: HP_BASE + HP_H, style: 'solid' }),
  box({ id: 'hpDeckS', x: -26, z: 24.5 + HP_FLAT / 2 + 2.4 + 0.7, w: 12, d: 1.4, top: HP_BASE + HP_H, style: 'solid' }),

  // ---- stairs -----------------------------------------------------------
  stair({ id: 'stairA', x: 0.5, z: 13, w: 5.4, d: 5, rot: -Math.PI / 2, y0: 0, y1: PAD1, steps: 6 }),
  stair({ id: 'stairB', x: 9, z: -9.1, w: 5, d: 5.8, rot: Math.PI, y0: 0, y1: DECK, steps: 7 }),
  stair({ id: 'stairC', x: 29, z: 2.2, w: 4.4, d: 4.4, rot: Math.PI, y0: 0, y1: DECK, steps: 5 }),
]

// ---------------------------------------------------------------- walls
// Lavender masonry with a pale stone cap. `base` is the ground it stands on,
// `h` the height above that. Solid; the cap is landable.
const wall = (o) => ({ base: 0, rot: 0, h: 1.15, mural: null, ...o })

function arcWall(cx, cz, r, a0, a1, n, h, muralAt) {
  const out = []
  for (let i = 0; i < n; i++) {
    const t = a0 + ((a1 - a0) * (i + 0.5)) / n
    out.push(
      wall({
        x: cx + Math.cos(t) * r,
        z: cz + Math.sin(t) * r,
        w: 1.1,
        d: ((a1 - a0) * r) / n + 0.3,
        rot: -t,
        h,
        mural: muralAt.includes(i) ? 'flower' : null,
      }),
    )
  }
  return out
}

export const WALLS = [
  // deck A: west retaining wall, north + east perimeter
  wall({ x: 5.4, z: -22, w: 1.2, d: 20, h: DECK + 0.7, mural: 'flower' }),
  // North and east run all the way OUT to the kerb (masonry inner face ~±35.9
  // / ~36.9, Skatepark's Kerb) instead of stopping 1.2 thick. At 1.2 they left
  // a 1.6m blind alley between their outer face and the kerb, wrapping the NE
  // corner as an L — a tight nothing-space you could roll into and get stuck.
  // Inner faces are unmoved (z -32, x 34), so nothing inside the park changes.
  wall({ x: 21.5, z: -33.5, w: 31, d: 3, h: DECK + 0.7 }),
  wall({ x: 35.5, z: -22, w: 3, d: 20, h: DECK + 0.7, mural: 'rainbow' }),
  // deck B
  wall({ x: 25.4, z: -8, w: 1.2, d: 8, h: DECK + 0.7, mural: 'flower' }),
  wall({ x: 35.5, z: -6, w: 3, d: 12, h: DECK + 0.7 }),
  wall({ x: 26.2, z: 1.4, w: 1.2, d: 4.4, base: 0, h: DECK + 0.55 }),
  wall({ x: 31.8, z: 1.4, w: 1.2, d: 4.4, base: 0, h: DECK + 0.55 }),
  // deck A front-edge dividers between the transitions
  wall({ x: 12.5, z: -12.4, w: 2, d: 1.4, h: DECK + 0.55 }),
  wall({ x: 23.6, z: -12.4, w: 2, d: 1.4, h: DECK + 0.55 }),

  // mid pad skirt (west face is left open for the bank)
  wall({ x: -9, z: 21.6, w: 14, d: 1.2, h: PAD1 + 0.55, mural: 'flower' }),
  wall({ x: -9.5, z: 8.4, w: 13, d: 1.2, h: PAD1 + 0.55, mural: 'skate' }),
  wall({ x: -16.6, z: 10.2, w: 1.2, d: 2.4, h: PAD1 + 0.55 }),
  wall({ x: -16.6, z: 20.4, w: 1.2, d: 2.4, h: PAD1 + 0.55 }),

  // south low deck skirt, split by the two banks
  wall({ x: 2.5, z: 21.6, w: 3, d: 1.2, h: PAD2 + 0.5 }),
  wall({ x: 2, z: 30.6, w: 20, d: 1.2, h: PAD2 + 0.6, mural: 'rainbow' }),

  // curved retaining wall hugging the bowl on the west — ref image 1
  ...arcWall(BOWL.cx, BOWL.cz, 9.4, 2.45, 4.55, 9, 1.15, [2, 6]),

  // north plaza divider with a rainbow mural
  wall({ x: -4, z: -20.6, w: 12, d: 1.2, h: 1.15, mural: 'rainbow' }),
  wall({ x: -10.6, z: -24, w: 1.2, d: 8, h: 1.15 }),
]

// ---------------------------------------------------------------- planters
export const PLANTERS = [
  // The two beds that used to sit at (-26,8) and (-34,16) are gone: they stood
  // squarely in the only run-in to the halfpipe, so every approach was a slalom
  // between them. Their greenery moved to (-35.5,24.5) — alongside the pipe,
  // against the west kerb, out of the lane.
  { x: -35.5, z: 24.5, w: 3, d: 6, h: 0.95, plant: 'tree' },
  { x: -29, z: -22, w: 5, d: 6, h: 0.95, plant: 'tree' },
  { x: -4, z: -25, w: 6, d: 4, h: 0.95, plant: 'tree' },
  { x: 9, z: -28, w: 5, d: 4, base: DECK, h: 0.95, plant: 'tree' },
  { x: 30, z: -28, w: 4, d: 4, base: DECK, h: 0.95, plant: 'tree' },
  { x: 30, z: -16.5, w: 4, d: 3, base: DECK, h: 0.95, plant: 'flowers' },
  { x: 14.5, z: -15.2, w: 3, d: 2.6, base: DECK, h: 0.95, plant: 'flowers' },
  { x: -18.5, z: 9.8, w: 3, d: 2.6, h: 0.95, plant: 'flowers' },
  { x: 27.5, z: 7.5, w: 4, d: 3.4, h: 0.95, plant: 'tree' },
  { x: 15.5, z: 21.5, w: 5, d: 3.4, h: 0.95, plant: 'flowers' },
  { x: -24, z: -30, w: 6, d: 4, h: 0.95, plant: 'tree' },
  { x: 21.5, z: -14.6, w: 3, d: 2.6, base: DECK, h: 0.95, plant: 'flowers' },
]

// perimeter landscaping band; also the play-area clamp
export const PERIMETER = { minX: -37, maxX: 37, minZ: -35, maxZ: 33 }
// Height of the landscaped band outside the kerb. Anything planted in it roots
// here, not at 0 — that gap is what left the tree ring hovering over its own
// shadow.
export const GRASS_Y = -0.3

// Play area plus the masonry kerb ringing it (kerb spans out to ~1.9 past
// PERIMETER; 2.2 adds trunk clearance). Perimeter foliage must root outside
// this — the ring ellipses dip inside the rectangle at its corners.
const KERB_OUT = 2.2
const inPlayBand = (x, z) =>
  x > PERIMETER.minX - KERB_OUT &&
  x < PERIMETER.maxX + KERB_OUT &&
  z > PERIMETER.minZ - KERB_OUT &&
  z < PERIMETER.maxZ + KERB_OUT

// ---------------------------------------------------------------- rails
export const RAILS = [
  // r1/r4 stretched and r3's ledge deleted outright: the opened-up centre
  // trades square clutter for longer grind lines.
  { id: 'r1', color: 'railTeal', posts: 'flat', pts: [[2, 0.58, -4], [20, 0.58, -4]] },
  { id: 'r2', color: 'railPink', posts: 'ledge', pts: [[4.4, 0.95, 5], [17.6, 0.95, 5]] },
  { id: 'r4', color: 'railYellow', posts: 'flat', pts: [[-6, 0.58, -18], [-6, 0.58, -4]] },
  { id: 'r5', color: 'railTeal', posts: 'flat', pts: [[27, DECK + 0.58, -27], [27, DECK + 0.58, -17]] },
  { id: 'r6', color: 'railPink', posts: 'ledge', pts: [[13.2, DECK + 0.95, -20], [20.8, DECK + 0.95, -20]] },
]

// Handrail running alongside a stair collider. `off` is the sideways distance
// from the stair's centreline, and every handrail in the park runs INSIDE the
// treads. It cannot go outside: Skatepark's Stairs draws a masonry STRINGER
// wall down each cheek spanning |lx| = w/2 .. w/2 + 0.5, and the old default of
// w/2 + 0.5 put the rail dead on that wall's outer face — stairA's two rails
// were half-buried in their own stringers for the whole run (the tube is 0.055
// and the masonry is opaque, so from most angles it just read as a yellow bar
// lying on a wall). The stringer is drawn geometry, not a WALL row, which is
// why nothing caught it; rails.check.js knows about it now.
// stairB and stairC also have real walls hugging both cheeks (deckA's
// retaining wall and front-edge divider; stairC's two side walls), so outside
// was never an option there either. 0.7 in from the cheek on all three.
function handrail(s, side, color, off = s.w / 2 - 0.7, lift = 0.95) {
  const c = Math.cos(s.rot)
  const sn = Math.sin(s.rot)
  const ox = off * side
  // local (lx,lz) -> world
  const p = (lz, ly) => [s.x + ox * c + lz * sn, ly + lift, s.z - ox * sn + lz * c]
  return {
    id: `${s.id}-hr${side > 0 ? 'R' : 'L'}`,
    color,
    posts: 'stair',
    pts: [
      p(-s.d / 2 - 0.7, s.y0),
      p(-s.d / 2, s.y0),
      p(s.d / 2, s.y1),
      p(s.d / 2 + 0.8, s.y1),
    ],
  }
}

for (const [id, side, color, off] of [
  ['stairA', 1, 'railTeal'],
  ['stairA', -1, 'railYellow'],
  ['stairB', 1, 'railYellow', 2.0],
  ['stairB', -1, 'railTeal', 2.0],
  ['stairC', -1, 'railPink', 1.7],
]) {
  RAILS.push(handrail(SOLIDS.find((s) => s.id === id), side, color, off))
}

// ---------------------------------------------------------------- props
export const LAMPS = [
  { x: -27, z: 3, banner: 'skate' },
  { x: -23.5, z: -17, banner: null },
  { x: 3.5, z: -17.5, banner: 'flower' },
  { x: 24, z: -30, base: DECK, banner: null },
  { x: 36, z: -2, banner: 'skate' },
  { x: -18.5, z: 24, banner: 'flower' },
  { x: 13.5, z: 18, banner: null },
  { x: 33.5, z: -19, base: DECK, banner: null },
  { x: 0, z: 32, banner: 'flower' },
]

// benches tucked against the curved wall, facing the bowl — ref image 1
export const BENCHES = [
  // A bench's local +Z is the seat front (back slats sit at local -0.3), so the
  // rot that looks INWARD from a point at bearing t is -t - PI/2. The +PI/2 form
  // is the outward normal and put all four backs to the bowl, facing the wall
  // 1.2m behind them.
  ...[2.7, 3.35, 4.0, 4.4].map((t) => ({
    x: BOWL.cx + Math.cos(t) * 8.2,
    z: BOWL.cz + Math.sin(t) * 8.2,
    rot: -t - Math.PI / 2,
  })),
  { x: -4, z: -19.3, rot: 0 },
  { x: 2, z: -19.3, rot: 0 },
  // on pad1's top (z 9..21), not the plaza floor — without `base` it sat 1.2m
  // under the deck it is standing on.
  { x: -9, z: 20.1, base: PAD1, rot: Math.PI },
  // both deck benches back onto a planter and look south over the deck edge.
  { x: 18.6, z: -14.4, base: DECK, rot: 0 },
  { x: 30.5, z: -14.6, base: DECK, rot: 0 },
]

// Perimeter tree ring — instanced, purely decorative framing.
export const TREES = (() => {
  const out = []
  const P = PERIMETER
  const cx = (P.minX + P.maxX) / 2
  const cz = (P.minZ + P.maxZ) / 2
  let seed = 1337
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let ring = 0; ring < 3; ring++) {
    const n = 46 - ring * 6
    for (let i = 0; i < n; i++) {
      const t = ((i + rnd() * 0.7) / n) * Math.PI * 2
      const k = 1.06 + ring * 0.16 + rnd() * 0.09
      const x = cx + Math.cos(t) * ((P.maxX - P.minX) / 2) * k
      const z = cz + Math.sin(t) * ((P.maxZ - P.minZ) / 2) * k
      if (inHpClear(x, z)) continue
      // No lone trees inside the play area or on the kerb ringing it — trees
      // belong to the grass band or a planter bed. The ellipse dips inside the
      // rectangle at all four corners, and the kerb runs ~1.9m outside
      // PERIMETER (Skatepark's Kerb: centre ±1.4, half-width 0.5 + cap).
      if (inPlayBand(x, z)) continue
      out.push({ x, z, base: GRASS_Y, s: 0.75 + rnd() * 0.85, r: rnd() * 6.28 })
    }
  }
  return out
})()

// Ground-level shrub clusters framing the perimeter inside the tree ring.
export const SHRUBS = (() => {
  const out = []
  const P = PERIMETER
  const cx = (P.minX + P.maxX) / 2
  const cz = (P.minZ + P.maxZ) / 2
  let seed = 99
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) / 0x7fffffff)
  for (let i = 0; i < 150; i++) {
    const t = (i / 150) * Math.PI * 2 + rnd() * 0.1
    const k = 1.0 + rnd() * 0.22
    const x = cx + Math.cos(t) * ((P.maxX - P.minX) / 2) * k
    const z = cz + Math.sin(t) * ((P.maxZ - P.minZ) / 2) * k
    if (inHpClear(x, z) || inPlayBand(x, z)) continue
    out.push({ x, z, base: GRASS_Y, s: 0.7 + rnd() * 0.7, r: rnd() * 6.28 })
  }
  return out
})()

// ---------------------------------------------------------------- bones
// Floating collectibles (rendered/collected by components/Bones.jsx). Each is
// parked on a specific line the park already teaches: heights are solved
// against the measured movement numbers in PlayerController (flat ollie 1.28m,
// qp1 coping ollie 3.9-6.0m over the 1.6 coping, rolling launch 1.0-2.4m) plus
// the 1.1m collect radius on the body centre (feet + 0.45). bones.check.js
// asserts the float band and spacing.
export const BONES = [
  // qp1 vert air — above rolling-launch reach (apex centre ~4.45), needs the
  // coping ollie. Sits a hair inside the coping because launchOffLip drifts
  // the air back over the transition.
  { id: 'qp1Air', x: 18, y: 5.0, z: -11.5 },
  // halfpipe: a pumped air over hpN's lip. The lip is at z 20.5 (ramp centre
  // 21.7 - d/2), and z 21.9 put this 1.4m INSIDE the arc — an air off the
  // coping arcs over the lip and drops back down near it, so nothing that
  // launched off the wall ever reached that far in. Sits 0.5m inside like
  // qp1Air, for the same launchOffLip drift. Lip top is 2.35 (HP_BASE + HP_H).
  { id: 'pipeAir', x: -26, y: 3.9, z: 21.0 },
  // mid-grind on r1 — 1.6 clears the rolling body centre (1.55 max at radius)
  // but a grind (centre ~1.03) or a timed flat ollie takes it
  { id: 'railMid', x: 11, y: 1.6, z: -4 },
  // bowl deep-end air, just inside the rim at the depthPhase bearing
  { id: 'bowlAir', x: -17.5, y: 1.6, z: -0.35 },
  // the stairA gap — ollie off pad1's top edge and float the whole stair set
  { id: 'stairGap', x: 1.5, y: 2.5, z: 13 },
]

// ---------------------------------------------------------------- letters
// D-O-G, the S-K-A-T-E letters. Same float band and reachability rules as the
// bones (bones.check.js measures both), but parked on the three transitions the
// bones DON'T use, so spelling the word walks you round the park rather than
// round one feature: bank4 onto pad2, the ledge1 grind line, bank2 onto deckB.
export const LETTERS = [
  { id: 'D', ch: 'D', x: -3.5, y: 2.4, z: 23.5 },
  { id: 'O', ch: 'O', x: 5.5, y: 1.7, z: 5 },
  { id: 'G', ch: 'G', x: 27, y: 3.2, z: -2.4 },
]

// ---------------------------------------------------------------- trash cans
// Five smashables, on lines rather than in corners: you should hit these while
// going somewhere, not detour to them. They are NOT colliders (see Cans.jsx) —
// you ride straight through and they burst.
export const CANS = [
  { id: 'can0', x: -8, z: 2 }, // west plaza, on the roll-out from the bowl
  { id: 'can1', x: 14, z: 12 }, // east plaza open run
  { id: 'can2', x: 24, z: -17.5 }, // deckA, past ledge4
  { id: 'can3', x: -2, z: -14 }, // north plaza, in front of the mural wall
  { id: 'can4', x: 2, z: 26 }, // pad2, the bank4/bank5 landing
]

export const SPAWN = { x: 0, z: 6, heading: -0.4 }
