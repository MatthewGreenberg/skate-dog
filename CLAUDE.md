# Skate Dog

React 19 + @react-three/fiber + three.js browser game. A boy rides a dachshund
through a pastel skatepark. The park is entirely procedural — no image files, no
network fetches. Textures are painted into canvases at load, geometry is built in
code, props and foliage are baked into InstancedMeshes once and never touched.

The two assets are `public/boy.glb` (the rider) and `public/dog_compressed.glb`
(the dachshund he rides). Neither ships animation clips: both rigs are driven
every frame by authored pose tables, so they react to the sim rather than
playing a loop. See `player/boneRig.js` for what that costs.

The dog is Draco + KTX2 compressed. The decoders are copied out of
`three/examples/jsm/libs` into `public/draco` and `public/basis` — drei's
default draco path is a gstatic CDN, and nothing here fetches over the network
(the shoot harness least of all).

## Layout

```
src/game/
  palette.js          art-direction contract — C (albedo), M (roughness), LIGHT, TONE, RAMP
  photo.js            deterministic capture poses (see "Seeing your changes")
  store.js            useGame = UI state; P = per-frame state (never React state)
  level/
    levelData.js      authored layout. Single source of truth: renderer AND colliders read it
    colliders.js      simplified collision built from levelData
    parkGeometry.js   plaza / grass / ramp meshes
    bowlGeometry.js   analytic bowl — the drawn surface IS the ridden surface
    textures.js       every procedural map: albedo, normal, roughness, baked AO
    foliage.js        plant generation, pure data -> instance rows
  components/         Game (canvas + post), Lighting, Skatepark, Props, Player, Effects, UI
                      Effects.jsx = cartoon particle kit: rainbow grind sparks +
                      star-sparkle glitter (per-instance colour), star pops on
                      tricks/bails, shockwave rings on jump/grind-start (none on
                      land — rejected), anime speed streaks, dust, bowl carve
                      marks. All fixed-size instanced pools, zero alloc in
                      the frame loop; fades are scale-to-zero (no per-instance
                      alpha). Grind sparks escalate with hold time to match the
                      audio's escalating yips.
                      Rider.jsx = boy.glb + the pose table that drives it
                      Dog.jsx = dog_compressed.glb, fitted and posed the same way
                      clearCoat.js = swaps both rigs' standard materials for
                      physical ones and drives their clearcoat. Player.jsx owns
                      the leva folder ("Clear coat") so one slider moves both —
                      two useControls on the same path is a duplicate-key clash
                      ToonFX.jsx = leva-driven toon try-out passes (posterize,
                      depth outline, halftone, pixelate, tilt shift), all OFF by
                      default so the shoot harness and acceptance targets are
                      untouched. Tilt shift is postprocessing's own
                      TiltShiftEffect, built at module scope and mutated —
                      react-hooks/immutability rejects writing setters on a
                      useMemo'd object, and the r3f wrapper rebuilds the effect
                      (render target included) on every slider tick. Its
                      composite shader is REPLACED — see the gotcha below
  audio/
    AudioManager.js   fully synthesised SFX, no files. Cartoon-styled: slide-whistle
                      jump/bail, boing landings, and a synthesized dog voice —
                      yip() on jump/trick, whine() on bail, escalating
                      yips while a grind holds
  player/
    PlayerController.js  movement, tricks, grinding. Air tricks are on the
                       direction keys — left/right spin, back kickflips (the dog
                       IS the board, so its barrel roll is the flip). There is no
                       air *steering*: a slow AIR_TURN on the same stick just
                       fights the spin. Q/E/J still work as aliases.
    boneRig.js        drives boy.glb's skeleton from angles authored for a
                      procedural rig — read it before touching any pose number
tools/                capture harness (see below)
public/boy.glb        the rider. 34MB, 490k verts, 41 joints, no clips
public/dog_compressed.glb  the dog. 4.6MB draco+ktx2, 534k verts, 31 joints, no clips
public/{draco,basis}/ decoders for the above, served locally on purpose
ref/                  the reference stills the art is measured against
```

## The palette is a contract, not a suggestion

`palette.js` derives every value by decomposing the reference stills into
albedo x light. The load-bearing fact:

> A shadowed surface reads at (0.62, 0.62, 0.78) of its sunlit self. That solves
> to a **golden key** and a **cool violet ambient whose sum is neutral white**.
> The scene is warm-*painted*, not warm-*lit*.

Consequences worth internalising before touching any colour:

- Albedo in `C` is what the surface looks like under white light. Do not pre-warm
  it. **If a surface renders too orange, the light is wrong, not the paint.**
- Because key + ambient ~= white, a sunlit surface renders at roughly its own
  albedo. So an albedo has to BE the reference's sunlit reading — no exposure
  setting can fix a too-light albedo without crushing the occluded end.
- Shadow tints come from `SHADOW_TRANSFER`, never a grey multiply.
- Sample `RAMP.*` for per-instance variation. HSL jitter moves value and hue
  together and reads as noise; a ramp reads as a batch of real material.
- `LIGHT.target` holds measured sRGB acceptance values. Check against them.

Key-to-ambient ratio is the single easiest thing to get wrong. A key-dominant rig
puts occluded surfaces near black, which produces a bimodal image — flat hot
field, cliff into black — and reads to a viewer as *"there is no ambient
occlusion"* even when the AO pass is working perfectly.

## Seeing your changes

**Do not eyeball it, and do not trust a diff.** The game has a deterministic
photo mode: `?shot=<pose>` freezes the sim, parks the camera on an authored pose,
pins the wind clock and flips `window.__shotReady`.

```bash
node tools/shoot.mjs --tag mywork plaza bowl   # -> shots/mywork-{plaza,bowl}.png
node tools/shoot.mjs --tag mywork              # all six poses, ~45s
node tools/px.mjs shots/mywork-bowl.png open,0.62,0.90,16   # measure a patch
node tools/compare.mjs ref/ref-plaza.png shots/mywork-plaza.png out/ key.json
```

Poses: `plaza bowl hero props grove deck`. `plaza` and `bowl` are framed to match
the two reference stills, so they can be compared directly.

`compare.mjs` builds a **blind** A/B sheet — reference and capture side by side,
labelled A/B in a randomised order, key written wherever you point it. Judging
your own work against a labelled pair is worth very little.

Notes:
- The harness runs its own dev server on **3210** so it never fights yours on 3000.
- `tools/chrome.mjs` picks the Chrome build. **148.x is excluded on purpose**: its
  headless shell never fires ResizeObserver, so react-use-measure reports no size,
  R3F's Canvas never builds its renderer, and the page sits there rendering
  nothing with no console error. A ten-line R3F scene reproduces it.
- `?ao=1` renders the AO buffer alone — worth checking before concluding AO is
  missing, since a crushed histogram looks identical to a dead AO pass.

## Self-checks

Plain `node`, no framework. Run them after touching what they cover.

```bash
node src/game/level/foliage.check.js       # crowns, branch coverage, colour space
node src/game/level/benches.check.js       # bench facing + footing vs walls/planters/decks
node src/game/level/rails.check.js         # rail/post clearance vs walls, props, solids, other rails
node src/game/player/steering.check.js
node src/game/player/boneRig.check.js      # rider joint angles, in world space
node src/game/components/shadowfit.check.js
node src/game/components/clearCoat.check.js   # standard -> physical material swap
```

`boneRig.check.js` rebuilds boy.glb's skeleton straight out of the glTF node
tree (no loader, no DOM) and runs the same call sequence `Rider.jsx` runs, then
measures the result in world space. It is the only thing standing between a
sign error and a knee that bends sideways — a wrong axis still produces smooth,
finite, plausible numbers. It caught the A-pose bind below on its first run.

`foliage.check.js` earns its keep: it caught a floating crown and bare branch
shafts in the same session it was written, then a planter bed that was 26% bare
soil — which turned out to be the `prng` bug below, not the bed. When you add a
visual invariant, add the assertion — "leaf near the tip" passed while every
branch was bare along its shaft, and every row of a half-empty bed was finite,
in range and above the soil plane.

Two of its assertions are worth knowing about before you tune the plant tables:
a **grain** check (a clump must stay under 32% of the mass it sits in, and
`n * ratio^2` must clear 0.9 so shrinking clumps without raising the count does
not open the canopy into lace) and a **coverage** check that rasterises a bed's
plan and demands 96%+ closed.

## Gotchas paid for in blood

- **The dog's fit is measured, not typed.** `Box3.setFromObject` on a
  SkinnedMesh returns the *skinned* rest bounds (three calls the mesh's own
  `computeBoundingBox`), which is what Dog.jsx scales by — the raw position
  attribute is quantized and pre-skinning, so reading it directly gives half
  the size and a mesh centred on the wrong y. The dog is authored nose at +X,
  so the wrapper yaws it -90 degrees; consequently a dog bone delta swings
  fore/aft about **Z**, an ear flaps about X and the tail wags about Y.
  `BACK_Y` (0.355) is where the rider's feet go: the fitted back tops out at
  0.375 and the feet sink 0.02 into the coat.
- **An imported bone does not rest at identity.** The pose table was authored
  against groups whose rest orientation was identity, so `rotation.x = angle`
  meant something. boy.glb's `L_Thigh` rests near 180 degrees about Y. Writing
  the same Euler onto the bone rotates about a different axis and the leg swings
  out sideways. Every angle goes on as a world-space delta conjugated into the
  bone's rest frame instead (`setBone`).
- **The bind pose is not the pose the numbers mean.** Tripo shipped a relaxed
  A-pose: the right knee already flexed 0.31 rad, the right shin splayed 0.18
  rad out of the sagittal plane, and the two legs 17% different in length. So
  `knee = 0.30` meant two different things on the two legs, and the stance came
  out lopsided in a way that looks like a pose bug rather than a rig bug.
  `alignBone` bakes a fixed per-bone correction so a zero angle is straight
  down on both sides. The leg lengths cannot be corrected the same way — the
  pelvis-height math uses the mean, which floats one foot ~1.5cm and sinks the
  other by the same.
- **A prop's rot is a facing, not a normal.** `rot` yaws local +Z to world
  `(sin rot, cos rot)`, and a bench's local +Z is the *seat front*. Placing one
  on an arc at bearing `t`, the inward-facing rot is `-t - PI/2`; `-t + PI/2` is
  the outward normal. All four bowl benches shipped with the second, backs to
  the bowl and knees against a wall 1.2m away — a sign error that reads as
  deliberate set dressing from any distance. `benches.check.js` measures it.
- **A handrail is generated, so it doesn't know what it's standing in.**
  `handrail()` offset the rail `w/2 + 0.5` from the stair's centreline — just
  outside the tread. stairB is wedged between deckA's retaining wall and a
  front-edge divider, and stairC's two "side walls" hug its cheeks exactly, so
  three of the five handrails ran their tube AND their ground posts through a
  wall. Nothing looks wrong from a distance: the tube is 5.5cm and the wall is
  opaque. Those three take an explicit inset `off` and run over the treads.
  `rails.check.js` walks every rail at 10cm and measures it.
- **TiltShiftEffect carries two masks that disagree.** The blur material ramps
  its strength with a smoothstep across `[focusArea - feather, focusArea]`, but
  the composite that picks blurred-vs-sharp is `step(offset-b) - step(offset+b)`
  with `b = focusArea - feather` — it flips at the INNER end of that ramp, so a
  blurred pixel is never mixed with a sharp one anywhere on the frame. The
  result is a razor line, and on an inked frame it separates "has outlines"
  from "has none", which reads as a UI overlay clipping the render rather than
  as depth of field. ToonFX.jsx overwrites `fragmentShader` with the same ramp
  crossfaded, driven by an added `bandParams` vec4 — whose slots are NOT in
  ascending order (`inner-, outer-, OUTER+, inner+`), because the shader reads
  the upper edge as `smoothstep(w, z)`. Writing them ascending reverses that
  smoothstep: the top half stays permanently sharp and the bottom half goes to
  `mask = -1`, and a negative mask makes `mix()` extrapolate *past* the sharp
  frame, so the blurred half returns with bright fringes on every dark edge.
  The composite is also one-sided now: only the band's UPPER edge fades, so the
  frame below it is always sharp and slots x/y go unused (they stay in the
  uniform because the JS still mirrors the blur material's params).
  Also note the mask lives in
  NDC scaled by aspect on x, so `focusArea = 1` spans half the frame HEIGHT but
  only ~0.62 of half its width — a slider capped at 1 cannot reach the edge of
  a 90°-rotated band.
- **`MeshPhysicalMaterial.copy` cannot read a standard material.** It pulls
  clearcoat, sheen, iridescence and transmission straight off the source, so
  copying a MeshStandardMaterial in lands every physical parameter as
  `undefined` — NaN uniforms, and a rig that renders plausibly matte rather
  than erroring. `clearCoat.js` borrows `MeshStandardMaterial.prototype.copy`
  instead and puts the `PHYSICAL` define back, since that copy rewrites
  `defines` to STANDARD-only and the clearcoat chunks then never compile.
  `USE_CLEARCOAT` is likewise a define keyed on `clearcoat > 0`, and the
  renderer only re-picks a program when the material version moves — so 0 to
  0.4 renders identically without a `needsUpdate` on that crossing.
- **Instance colour space.** `bake()` reads row slots 9-11 as an *absolute
  linear* colour and divides the material base out to recover the multiplier.
  Emitting a multiplier there instead asks for `instanceColor` ~3.2 and renders
  white. This turned every trunk in the park into a pale stick.
- **Wind and non-uniform scale.** The wind shader inverts the instance basis
  per-column. An earlier version divided all three axes by column 0's length
  squared, which is only right for uniform scale — branches scale
  `(0.085, 0.9, 0.085)`, so they got 139x the displacement and flew off.
- **Tone-map operating point.** Khronos PBR Neutral is identity below linear 0.76
  then compresses hard. Sitting the plaza at 1.6 gives the curve a slope of 0.05,
  where *no* shading — occlusion, contact, texture variation — can move a sunlit
  pixel.
- **Cylindrical UVs converge.** The bowl's flat uses a planar mapping confined to
  a uniform strip of the texture. Carrying the cylindrical mapping across it puts
  a singularity at the centre, and since no tangent attribute is supplied three
  derives the frame from screen-space UV derivatives — producing a starburst even
  where the texture is a single colour.
- **`v=1` is the TOP of the canvas** under three's default `flipY`.
- **N8AO's `quality` prop** silently overwrites `aoSamples`, `denoiseSamples` and
  `denoiseRadius` in a second layout effect. Set them by hand.
- **The `prng` LCG needs `Math.imul`.** `seed * 1103515245` overflows 2^53 once
  the seed is near 2^31, so the low bits are noise and the sequence falls into a
  short orbit — 692 distinct values in 5000 draws. It went unnoticed for as long
  as every consumer drew a few dozen values; `pushBed` draws thousands and the
  bed came out as 94 columns of identical clumps. All four copies use `imul` now.
- **Foliage colour is set by histogram, not by patch.** Two sampled patches
  cannot see a distribution that is the right shape at the wrong centre, which
  is exactly what shipped: crown and core both landed near target while the
  MODE of the canopy sat 20 lightness points above the reference. Bin every
  green pixel (`hue 40-140, sat > 0.14`) by lightness and compare the curves.

## Conventions

- `P` (store.js) is mutable per-frame state read inside `useFrame`. Never put it
  in React state.
- Nothing in the park moves: `Skatepark` bakes world matrices once and sets
  `matrixWorldAutoUpdate = false`.
- Zero allocation inside the frame loop. Particle pools are fixed-size with
  round-robin allocation; reuse the module-scope temporaries.
- Target 60fps at 1600x1000. Currently ~120. `useGame(s => s.quality) === 'low'`
  scales expensive work down.
- Comments explain **why**, with the measurement that forced the value. This
  codebase is dense with them on purpose — they are the record of what was
  already tried and why it failed.
