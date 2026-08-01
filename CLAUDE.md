# Skate Dog

React 19 + @react-three/fiber + three.js browser game. A boy rides a dachshund
through a pastel skatepark. The park is entirely procedural — no image files, no
network fetches. Textures are painted into canvases at load, geometry is built in
code, props and foliage are baked into InstancedMeshes once and never touched.

The two assets are `public/boy.glb` (the rider) and `public/dog_compressed.glb`
(the dachshund he rides). Neither ships animation clips: both rigs are driven
every frame by authored pose tables, so they react to the sim rather than
playing a loop. See `player/boneRig.js` for what that costs.

The dog is Draco + KTX2 compressed; the boy is Draco only (his textures total
~0.7MB — all 33MB of him was geometry). Both pass `/draco/` to `useGLTF`.
The decoders are copied out of
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
    levelData.js      authored layout. Single source of truth: renderer AND colliders read it.
                      hpN/hpS are a halfpipe (two facing quarters, 4.6m flat)
                      on a raised 0.35 platform (hpDeck, under STEP_UP so you
                      roll straight on) in the south-west corner. All four hp
                      boxes carry style 'solid' and the quarters' width (8):
                      Skatepark renders 'solid' as a pale blue sheet riding
                      surface (hpSurfMap; buildRampGeometry group 0 = surface,
                      group 1 = skirts/back, and hpDeck's box +Y face) over
                      birch plywood structure (woodMap / woodNormal, RAMP.wood
                      stops) — SolidSlab uses texBox, not RoundedBox, because
                      RoundedBox's extruded-shape UVs put the flat's planks 90
                      degrees off the riding direction. At the old w:9 masonry
                      the structure read as a walled courtyard, not a
                      halfpipe. hpDeckN/S are top decks behind the coping — a
                      freestanding quarter is zero-thickness at its lip, and a
                      dog cresting slowly straddled it with half its body out
                      the back face; no rig lift can fix "the surface ends
                      here". The ramp collider's 1m top overhang hands off to
                      them seamlessly. sampleSurface returns analytic arc
                      curvature (out.curv, 1/R on quarters) so the rig's
                      clearance lift is exact and instant instead of measured
                      a frame late.
                      The perimeter tree/shrub ring ellipses dip INSIDE the
                      rectangular play area at its corners — HP_CLEAR keeps
                      them out of the halfpipe, and TREES also drops any ring
                      tree landing inside PERIMETER (no lone trees in the
                      plaza; trees live in the ring or a planter bed). Shrubs
                      may still dip in — that's ground cover, not trees. The plaza centre was
                      deliberately opened up — ledge2, ledge3 and the two mid
                      planters are gone, r1/r4/r2 run longer instead. Don't
                      refill the middle with props.
    rails.js          grind paths. RAILS are the drawn tubes; every wall cap and
                      planter rim is ALSO a path, derived here from the same
                      boxes (`wallcap*_a/b` / `planter*_*`, 104 of them): both
                      top EDGES of a cap, not its centreline — you grind a lip
                      with the dog hanging over the face, and a centreline put
                      it in the middle of the structure. Offsets are measured
                      off the DRAWN stone (cap = w + 0.18, planter rim =
                      p.w + 0.24), not the collider box, and a wall cap's top
                      is `w.h` absolutely — `base` does not add. Nothing new
                      is drawn — Skatepark still renders only RAILS — and
                      findGrind's dy window (0.75 up / 0.45 down) is what stops
                      a cap 0.95 overhead from grabbing you as you roll past.
                      Planter rims are four separate runs, not a loop: a loop
                      snaps the heading 90 degrees at each corner.
    colliders.js      simplified collision built from levelData
    parkGeometry.js   plaza / grass / ramp meshes
    bowlGeometry.js   analytic bowl — the drawn surface IS the ridden surface
    textures.js       every procedural map: albedo, normal, roughness, baked AO
    foliage.js        plant generation, pure data -> instance rows
  components/         Game (canvas + post), Lighting, Skatepark, Props, Player, Effects, UI
                      GameUI also owns the mobile controls: on coarse-pointer
                      devices a left joystick + right JUMP button write into
                      input.js's `touch` state, merged with the keys in
                      sampleInput. The stick deliberately maps to the SAME
                      steer/throttle/reverse axes — in the air that already
                      means spin/grab/kickflip, so one stick does every trick.
                      Stick response saturates at 55% deflection (raw 1:1 put
                      every input at half strength on a phone). input.js's
                      TOUCH flag also drops the default quality to 'low',
                      caps dpr at 1.5 (Game.jsx) and pulls the chase camera
                      back (CameraController zoom 0.9 vs 1.2) — the shoot
                      harness is desktop headless, so captures see none of it.
                      Effects.jsx = cartoon particle kit: rainbow grind sparks +
                      star-sparkle glitter (per-instance colour), star pops on
                      tricks/bails, shockwave rings on jump/grind-start (none on
                      land — rejected), anime speed streaks, dust, bowl carve
                      marks. All fixed-size instanced pools, zero alloc in
                      the frame loop; fades are scale-to-zero (no per-instance
                      alpha). Grind sparks escalate with hold time. Big air:
                      PlayerController emits 'bigair' once per air past 1.0s
                      (a flat ollie is ~0.69s, so only pumped ramp/bowl airs
                      fire) — rainbow star halo + a streaming rainbow trail
                      until landing here, shimmer in AudioManager, and a
                      hang-time-scaled Big Air bonus through scoreAir.
                      Bones.jsx = 5 floating collectible bones (positions in
                      levelData BONES, solved against the measured launch
                      heights so each wants a specific line: qp1 coping ollie,
                      pumped halfpipe air, r1 grind, bowl deep-end air, the
                      stairA gap). One merged lathe+lobes geometry, ivory
                      MeshPhysicalMaterial with clearcoat and a pulsing warm
                      emissive held under the bloom threshold. Collection is a
                      1.1m sphere on the body centre (P.pos + 0.45); collect
                      pops the bone (overshoot, spin, rise, shrink), emits
                      'bone' (gold star burst + ring in Effects, arpeggio in
                      AudioManager), scores 500 (2500 + ALL BONES! on the 5th)
                      and ticks the HUD bone pill. bones.check.js asserts the
                      float band and spacing.
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
                      jump/bail, boing landings, per-surface paw patter and
                      rolling noise, glassy pentatonic shimmer on 'bigair'. There is deliberately NO dog voice — the
                      yip/whine generators and their four call sites were removed
                      by request; don't reintroduce barking on jump/trick/bail
                      or through a grind.
  player/
    PlayerController.js  movement, tricks, grinding. updatePlayer consumes the
                       sub-STEP accumulator remainder as one variable-size
                       step: whole 1/120 steps alone advanced the rendered
                       pose 1-3 steps per display frame (rAF beat against the
                       8.33ms grid), an 11cm-per-step stutter at speed with a
                       perfect frame rate. Safe because every response in
                       step() is rate-based and dt-scaled.
                       Scoring: a grind claims
                       its combo slot at lock-on and pays the score LIVE
                       (42 pts/s x the chain multiplier, flushed every 0.15s —
                       never per-frame store sets), settling the rounding
                       remainder at exit WITHOUT going through award(), which
                       would count the grind twice. The multiplier (x0.5 per
                       link) is for CHAINS, not landed tricks in a row: the
                       combo clock is CHAIN_GRACE (0.6s), only runs on the
                       ground, and mid-air / mid-grind you are still in a
                       trick — so links must connect land-and-pop fast, but a
                       long air or rail can't time the chain out.
                       scoring.check.js measures both rates on r1 and that
                       plain rolling drops the chain. Air tricks are on the
                       direction keys — left/right spin, back kickflips (the dog
                       IS the board, so its barrel roll is the flip). There is no
                       air *steering*: a slow AIR_TURN on the same stick just
                       fights the spin. Q/E/J still work as aliases. There is no
                       air *throttle* either — see the ramp section below.
                       A fresh grab press rolls a random style from
                       GRAB_STYLES (nose/tail/indy/method, never the same
                       twice running): Rider's grab_<style> poses pair with
                       Dog.jsx's GRABS reaction table by key and the trick UI
                       names each one. All four were measured against the real
                       skeletons (hand-to-target gaps 0.06-0.14) — don't
                       retune them by eye.
                       Ground carve is TURN_LOW/HIGH (heading rate) x GRIP (how
                       fast velocity chases it) — raising one without the other
                       reads as understeer. Concave creases (flat -> ramp base
                       and ramp foot -> flat) preserve speed through the ground
                       snap instead of projecting it away — a bare projection
                       ate 1 - cos(slope) of your speed in one frame each way,
                       which is what made straight ramps feel mushy. Hits
                       steeper than ~72 degrees still project (0.3 floor). Steering *against* the lean you hold
                       boosts both by `shift` (= -steer * P.lean, so a reversal
                       whips ~1.3x over the first 0.1s). It needs no timer:
                       P.lean already scales with speed and decays as you cross.
                       Landing clean (square within ~20deg, flip ridden out,
                       >0.3s of air) pays a momentum boost (CLEAN_BOOST +
                       airtime bonus, capped at 1.25x MAX_SPEED) — the pump
                       loop. steering.check.js asserts an ollie lands faster
                       than it took off. Landing in a transition (slope > 0.35)
                       moving OPPOSITE your facing auto-turns the heading to
                       the travel direction, easing the visual 180 through
                       spinResidual — without it a halfpipe session dies
                       against one wall with the throttle fighting the
                       roll-out. Flat fakie is untouched. ramps.check.js
                       asserts a throttled halfpipe session pumps wall to
                       wall. P.surfLift lifts the rendered rig by measured
                       path curvature (the rendered dog is ~1.6m nose to tail
                       and chords ~12cm deep into the 2.6m quarter — cap 0.12,
                       slow air decay); Player.jsx applies it along P.up. The
                       rig up-tracking is split: ground damp 26 / air 7 — a
                       quarter turns the normal ~60deg in its last metre, and
                       at the old damp 11 the rig lagged ~30deg, printing the
                       tail out the BACK face of the lip, where a quarter is
                       nearly zero thickness. Ramp lips are coping TUBES
                       hugging the top corner — the old 0.4-deep stone
                       RoundedBox jutted ~0.3 out of a quarter's near-vertical
                       face and the dog rode through it at every lip.
                       Colliders ignore lips on purpose, so any lip geometry
                       must protrude less than surfLift clears.
    boneRig.js        drives boy.glb's skeleton from angles authored for a
                      procedural rig — read it before touching any pose number
tools/                capture harness (see below)
public/boy.glb        the rider. 4.1MB draco (was 34MB), 490k verts, 41 joints, no clips
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

Poses: `plaza bowl hero props grove deck pipe`. `plaza` and `bowl` are framed to match
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
node src/game/level/rails.check.js         # rail/post clearance vs walls, props, solids, other rails; lip-edge grinds
node src/game/level/bones.check.js         # collectible bone float band + spacing
node src/game/level/ramps.check.js         # every ramp + stair enterable, climbable, qp1 pops vert, early pop transfers to deck
node src/game/level/collision.check.js     # ~40s: broad-phase coverage, wall penetration, ramp seams, drops, dt consistency, perimeter
node src/game/player/steering.check.js
node src/game/player/scoring.check.js      # live grind payout + combo multiplier chain
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
- **A ramp is not a box, and it is a hole in the deck it feeds.** Both halves of
  that shipped broken and between them nothing in the park could be ridden.
  `resolveCollision` tested a ramp by `max(y0, y1)`, so the entire footprint was
  a 1.6m wall at plaza height — rolling at bank1's low end ejected you **4.9m
  sideways**, and every ramp and stair in the park was impassable. Then, because
  qp1's coping sits 0.5m *inside* deckA's footprint and it is a quarter,
  deckA's face stopped you halfway up, and the moment `STEP_UP` could reach its
  1.6 top `sampleSurface` teleported you onto the deck and reprojected the
  climb away. Both are now the same rule, `rampTopAt()`: a ramp's footprint
  suppresses any FLAT no taller than the ramp's top, and the ramp itself is
  measured at the nearest point of its footprint rather than at its peak. Walls
  and the dividers flanking the transitions are taller, so they still block.
  (A "0.83m up where the deck starts" figure once quoted here was the
  arc-length bug below being measured, not level geometry.)
- **The ramp's arc length starts at the low edge the footprint kept.** The
  footprint grows by `RAMP_OVER` *uphill only* — centre shifted +RAMP_OVER/2,
  so the low edge stays at `lz = -hd` exactly and `s = lz + hd`. Subtracting
  `RAMP_OVER/2` again double-counted the shift and slid every transition's
  collision 0.5m uphill of its drawn mesh: qp1 read 0.825 where the coping
  tube is drawn at 1.6, and every ramp-to-deck seam hid a 0.1–0.78m trench
  that `STEP_UP` silently jumped (a 0.39m cliff at the halfpipe's "seamless"
  deck handoff). Nothing asserted mesh-vs-collider agreement, so it survived
  every ride-through test — the park was rideable, just 0.5m wrong.
- **The broad phase must be dilated by the query radius.** Colliders were
  bucketed by their raw AABB, and `bucket()` returns one cell — so a 0.5m
  circle standing just inside a cell boundary overlapped colliders only the
  NEXT cell knew about. 22 of 58 colliders were reachable from cells that
  never tested them; the pad2 skirt wall's face lands exactly ON a boundary
  (z=30, CELL 6) and let the full body embed 0.5m before the far cell ejected
  it in a one-frame snap-back. `GRID_PAD` (0.6 ≥ player RADIUS) on the
  bucketing bounds is the whole fix.
- **Ground adhesion must be geometric, or every deck edge is glue.** A real
  convex lip drops ~speed·dt per substep (0.11m at full speed); the old
  constant 1.5m tolerance also caught pad1 (1.2) and pad2 (0.9), so rolling
  off either snapped you to the plaza without one airborne frame and then
  side-ejected you 0.5m when the deck reclassified from floor to wall. The
  branch now uses `max(0.12, speed·dt·2)`. In the same family: air landing
  now samples with the same `feetY` the resolver used (a +0.4 offset opened a
  band where a planter's side was "not a wall" but its top was "a floor"),
  grind entry projects velocity onto the rail tangent (the 3D magnitude turned
  a 9 m/s fall into 9 m/s of rail speed), `doJump` zeroes the coyote window (a
  double-tap inside 0.13s stacked two jumps into a 5.2m ollie), and
  `slideAlongWall` only steers the heading on the ground (an air graze folded
  into the spin bookkeeping and failed clean landings you never mis-rode). Crossing a ramp's top, `gap` is ~0,
  so the ground-snap branch caught it and `reproject` deleted the entire
  vertical velocity — a quarter pipe returned you to the deck at walking pace.
  The test is the velocity's separation from the NEW normal (`sep`): on the ramp
  it is 0 (linear) or negative (concave), and only at the lip does it go
  positive. Past that, `launchOffLip()` rotates the exit toward vertical with
  the lip angle, conserving speed, and overshoots to a slightly NEGATIVE
  horizontal so a vert air re-enters the transition it left instead of clearing
  the flat overhang. Banks sit below `VERT_LO` and still launch you forward.
- **Wall response is rate-based, or the camera lurches.** `slideAlongWall`
  once cut speed 55% and snapped the heading 35-80% toward the tangent *per
  substep* — a head-on hit lost ~96% of its speed and whipped the rendered dog
  (yaw = P.heading) inside one frame, and the camera's look-ahead point
  (pos + vel·k) lurched with it. Both are dt-scaled now (bleed ~0.25s, turn
  6-14 rad-eq/s). Two traps in slowing it down: a near-dead head-on hit leaves
  no tangential velocity to choose a tangent from, and in an inside corner
  (pad1 SW, measured pinned 3.3s under throttle) the two faces' pure tangents
  each point into the other wall, so the heading oscillates in place while
  eject/refill nets zero movement. The turn target therefore blends the
  OUTWARD normal by `headOn` (glance → tangent slide, head-on → back away at
  ~45°), with a facing-based fallback below 0.05 m/s. collision.check.js's
  graze/stuck assertion covers it. The into-wall velocity component still
  vanishes in one substep (it must), so CameraController aims its look-ahead
  and speed-zoom off a ~0.2s-smoothed copy of P.vel, never the raw value.
- **An ollie at the coping was being eaten, and the fix has to live in
  `doJump`.** The launch branch sets state to `air`, so the usual
  `if (jumpBuffer && state === 'ground') doJump()` at the bottom of the step
  never ran and popping at the lip did literally nothing. That branch spends the
  jump itself now. But the press almost always lands a frame or two BELOW the
  lip, on the ordinary jump path — so `doJump` calls `launchOffLip()` too, or a
  pop a hair early takes the untouched tangent and sails onto the deck, which is
  the one thing the whole change exists to stop. Do not apply the redirect in
  both places; the second pass flips the horizontal back forward. The coyote
  jump in `stepAir` zeroes `P.slope` first, because you are jumping off nothing
  and a stale lip angle would redirect it. Flatground ollie is 1.28m and
  unchanged (`slope 0` -> the redirect returns immediately); off qp1's coping it
  is 3.9-6.0m above the coping depending on entry speed, versus 1.0-2.4m just
  rolling. `JUMP_V` is the knob if that is too much.
- **Free thrust is what made ramps feel wrong, twice.** Full `ACCEL` up a
  65-degree wall returned more energy than the climb cost — a 1.6m quarter threw
  you 3m over the coping for holding W — so ground drive now scales by `n.y`.
  And 4.5 m/s² of air throttle over a one-second vert air is 4.8 m/s, which
  exactly cancelled the drift back into the transition and put you on the deck
  every time. It is deleted, for the same reason there is no air steering.
- **bank1 was buried inside deckB** — a 0 -> 1.6 ramp sitting inside a slab
  already at 1.6. It drew nothing, and its only approach ran through 4m of solid
  deck. deckA is walled west and north with stairB + qp1 between two dividers on
  its south face, and deckB is a walled platform already fed by stairC and
  bank2, so there was nowhere to move it. Deleted. Before adding a transition,
  check it has a face AND a run-up.
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
- **The shadow fit plane is latched, not live.** Lighting.jsx fits the shadow
  box where the camera frustum crosses the plane at player height — fed by
  live `P.pos.y`, a high ollie moved that plane every airborne frame and each
  QUANT crossing remapped the whole shadow map (shadows visibly redrew
  mid-jump). `planeY` only updates when `P.state !== 'air'`.
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
