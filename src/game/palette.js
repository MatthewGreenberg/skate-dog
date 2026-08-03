// Art-direction single source of truth.
//
// Every value below was derived by decomposing the two reference stills
// (ref/ref-plaza.png, ref/ref-bowl.png) into albedo x light rather than by
// eyedropping the pixels — a pixel is already lit, and copying lit pixels into
// albedo slots is exactly how the old palette ended up double-warming the plaza
// into terracotta.
//
// THE DECOMPOSITION THAT DRIVES EVERYTHING HERE.
// A shadowed surface is lit by ambient alone; a sunlit one by ambient + key.
// Measured across the reference concrete, masonry and stone:
//
//   shadow / sunlit  = (0.62, 0.62, 0.78)   dense, but the blue barely drops
//   => key alone     ~ (1.00, 0.94, 0.55)   GOLDEN, not orange
//   => ambient alone ~ (1.00, 1.02, 1.25)   a cool lavender sky
//   => key + ambient ~ (1.00, 1.00, 1.00)   THE SUM IS NEUTRAL WHITE
//
// That last line is the whole trick. The reference is not a warm-lit scene: it
// is a warm-*painted* scene under two complementary lights that cancel. All the
// peach lives in the albedo, all the drama lives in the split between a golden
// key and a violet sky. Our old rig had an orange key AND a warm ambient, so
// they compounded: every hue collapsed toward hue 20 and the lavender masonry
// turned magenta-brown. Fix the split, and the albedo can stay honest.
//
// Consequently: albedo values in `C` are what the material would look like
// under white light. Do not pre-warm them. If a surface renders too orange, the
// light is wrong, not the paint.

// ---------------------------------------------------------------- colour math
// Kept dependency-free on purpose: palette.js is imported by nine other modules
// and by the level pre-bake, and none of them should have to pull in three.js
// just to ask what colour a shadow is.

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

/** '#rrggbb' -> [r,g,b] in 0..255. */
export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** [r,g,b] -> '#rrggbb'. */
export function hexOf(c) {
  return '#' + c.map((v) => Math.round(clamp(v)).toString(16).padStart(2, '0')).join('')
}

/** Linear blend between two hexes; t=0 is `a`. */
export function mix(a, b, t) {
  const A = rgb(a)
  const B = rgb(b)
  return hexOf([0, 1, 2].map((i) => A[i] + (B[i] - A[i]) * t))
}

// The measured shadow transfer. Multiplying by this turns a sunlit reading into
// the shadowed reading of the *same* material — note how little blue is lost.
// Anything that wants a shadow tint (baked AO, painted texture shading, foliage
// underside tint, decal shadows) must use this and not a grey multiply, or the
// shadow reads as dirt instead of as sky-lit air.
export const SHADOW_TRANSFER = [0.62, 0.63, 0.8]

/** Sunlit colour -> shadowed colour. `k` scales between full sun (0) and full shadow (1). */
export function shade(hex, k = 1) {
  const c = rgb(hex)
  return hexOf(c.map((v, i) => v * (1 + (SHADOW_TRANSFER[i] - 1) * k)))
}

/** Shadowed colour -> sunlit colour. The inverse of `shade`, clamped. */
export function sunlit(hex, k = 1) {
  const c = rgb(hex)
  return hexOf(c.map((v, i) => v / (1 + (SHADOW_TRANSFER[i] - 1) * k)))
}

/** Push a colour toward another by t without changing its overall level much. */
export function tint(hex, toward, t) {
  return mix(hex, toward, t)
}

// ---------------------------------------------------------------- albedo
// Named for the *object*, not the pixel. Every one of these is a diffuse
// reflectance under white light.
export const C = {
  // ground / concrete ------------------------------------------------------
  // Reference plaza reads (247,171,131) in open sun. Under the corrected rig
  // that is very nearly the albedo itself. It is a pale, pink-leaning peach —
  // the old #eaad8f was a full stop darker and 10 deg further round toward
  // orange, which is what made the plaza read as terracotta tile.
  // Sunlit plaza renders at ~0.96 of albedo (the key and ambient sum to white
  // by construction), so the albedo has to BE the reference's sunlit reading of
  // (241,161,119). #f7b6a6 was a stop too light and 10 deg too pink, and no
  // amount of exposure could fix that without crushing the occluded end — the
  // level was never the light's to give.
  plaza: '#f4a87e',
  plazaAlt: '#e89d76', // the cooler half of the slab-to-slab variation
  // Joints, NOT grout. In the reference the slab seams are a barely-there
  // half-stop step, never a dark line. The old value was a 12% drop at full
  // saturation, which drew a hard orange grid across the widest surface in the
  // game and instantly read as bathroom tile.
  plazaGrout: '#dc9d7c',
  plazaWarm: '#ffbf95', // sun-bleached slabs; the lerp target in plazaMap()
  plazaCool: '#e8a086', // dusty pink slabs — breaks the field up without value noise

  // bowl -------------------------------------------------------------------
  // The single biggest miss in the old palette. Reference bowl runs from
  // (83,63,140) on the shaded wall to (200,143,225) where the sky sheen sweeps
  // across it: 33 points of lightness and a 30 deg hue swing (bluer in shade,
  // pinker in sun). Ours was a flat matte lilac with 14 points of range and the
  // hue sitting at 300 — magenta, because the orange key was eating its blue.
  // Push the albedo blue hard: the blue channel is the one the key starves.
  bowl: '#9b85f7',
  bowlDeep: '#7c66db', // floor / deep end, where baked occlusion already sits
  bowlSheen: '#efe8ff', // the broad sky reflection painted into bowlMap
  bowlShade: '#7060c4', // far wall turned away from the key
  // Coping is its own material in the reference: a pink-lilac cast stone, not
  // the cream of the wall caps and not the violet of the bowl. It is the line
  // that separates them, so it must sit between them in hue.
  coping: '#e6c2dc',

  // masonry ----------------------------------------------------------------
  // Reference masonry: (187,142,203) in sun, (122,85,144) in shade — a light,
  // slightly pink lavender that stays clearly *blue-violet* even under the
  // golden key. Ours rendered at hue 301 and lightness 34: too dark, too
  // magenta, and dead uniform. Widening wall/wallAlt into a genuine hue pair
  // (pink-lavender vs cool violet) is what gives the brick-to-brick variation
  // the reference has; masonryMap() lerps between them per block.
  wall: '#cba7ea',
  wallAlt: '#ae95df',
  wallDark: '#8f74b8', // mortar; reads as a recessed line, not a black gap
  wallPink: '#d3ade9', // occasional warm block
  wallCool: '#9c8ad6', // occasional cold block
  wallStone: '#b8a6c8', // occasional near-neutral block — kills the "all one dye" look

  // Caps and stairs are a pale limestone with a pink cast, not a neutral cream.
  // They must sit only ~4% above the plaza in value: in the reference they read
  // as cooler than the concrete, not brighter than it.
  cap: '#f1d4c8',
  capAlt: '#e0bfb4',
  stone: '#ead0c2',
  stoneDark: '#cdaca1',

  // halfpipe plywood — pale birch sheet. Warmer and yellower than the
  // limestone caps but still in the pastel band; benchWood is the dark rung.
  ply: '#e2c193',
  plyDark: '#c7a179',
  plyLight: '#f0d9b0',
  plyPale: '#f7e6c6',
  plySeam: '#a97f58',

  // halfpipe riding surface — pale sky-blue sheet (skatelite over the ply),
  // sitting between the teal rails and the lavender masonry in hue.
  hpSurf: '#8fc0d8',
  hpSurfDark: '#76abc7',

  // rails ------------------------------------------------------------------
  // Reference rails are pastel enamel: high value, moderate saturation, with a
  // crisp specular line along the top of the tube. Ours were a stop too dark
  // and, in the teal's case, pulled to hue 155 (green) because the rig had no
  // blue left to give. Lift value, keep saturation moderate, let the specular
  // carry the punch.
  railTeal: '#3ab4b8',
  railPink: '#f2a3b8',
  railYellow: '#f0d47f',
  railMint: '#8ad8c4',

  // props ------------------------------------------------------------------
  lamp: '#3f9083', // same enamel family as railTeal, two stops down
  lampGlass: '#ffe9c4',
  benchWood: '#b8926e',
  benchIron: '#584235',
  bannerPink: '#f4a8be',
  bannerCream: '#fdf0e1',

  // vegetation -------------------------------------------------------------
  // Set by histogram, not by patch. Over every green pixel of ref-plaza.png
  // (hue 40-140, sat > 0.14) the reference lands:
  //
  //   L 15-20%  15%   rgb( 53, 65, 26)  h78 s43
  //   L 20-25%  29%   rgb( 65, 80, 34)  h80 s41   <- mode
  //   L 25-30%  20%   rgb( 84, 95, 42)  h74 s39
  //   L 40-45%   5%   rgb(146,140, 67)  h56 s38
  //
  // Three facts fall out. (1) The MODE sits at lightness 22 — ours sat at 42
  // (grove) and 48 (plaza), i.e. the old albedos were a canopy-wide half stop
  // hot. (2) Saturation is a near-constant 38-43% top to bottom; ours sagged to
  // 23% in the light. (3) Hue runs YELLOWER as it brightens — 80 in the core,
  // 56 on the sunlit crown. Ours ran the other way and 30 deg too green, which
  // is the whole "emerald broccoli" read.
  //
  // Rendered ~= albedo here (key + ambient ~= white), so these ARE those
  // numbers with a little headroom for the clumps that face the sun square on.
  // ...and re-measured against the RENDER, which is the only test that counts.
  // Binning the canopy crops of a capture against the same crops of the ref
  // (tools + method above) still read mode L42 / hue 67 / sat 24 against the
  // reference's L22 / 77 / 38 — the exact failure the paragraph above describes,
  // diagnosed but never actually paid off in the albedos. Three points, all in
  // the same direction: the ramp comes DOWN (a canopy is mostly its own shade,
  // and only its cap is sun-struck), it goes GREENER, and it gains the
  // saturation the violet ambient eats out of a green. Sat is deliberately
  // pushed PAST the reference's 38: averaging a hundred differently-lit clumps
  // per crown desaturates the read by ~10 points before the ambient does.
  // Second pass on saturation: at s46-50 albedo the CROWNS still rendered at
  // s24-33 against the reference's s42-43, while lightness and hue had already
  // landed. Two things eat it and neither is a paint error — the violet ambient
  // adds blue to a green surface, and a crown patch is an average of ~100
  // differently-lit clumps. So the albedo carries the compensation: s56-60 in,
  // ~s40 out. This is the one place in the palette that is deliberately not a
  // measured reference value, because the measured value does not survive the
  // trip through this rig.
  // ...and then the art direction moved, by request: the target is now the
  // bright LIME ground cover of ref/ref-planter, not the olive of the original
  // stills. Everything above still applies — the hue is held, the saturation is
  // still carried past the reference for the same two reasons — only the value
  // band moved up about a stop and a half. LIGHT.target.leaf* below moved with
  // it; if a capture is compared against the OLD stills it will read hot, and
  // that is the intended difference, not a regression.
  // Third pass, and this one is a MEASUREMENT rather than an argument. Binning
  // the green pixels of a grove capture against ref-foliage, cropped to the
  // crowns and to the bed separately:
  //
  //             game crown          ref crown        game bed         ref bed
  //   hue          78                  78              82               90
  //   median L     0.43                0.41            0.35             0.34
  //   median SAT   0.36                0.53            0.42             0.48
  //
  // Hue and value had already landed. The whole remaining gap is CHROMA, and it
  // is 17 points on the crown. That is not a light-rig problem: the same
  // capture's plaza and masonry are on target, and a violet ambient over a green
  // albedo eats saturation without touching lightness, which is exactly the
  // shape of this error. So the albedos take the compensation for a third time —
  // ~s58 in rendered ~s38 out, so the stops go to s74-84 to land near s52.
  // Hue also splits: the reference's TREE is hue 78 and its BED is hue 90, so
  // `shrub` (which is the bed's mid stop) goes greener while the leaf* trio,
  // which the crowns ride, holds 72-88.
  // First capture of the above measured crown sat 0.48 (ref 0.53) and bed sat
  // 0.53 (ref 0.48) — chroma landed, and what was left was a value trim in each
  // direction. leafLight came down 4 points (the crown's lit tail carried 33% of
  // its green pixels above L0.52 against the reference's 23%) and `shrub` came
  // down 3 with 4 points of saturation off it (the bed measured L0.37 / s0.53
  // against 0.34 / 0.48).
  // Top stop only: the MEDIANS already match the reference (game bed h91 s50
  // L35 vs ref h88 s50 L34), so a global brighten is exactly the wrong move.
  // What was missing was RANGE at the LIT end — the reference's canopy runs to
  // hue p10 66 and L p90 53, the game's stopped at hue p10 82 / L p90 45, so the
  // bed read as one flat emerald mass instead of lime-on-top over mid-green
  // valleys. h75 -> h64 and L60 -> L67 (+7) puts the sun-struck tips on the
  // reference's yellow-lime. The dark stop is deliberately untouched: this is a
  // contrast change, not an exposure change.
  // Fourth pass, and it is about RANGE rather than centre. Binning the green
  // pixels of the last grove capture against ref-foliage, medians agreed (bed
  // L38 h92 s47 vs ref L34 h89 s49) but the two TAILS did not:
  //
  //                     game lit p80      ref lit p80     game dark p20   ref p20
  //   lightness            0.49              0.53             0.25          0.18
  //   hue                  85                71               91            98
  //   saturation           0.50              0.57             —             —
  //
  // i.e. the game's lit end just gets LIGHTER at a constant hue where the
  // reference's swings warm and saturated, and its shaded end never reaches a
  // real mid-green. That is a stop-placement error, not an exposure error: the
  // top stop moves toward yellow and gains chroma, the bottom stop moves toward
  // blue-green and loses value, and the mid holds so the medians (which already
  // match) do not move. SHADE_LIFT in foliage.js comes down with the dark stop —
  // the lift existed to keep leafDark off black, and a darker stop needs it less
  // than a lifted one needed it more.
  // Fifth pass, TOP STOP ONLY. Binning the last grove capture's crown pixels
  // against ref-foliage: median and shaded end now agree (game h81 s53 L34 vs
  // ref h80 s53 L39) and the lit tail does not — game L p90 48 against the
  // reference's 54. The canopy is missing the reference's yellow-lime highlight
  // TOPS, which is a stop-placement error at one end, so leafLight goes L62 ->
  // L68 and h59 -> h57. Nothing else moves: a global brighten would shift the
  // medians, which are already on target, and this is the failure mode every
  // comment above warns about arrived at from the other direction.
  leafLight: '#f8f162', // sun-struck cap: h57 s92 L68 — +6 L on the lit tail
  leaf: '#91be13', // h76 s82 L41 — the mode of the canopy, +6 chroma
  leafDark: '#2b5b0b', // h96 s78 L20 — shaded interior: deeper AND bluer-green
  // The bed measured h87 s51 against the reference's h96 s45 — nine degrees
  // yellow of it with six points more chroma — so the bed's own mid stop takes
  // the correction rather than the leaf* trio the crowns ride. h84 -> h89,
  // s70 -> s65, L held at 45 because the bed's median lightness is on target.
  shrub: '#75bd28', // h89 s65 L45 — beds read lighter AND greener than the tree core
  // Bark came down with the canopy. At L39 s45 a trunk rendered rgb(145,100,62)
  // — a bright orange stick under a green crown, and the most saturated warm
  // thing in a frame whose whole plaza is a pastel. It is a support, not a
  // subject: h28 s34 L33.
  trunk: '#715238', // reference bark is a grey-warm brown, not a saturated tan
  flowerWhite: '#fbf5ea',
  flowerPink: '#f7bcd0', // ref blossom measures hsl(334 80 89) — paler than it looks
  // The reference's dominant flower, and the old '#f7dc8c' was not a yellow at
  // all: hsl(45 86 76) is a cream, and a cream sitting on lime renders as a
  // BLEACHED PATCH — a grove capture had 1.9% "yellow-ish" pixels and not one of
  // them was legible as a flower. Isolating the reference's flower pixels
  // (h 38-62, s > 0.55, L > 0.45) gives hsl(58 86 61), rgb(241,232,72): a real
  // lemon, a third of a stop DARKER than the lit leaf it sits on rather than
  // lighter, which is what lets it read as an object instead of a highlight.
  // ...and then one hue step further. At h58 the bud knots read as a lighter
  // LIME than the leaf under them — the reference's are a golden yellow you
  // register as a different material, and isolating its bud pixels alone (not
  // all its flower pixels, which averages the white daisies in) gives
  // hsl(50 87 60). h50 s88 L58 is that, and the 8-point drop in value is what
  // stops a knot blowing through the bloom threshold on the crest of a mound.
  // ...and one step further again, measured off a capture rather than argued:
  // at h50 s88 L58 the knots rendered as PALE POPCORN — a cream-gold that sat a
  // stop above the lit leaf and read as a highlight, the same failure the
  // '#f7dc8c' note above describes, arrived at from the other side. The
  // reference's buds are a saturated gold you read as a different material from
  // the leaf, not as a brighter version of it. h48 s90 L52.
  flowerYellow: '#f3c716',
  soil: '#6b5142',

  // characters -------------------------------------------------------------
  // Read against the plaza, not in isolation: the kid has to separate from a
  // peach floor, so the shirt sits redder and darker than the ground while the
  // shorts carry the only strong blue in the frame.
  skin: '#efb98f',
  hair: '#83502f',
  shirt: '#ec6b4e',
  shorts: '#3d76c4',
  shoe: '#333952',
  dogCoat: '#eab476',
  dogCoatDark: '#c88f4c',
  dogEar: '#a97140',
  dogNose: '#3a2b24',

  // sky / atmosphere -------------------------------------------------------
  // `sun` is the KEY LIGHT colour and it is the highest-leverage value in this
  // file. Golden (G/R 0.92), not orange (the old #ffd0a0 sat at G/R 0.82, which
  // is what crushed green out of every surface in the scene).
  sun: '#ffeba6',
  // `skyHigh` is the ambient dome. It is the *complement* of the key and it is
  // what makes shadows read as sky-lit rather than as dirt. Cool lavender-blue,
  // measured at (1.00, 1.02, 1.25) relative to red. Warming this — as the old
  // pink #e9b9d3 did — is what removed every trace of sun/shade separation.
  skyHigh: '#ccd6ff',
  hemiSky: '#dce6ff', // upper hemisphere: same family as skyHigh, one step paler
  fill: '#9fbcff', // the cool counter-key; deliberately more saturated than skyHigh
  bounce: '#eab19c', // light coming back UP off the peach plaza — warm, pink, weak
  envWarm: '#ffe6cd', // the warm half of the generated environment (sun card + haze)

  // Distance haze is warm and light because it is sunlit air over a peach
  // ground. It should sit close to the sunlit plaza value, NOT to the sky.
  sky: '#f8dccb',
  fog: '#f9dcca',
  haze: '#fbe0cf',
}

// ---------------------------------------------------------------- sun / shade
// Precomputed pairs so nothing has to guess what a material looks like out of
// the light. Use TONE.x.shade for anything a shadow lands on that is not
// actually shadow-mapped: painted texture shading, instanced foliage undersides,
// vertex-colour occlusion, contact darkening.
const pair = (hex) => ({ sun: hex, shade: shade(hex), half: shade(hex, 0.5) })

export const TONE = {
  plaza: pair(C.plaza),
  stone: pair(C.stone),
  cap: pair(C.cap),
  wall: pair(C.wall),
  bowl: pair(C.bowl),
  coping: pair(C.coping),
  leaf: pair(C.leaf),
  shrub: pair(C.shrub),
  trunk: pair(C.trunk),
  railTeal: pair(C.railTeal),
  railPink: pair(C.railPink),
  railYellow: pair(C.railYellow),
}

// ---------------------------------------------------------------- ramps
// Ordered dark -> light. Texture painters and instanced-colour bakers should
// sample a ramp instead of jittering one hex, because HSL jitter moves value and
// hue together and ends up looking like noise; these move hue and value the way
// light actually does (shade is bluer, sun is yellower).
export const RAMP = {
  // widest range in the scene — the bowl is the hero surface in the bowl shot
  bowl: [C.bowlShade, C.bowlDeep, C.bowl, C.bowlSheen],
  masonry: [C.wallDark, C.wallCool, C.wall, C.wallPink],
  masonryBlocks: [C.wall, C.wallAlt, C.wallPink, C.wallCool, C.wallStone],
  plaza: [C.plazaGrout, C.plazaAlt, C.plazaCool, C.plaza, C.plazaWarm],
  stone: [C.stoneDark, C.capAlt, C.stone, C.cap],
  wood: [C.plyDark, C.ply, C.plyLight, C.plyPale],
  // four stops, not two: the reference canopy has a genuinely dark interior
  leaf: [shade(C.leafDark), C.leafDark, C.leaf, C.leafLight],
  flower: [C.flowerWhite, C.flowerPink, C.flowerYellow],
  rail: [C.railTeal, C.railPink, C.railYellow, C.railMint],
}

// ---------------------------------------------------------------- light rig
// The numeric contract for Lighting.jsx. These are not suggestions dressed as
// data — they are the values the decomposition above solves for, and the
// acceptance targets at the bottom are how you check the rig landed.
export const LIGHT = {
  // Sun is lower than we had it. The reference casts shadows about 1.4x the
  // height of what casts them, which is a 36 deg elevation; we were at 43 deg,
  // which shortens every shadow and flattens the relief on the masonry.
  // Azimuth is unchanged — shadows must keep falling toward camera-left.
  sunDir: [0.609, 0.588, -0.531],
  sunElevationDeg: 36,

  keyColor: C.sun,
  keyIntensity: 2.9, // was 2.55; the reference plaza sits ~8 lightness points brighter
  keyIsGolden: true, // G/R 0.92, B/R 0.65 — see the note on C.sun

  // Ambient must be cool and must be strong enough that shadows sit at 62% of
  // sun, not at 45%. Under-filled shadows are the single fastest way to make a
  // stylised scene look cheap: the reference never lets a shadow go muddy.
  hemiSky: C.hemiSky,
  hemiGround: C.bounce,
  hemiIntensity: 0.55,
  fillColor: C.fill,
  fillIntensity: 0.42, // was 0.34 and too warm-neutral to register
  fillDir: [-0.62, 0.42, 0.66], // opposite the key, slightly above the horizon
  envColor: C.skyHigh,
  envIntensity: 0.55,
  envWarm: C.envWarm,

  // Shadow. Density is a light-ratio, not a darkness knob: shadow = sun x this.
  shadowTransfer: SHADOW_TRANSFER,
  // Reference penumbrae are soft but not smeared — a wall's shadow is sharp for
  // the first ~0.3 world units and opens to ~0.5 units of blur by 3 units out.
  shadowSoftnessWorld: 0.45,
  shadowRadius: 4.5,

  // Haze. fogExp2, and the colour must be the sunlit-air value, not the sky:
  // hazing toward a cool sky punches a cold hole in a warm frame.
  fogColor: C.fog,
  fogDensity: 0.0075, // 6% at 30 units, 22% at 60 — visible at the frame edges only
  exposure: 1.02, // NeutralToneMapping; was 0.93 and the whole image sat a stop low

  // Acceptance targets, sampled off the render, sRGB 8-bit, HUD excluded.
  // If these land, the rig is right regardless of how the numbers above moved.
  target: {
    plazaSun: [247, 171, 131], // +/- 6
    plazaShadow: [147, 108, 104], // +/- 8  (note hue ~0, NOT hue 20)
    masonrySun: [187, 142, 203], // +/- 8
    masonryShade: [122, 85, 144], // +/- 8
    bowlShade: [91, 71, 154],
    bowlSun: [200, 143, 225],
    // A SUNLIT-CAP reading, i.e. the brightest few percent of the canopy — not
    // a value the crown as a whole should hit. When the two disagree, believe
    // leafModeL below: a canopy that meets leafCrown on average is the
    // half-stop-hot failure the leaf* comments describe.
    // Moved up with the lime repaint (see C.leaf* above). These are no longer
    // readings off ref/ref-grove — they are the new intent, scaled by the same
    // albedo-to-render ratio the old pair held.
    leafCrown: [196, 205, 104],
    leafCore: [62, 74, 28],
    // and the shape of the distribution, which a two-patch check cannot see:
    // over green pixels, the MODE of lightness must land in this band.
    leafModeL: 0.36,
    // Chroma is the target the two patches above kept missing, because two
    // samples cannot see a distribution that is the right VALUE at the wrong
    // saturation — the same failure mode the leaf* comments describe for
    // lightness. Median over green pixels (hue 40-140, sat > 0.14), cropped to
    // the crowns / to the bed, measured off ref-foliage:
    leafSatMed: 0.53, // tree crown
    shrubSatMed: 0.48, // planter bed
    shrubHueMed: 90, // the bed is a full ramp stop greener than the tree
  },

  // What is STILL wrong after the palette pass, measured off shots/palette-*.png
  // against ref/. These are light-side residuals: no albedo value can close
  // them, because each is a level or a channel the rig is not delivering.
  //
  //  1. Shadow HUE is now right and shadow LEVEL is not. Plaza shadow renders
  //     (128,103,105) hue 355 against the reference's (147,108,104) hue 5 — the
  //     blue landed to within one unit, the red is 19 short. shadow/sun measures
  //     (0.54, 0.62, 0.82) where the reference is (0.59, 0.62, 0.78). The
  //     ambient needs about +10% level with slightly more warm ground bounce in
  //     it, and exposure is still at 0.93.
  //  2. The bowl sits 16 lightness points under target AND takes a warmer light
  //     than the plaza does: its light measures B/R 0.73 where the plaza gets
  //     0.80. Cause: the bowl material is the only one running
  //     envMapIntensity 0.65, so it discounts the cool ambient while taking the
  //     warm hemisphere at full weight. Raise it to 1.0 and let the vertex-baked
  //     AO do the enclosure darkening it was written to do.
  //  3. Colours the rig still hardcodes and should be importing: the
  //     hemisphereLight skyColor '#ffe2c2' (-> C.hemiSky, the biggest single
  //     warm leak left), the environment Lightformers '#ffd9c0' and '#c7d8ff'
  //     (-> C.envWarm, C.fill), and Skatepark's coping tint '#e2cde8'
  //     (-> C.coping).
  residuals: ['ambientLevel', 'exposure', 'bowlEnvMapIntensity', 'hardcodedLightColours'],
}

// ---------------------------------------------------------------- surfaces
// Roughness targets. What makes the reference read as physical is that nothing
// is fully matte: every surface returns a broad, low-contrast specular that
// tracks the sky. A roughness of 0.9 gives you a paper cutout; 0.7-0.8 gives you
// cast stone. Metalness stays at 0 for everything that is not actually metal —
// a non-zero metalness on a dielectric kills its diffuse and darkens it.
export const M = {
  concrete: { roughness: 0.74, metalness: 0.0 }, // sealed plaza slab, faint sheen
  bowl: { roughness: 0.28, metalness: 0.0 }, // painted pool plaster: the sheen IS the look
  stone: { roughness: 0.74, metalness: 0.0 },
  masonry: { roughness: 0.74, metalness: 0.0 }, // glazed tile-brick, not chalk
  rail: { roughness: 0.28, metalness: 0.12 }, // enamel over steel; one crisp highlight line
  paintedMetal: { roughness: 0.38, metalness: 0.08 },
  foliage: { roughness: 0.86, metalness: 0.0 }, // leaves are waxy; 0.95 read as felt
  cloth: { roughness: 0.88, metalness: 0.0 },
  fur: { roughness: 0.8, metalness: 0.0 },

  // new slots — every one of these was previously borrowing a material that
  // gave it the wrong specular
  coping: { roughness: 0.42, metalness: 0.0 }, // worn smooth by decades of trucks
  wood: { roughness: 0.66, metalness: 0.0 }, // varnished bench slats
  hpSurf: { roughness: 0.42, metalness: 0.0 }, // pressed sheet surface, smoother than the ply it covers
  bark: { roughness: 0.92, metalness: 0.0 },
  soil: { roughness: 0.98, metalness: 0.0 },
  skin: { roughness: 0.68, metalness: 0.0 },
  glass: { roughness: 0.18, metalness: 0.0 },
  banner: { roughness: 0.86, metalness: 0.0 },
}
