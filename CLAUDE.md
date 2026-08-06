# Skate Dog

React 19 + @react-three/fiber + three.js browser game. A boy rides a dachshund
through a pastel skatepark. Entirely procedural — no image files, no network
fetches. Textures painted into canvases at load, geometry built in code, props
and foliage baked into InstancedMeshes once and never touched.

Assets: `public/boy.glb` (rider, draco) and `public/dog_compressed.glb`
(draco + KTX2). Neither ships animation clips — both are driven every frame by
authored pose tables (`player/boneRig.js`). Both were decimated (meshopt ~0.2)
from Tripo's 1.02M verts, which was 42% of every frame's triangles. Redo after
any asset change:

```
gltf-transform simplify in.glb tmp.glb --ratio 0.2 --error 0.002
gltf-transform draco tmp.glb out.glb    # simplify decodes draco; must re-encode
```

Decoders live in `public/{draco,basis}` and the intro font in `public/fonts`
because drei/troika default to gstatic CDNs and nothing here touches the
network.

## Layout

```
src/game/
  palette.js        art-direction contract — C (albedo), M (roughness), LIGHT, TONE, RAMP
  photo.js          deterministic capture poses
  store.js          useGame = UI state; P = per-frame state (never React state)
  goals.js          the run's challenge table
  level/
    levelData.js    authored layout; renderer AND colliders read it
    rails.js        grind paths (drawn tubes + derived wall/planter/bench lips)
    decals.js       world-space floor detail quads over a texture atlas
    colliders.js    simplified collision built from levelData
    parkGeometry.js plaza / grass / ramp meshes
    bowlGeometry.js analytic bowl — the drawn surface IS the ridden surface
    textures.js     every procedural map: albedo, normal, roughness, baked AO
    foliage.js      plant generation, pure data -> instance rows
    levelEdits.js   editor contract shared by Editor.jsx and EditorPanel.jsx
  components/       Game, Lighting, Skatepark, Props, Player, Effects, UI, Editor
  audio/AudioManager.js   fully synthesised SFX, no files
  player/           PlayerController.js (movement/tricks/grinding), boneRig.js
tools/              capture harness
ref/                reference stills the art is measured against
```

## The palette is a contract

`palette.js` derives every value by decomposing the reference stills into
albedo x light. The load-bearing fact:

> A shadowed surface reads at (0.62, 0.62, 0.78) of its sunlit self. That solves
> to a **golden key** and a **cool violet ambient whose sum is neutral white**.
> The scene is warm-*painted*, not warm-*lit*.

- `C` is albedo under white light. Do not pre-warm it. **If a surface renders
  too orange, the light is wrong, not the paint.**
- Key + ambient ~= white, so a sunlit surface renders at roughly its albedo. An
  albedo must BE the reference's sunlit reading.
- Shadow tints come from `SHADOW_TRANSFER`, never a grey multiply.
- Sample `RAMP.*` for per-instance variation; HSL jitter reads as noise.
- `LIGHT.target` holds measured sRGB acceptance values.
- A key-dominant rig puts occluded surfaces near black and reads as "the AO
  pass is broken" even when it isn't.

## The run

A session is a **2:00 clock you extend by playing**: bone or completed
challenge +15s, bail −5s, zero puts up a scorecard. `RUN_TIME`/`TIME_BONUS`/
`TIME_BAIL` in store.js. A short base clock is the point. Scorecard PLAY AGAIN
is click-only — a run ends with keys held.

Level blobs may carry `rules: { time, goalIds, timeBonus, subtitle }`;
`setRunRules` syncs `P.timeLeft` + UI clock, `activeGoals()` is the single
filtered list every HUD count reads. Missing rules restore defaults. This is
what lets Dog Bowling be a real 30-second cans-only run.

- **The clock lives on `P.timeLeft`, not the store.** GameLoop mirrors it only
  when the whole second changes. `addTime()` writes both.
- **Every goal is detected from an event the controller already emits** — no
  goal owns a timer, collider or probe, or its measurement drifts from the
  scorer's. Rail Hound listens for the `'Long Grind'` name, Pool Party for
  `'Pool Gap'`, Off the Leash for `'bigair'`. Two score tiers poll at 4Hz.
- **`complete()` must be idempotent** and the guard belongs there — every
  predicate is on an event that legitimately repeats.
- **Grind payout does not go through `award()`** (it would double-count), so a
  grind challenge listens for `'trick'`.
- **`P.inBowl` is a SURFACE flag** and is false while airborne over the hole.
- Restart is three resets: `resetPlayer()`, `resetGoals()`, `restart()` — whose
  `runId` bump remounts Bones/Letters/Cans, and **a remount IS the reset** for
  their `useRef` "already got" flags.
- **The bowl is a hole with no side walls.** `resolveCollision` only pushes in
  x/z, so `clampToBowl()` runs after every integration in
  `step`/`stepAir`/`stepBail`. POSITION ONLY — zeroing `vel.y` there ate
  descent momentum and broke collision.check's dt agreement.
- `stepBail` floors the tumble at `surf.y + BAIL_CLEAR` (0.4) or half the dog
  rolls through the paving.
- There is no `lives`. Time is the one resource.
- **Personal best is local, per LEVEL, one writer.** `highScore.js` keys
  `skatedog.best` by level id; `endRun()` is the only writer; the start card
  reads once per mount. Zero best renders nothing. Every read is try/catch'd
  and `localStorage` is reached lazily (`ls()`) — node runs the checks without
  it. Cans progress persists separately under `skatedog.canBest`.

**HUD.** The challenge list lives in two places, both the same `GoalList`: a
briefing card on the start overlay and a `☰ n/8` pill that opens a sheet
mid-run. The in-play HUD is a ranked set, not three equal widgets: SCORE >
clock > menu. `--rim` is a hairline and pill shadows are contact shadows —
the loud versions read as a generic mobile-game chrome kit stuck over the park.
The clock is a rose sticker (hierarchy by colour, so two filled pills never
read as one row); `is-urgent` is a deeper rose, not a hue change. The menu is
never faded — a dimmed interactive control reads as disabled. The score icon is
a PAW, not a bone (the score is not a bone count). Esc TOGGLES the sheet, and
opening it sets `P.paused`, which gates the whole `g.started` branch in
GameLoop; the effect must clear it on UNMOUNT too. Under `(pointer: coarse)`
`.hud-pill`/`.hud-menu` redefine `--u` at 0.74 so the row fits ~390px while
`--edge` stays off the full unit.

**Start frame** is three independent claims on the frame — title centred, dog
middle-left, briefing card top-right — anchored separately, because the title
used to hang off `P.pos` and followed the dog offset off-screen. Intro.jsx
scales the title to 0.42 of frame WIDTH via `viewport.getCurrentViewport` (real
metres, so portrait works). `INTRO_SIDE` is metres at aspect 1, multiplied by
live aspect. One reveal clock (`P.intro`, 1 -> 0 over 1.5s) drives the camera
blend, the title dissolve and Player.jsx's rig slerp onto a camera-facing yaw.
The sim runs THROUGH the swoop, so the blend hands the real heading back as
intro decays. PHOTO mode pins `P.intro` to 0 and renders no title.

## Seeing your changes

**Do not eyeball it, and do not trust a diff.** `?shot=<pose>` freezes the sim,
parks the camera on an authored pose, pins the wind clock, flips
`window.__shotReady`.

```bash
node tools/shoot.mjs --tag mywork plaza bowl   # -> shots/mywork-{plaza,bowl}.png
node tools/px.mjs shots/mywork-bowl.png open,0.62,0.90,16
node tools/compare.mjs ref/ref-plaza.png shots/mywork-plaza.png out/ key.json
```

Poses: `plaza bowl hero props grove deck pipe bench lamp`. `plaza`/`bowl` match
the reference stills. `compare.mjs` builds a **blind** A/B sheet — judging your
own work against a labelled pair is worth little.

- Harness runs its own dev server on **3210**.
- `tools/chrome.mjs` excludes Chrome **148.x on purpose**: its headless shell
  never fires ResizeObserver, so R3F's Canvas never builds a renderer and the
  page renders nothing with no console error.
- `?ao=1` renders the AO buffer alone — a crushed histogram looks identical to
  a dead AO pass.

## Self-checks

Plain `node`, no framework. Run after touching what they cover.

```bash
node src/game/level/foliage.check.js      # crowns, branch coverage, colour space
node src/game/level/benches.check.js      # bench facing + footing
node src/game/level/rails.check.js        # rail/post clearance; samples the DRAWN curve
node src/game/level/bones.check.js        # float band/spacing, can clearance
node src/game/level/decals.check.js       # on flat plaza, in bounds, inside the atlas gutter
node src/game/level/levelEdits.check.js   # commits reach colliders+paths, undo unwinds, save round-trips
node src/game/goals.check.js              # each challenge pays once; predicates discriminate
node src/game/level/ramps.check.js        # every ramp/stair enterable, climbable, qp1 pops vert
node src/game/level/collision.check.js    # ~40s: broad phase, penetration, seams, dt consistency
node src/game/input.check.js              # touch stick converges on the stick angle
node src/game/player/steering.check.js
node src/game/player/scoring.check.js     # live grind payout + combo chain
node src/game/player/boneRig.check.js     # rider joint angles, in world space
node src/game/components/shadowfit.check.js
node src/game/components/clearCoat.check.js
node src/game/components/recolor.check.js
```

`boneRig.check.js` rebuilds boy.glb's skeleton from the glTF node tree (no
loader, no DOM) and runs Rider.jsx's call sequence, measuring in world space —
the only thing standing between a sign error and a knee that bends sideways.

`foliage.check.js` carries two assertions worth knowing before tuning plant
tables: a **grain** check (a clump under 32% of its mass, `n * ratio^2` over
0.9) and a bed **coverage** check demanding 82%+ closed — deliberately not
solid, since the reference's bed shows soil-dark gaps and a solid bed is one
you cannot count a plant in. When you add a visual invariant, add the
assertion: "leaf near the tip" passed while every branch was bare.

## Sim / player

`updatePlayer` consumes the substep accumulator remainder as one variable-size
step — whole 1/120 steps alone stuttered 11cm per step at speed. Safe because
every response in `step()` is rate-based and dt-scaled.

- **Scoring.** `airTrick()` is the one table of what an air is worth; stepAir
  flushes it to the tape every 0.1s and scoreAir reads the same function at
  landing, so the popup can never name a trick the landing doesn't pay. Air
  points bank at landing; grind points pay LIVE (42 pts/s x chain multiplier,
  flushed every 0.15s, remainder settled at exit without `award()`). The
  multiplier is for CHAINS: `CHAIN_GRACE` 0.6s, ground only, so links must
  connect fast but a long air or rail can't time out. Pool Gap (+400) needs all
  three of leave-clear, k<0.7, land-clear — any two alone pays for an air you
  didn't fly.
- **Air tricks are on the direction keys** (left/right spin, back kickflip —
  the dog IS the board). There is no air steering and no air throttle: 4.5 m/s²
  over a one-second vert air exactly cancelled the drift back into the
  transition. A fresh grab press rolls a random `GRAB_STYLES` entry, never the
  same twice; the four poses were measured against the real skeletons.
- **Carve** is TURN_LOW/HIGH x GRIP — raising one alone reads as understeer.
  Steering against your held lean boosts both by `shift` (= -steer * P.lean),
  needing no timer. Concave creases preserve speed through the ground snap;
  a bare projection ate 1 - cos(slope) each way and made ramps mushy.
- **Clean landing pays momentum** (CLEAN_BOOST + airtime bonus, capped 1.25x
  MAX_SPEED) — the pump loop. steering.check asserts an ollie lands faster.
- **Two halfpipe aids.** PUMP is gated on `surf.curv` (nonzero only on a
  quarter's arc), applied along TRAVEL, fading to zero at MAX_SPEED — a pump is
  what riding a transition IS, and it's not on the throttle. ALIGN eases the
  heading onto the fall line when steer is exactly zero, off a `PIPE_HOLD` 0.9s
  timer (not the live slope) so the assist carries across the flat. The bowl is
  excluded on purpose — it wants carving lines. `resetPlayer` clears the hold.
- **Landing in a transition moving opposite your facing auto-turns**, gated on
  facing UPHILL and aiming at downhill = +(nx,nz). Without it a halfpipe
  session dies against one wall; negating it also killed it. Flat fakie is
  untouched.
- `P.surfLift` lifts the rendered rig by analytic path curvature (`out.curv`
  from sampleSurface, cap 0.12). Rig up-tracking is split: ground damp 26 / air
  7, because a quarter turns the normal ~60deg in its last metre. Ramp lips are
  coping TUBES hugging the corner — colliders ignore lips, so any lip geometry
  must protrude less than surfLift clears.

**Mobile.** `input.js`'s `TOUCH` flag pins quality 'low' (PerformanceManager
never inclines it — a mid-play flip rebuilds the composer), disables N8AO,
shadow map 1024, dpr [0.75, 1.5], camera zoom 0.9, MAX_SPEED/ACCEL x0.7. The
left stick is WORLD-directional on the ground (the chase camera never rotates,
so screen axes are one fixed world basis); `applyTouchStick` derives steer from
heading error every SUBSTEP with the live heading, or a held stick stops
steering as the dog turns. Response saturates at 55% deflection. In the air the
raw axes are the trick pad. The shoot harness is desktop headless and sees none
of this.

## The level editor (`?edit` or `/edit`)

`?edit` makes the editor AVAILABLE; `useEditor`'s `editing` flag says which
half you are in. While editing the chase rig is swapped for an orbit camera and
the sim is paused before `sampleInput` (a live sim steers the dog off the same
W/E the gizmo uses). `levelEdits.js` is the contract both halves share.

**The model is blunt on purpose: the editor mutates `levelData`'s exported
arrays in place.** The level IS the document. Downstream is either a pure
function of those arrays (Skatepark/Props geometry, content-keyed per table so
one placement doesn't rebuild every GPU object) or a module-load snapshot
(`colliders.js`'s `cols` + grid, `rails.js`'s `PATHS`) — those got
`rebuildColliders()`/`rebuildPaths()`, which refill the **same arrays in
place**, because PlayerController holds them by reference. `bumpLevel()` calls
both. Without this the editor is visual-only.

- **A TOOL IS NOT A TABLE.** `TOOLS` is the one palette both halves read —
  labels, tints, 1..9 bindings and the ghost footprint. A tool carries a
  `patch`; SOLIDS is four tools behind one `kind` field. `DEFAULTS.SOLIDS`
  therefore carries no `top`/`style` (heal()'s KIND table fills what the kind
  requires) and `addRow` renames the row after the TOOL.
- **A tool can be a GROUP, and a group is ONE object.** The halfpipe tool
  carries five row specs offset along local +Z; `addRow` places them in one
  begin/commit under a shared `grp` stamp. `moveGroup`/`rotateGroup` live in
  levelEdits so the gizmo, the panel and the node check share one
  implementation. Translate write-back is a DELTA — the only form a mate can
  consume. Width/height/length are group properties;
  `dimensionValue`/`applyBlob` normalize old split saves. Duplicate copies the
  whole group under a fresh stamp; delete takes it all.
- **The ghost's red state is authoritative.** `placementInfo()` is a pure query
  returning `{ warn, matchTop, block }`; every `warn` also sets `block`, so the
  UI never says invalid then places it anyway. Covers burial (per `rampTopAt`),
  a blocked run-up, a footprint in the pool, and `matchTop` (the vertical twin
  of the flush-face snap). Floaters never reach the test. `ghostShapes()` gives
  real silhouettes and the geometry set is DISPOSED on tool switch.
- **A quarter's rise can never outgrow its run.** Past h = d the arc puts the
  drawn top below y1 while coping and collider stay at y1. `heal()` grows `d`
  on every quarter-curve write.
- **Size steppers are per-AXIS.** "Bigger" is three different wishes and a
  uniform scale grants none. Each axis reads whichever field the row carries
  (`top`/`h`/`y1`); `y1` is floored against `y0`.
- **A rail has no fields to step**, so `railLength`/`extendRail`/`turnRail`/
  `liftRail` mutate `pts` in place. Extend pushes the last point along the
  final segment (which is what "longer" means on a curve) and floors it at
  0.5m. The check asserts the extension is GRINDABLE, not just longer.
- **Walls and rails bend differently because they ARE different.** `bendRail`
  resamples to 5 points and yaws each segment, recentring on the old centroid,
  so Bend and Length stay independent. A wall is a BOX, so `bend` is expanded
  by `wallSegments()` into overlapping chords (overlap 0.25 so joints don't
  open; chords take NO end trim in `lipEdges` or a bent wall stops being
  grindable). `bend` 0 returns the row itself, so the shipped park is
  byte-identical. Pick proxy and footprint still use the straight box.
- **Snapping is grid PLUS flush faces, and the object snap wins** — the grid is
  always within half a cell, so a distance contest means the flush snap never
  wins. Rotated rows are skipped as sources; only axes the handle actually
  moved are snapped; `translationSnap` is unset because TC rounds relative to
  the drag start. Lines are built once per drag.
- **Materials are swatches, not dropdowns.** `LOOKS` maps each table's
  material-ish field to colour chips; it is a FUNCTION of the row because
  SOLIDS' options hang off `kind`. Swatch hexes are hardcoded mirrors of
  `C.*` so the module stays node-loadable.
- **Scene settings are editable too.** `useSceneSettings` holds
  `{ time, ground, pattern }` with preset tables `TIMES`/`GROUNDS`/`PATTERNS`.
  **The defaults ARE the shipped art:** `sunset` carries no overrides and
  `classic` tints white, so a plain visit and the shoot harness render
  byte-identical. Ground tint multiplies BOTH plaza materials plus coordinated
  stone/wood/grass multipliers. Pattern swaps `map`/`normalMap` via
  `plazaMapFor`/`plazaNormalFor` — no `needsUpdate`, since both slots are
  always occupied. This all lives in a Plaza `useLayoutEffect` and Lighting
  subscribes directly, so a settings click never rebuilds the park. The
  `Environment` is keyed on the time preset id because `frames={1}` bakes once
  per mount. The sun DIRECTION deliberately doesn't move — `SUN`/`LIGHT_BASIS`
  are what the shadow fit and shader cookie are built on.
- **The pool is editable and independent.** `BOWL` isn't a table row, so it
  gets `setBowl(patch)` and its own selection slot (`bowlSel`). It is a real
  placement tool and owns no wall or bench rows.
- **Everything is a proxy layer**, one pickable box per row in a sibling group
  of Skatepark's root. Idle proxies are `opacity 0`, not faint — ~90 at 0.06
  hazed the frame white. The `<Grid>` sits at y = −0.02, UNDER the plaza, for
  the same reason.
- **Adding is click-to-place, and while a table is armed nothing else
  raycasts** — proxies take `raycast = () => null` and the gizmo unmounts, or
  an opacity-0 box eats the placement click. The ghost is mutated directly
  (pointer rate). `select()` clears `add`, so the placement path selects
  through `set()`.
- **SPAWN is gizmo-able but is not a row** — its selection lives in Editor.jsx's
  `spawnSel` and stays in sync by SUBSCRIBING to the store, not by an effect on
  `row`. Drag-end writes `SPAWN.x/z` and calls `commit()`, not `setSpawn()`
  (which opens its own `begin()` — two snapshots is two undos for one drag).
- **Undo is whole-level snapshots**, not a command log. `restore()` replaces
  row objects wholesale, so gizmo and panel re-resolve the selection by `__k`.
- **`__k`** is a stable per-row editor key: several tables carry no `id`, and
  array indices break identity on the first delete. Inspector inputs are keyed
  on `__k` AND the version, or React reuses instances across a selection change
  and shows the previous row's drafts. Fields commit on blur/Enter.
- **`derived: true`** marks rows recomputed from another (the handrails);
  `editable()` filters them out. TREES/SHRUBS aren't tables at all.
- **Rotate is gated per table** (rows with a `rot`), and there is no scale
  gizmo. The Y translate handle is gated the same way (`SHOW_Y` =
  BONES/LETTERS/RAILS) — a handle that does nothing reads as broken.
  **R turns what you are HOLDING** (`addRot`, sticky across placements); RAILS
  has no `rot`, so R rotates its `pts`. With nothing armed R is gizmo rotate.
- **`TransformControls` needs `makeDefault` on `OrbitControls`** or they fight.
  Write-back happens once on `dragging-changed` false.
- **A row built outside levelData's `box()`/`wall()` factories arrives without
  `rot`/`base`, and nothing downstream defaults them.** `Math.cos(undefined)`
  is NaN, `l < 1e-4` is false for NaN so the segment was kept with a NaN
  tangent, and `d2 < best.d2` is likewise false so `findGrind` dereferenced
  null and the sim died anywhere near a new wall. Three fixes, all needed:
  `DEFAULTS` carry every field their consumers read, `heal()` refills on load
  and on a kind/style switch, and both tests are NaN-safe (`!(l > 1e-4)`,
  `if (!hit.tan) continue`).
- **Edits survive a refresh.** `saveLevel()` runs from `bumpLevel()`,
  undebounced (commits only fire on drag-end or blur). `loadLevel()` runs once
  at import in a try/catch — a corrupt blob falls back silently rather than
  taking the canvas down. Restored rows must be re-stamped by `keyOf()`.
  `SHIPPED` is a deep snapshot taken BEFORE the load and JSON round-tripped on
  each restore.
- **Named user levels are a second store.** `skatedog.levels` holds
  `{ id, name, at, thumb, data }`; the start card lists them as file tiles and
  `/?level=<id>` plays one via `applyBlob` after `SHIPPED` is snapped. Playing
  or building from home is a full navigation on purpose — `EDIT`, `loadLevel`
  and the music duck all run at import. `thumbCapture` renders a fresh frame
  first (preserveDrawingBuffer is off) and retries without the thumb on quota.
- **CHALLENGES vs MY LEVELS** are two collections in one panel shell.
  **Dog Bowling** (`dog-bowling`) is a protected shipped mode, not in
  localStorage: empty plaza, 151 cans in 3x3 bundles on four serpentine
  straights, 30s, cans only, zero bonus. `activeGoals()` derives the hint from
  live `CANS.length`. Its dog is 2.4 (the boy stays 1.58) so the dog alone
  reads as the bowling ball without bypassing the size-aware code. In cans-only
  mode the score pill becomes a live can count and the end card reports cans
  smashed; the last can ends the run immediately. Saved and built-in end cards
  offer GO HOME; the shipped park omits it.
- **`setEditing(on)` is the whole build->play->build transition** —
  `bumpLevel()`, `resetPlayer()`, `resetGoals()`, `restart()`,
  `started: true`, `P.paused = false`, `P.intro = 0`. Spreading those six
  across callers is how one gets forgotten. The Esc listener is CAPTURE-phase
  with `stopPropagation` so GameUI's own Esc doesn't also fire.
- **`clearAll()` gives a blank canvas.** BOWL isn't a row, so it gets `BOWL.on`,
  checked in exactly three places: `sampleSurface`, the plaza cutout, and
  `<Bowl/>`. `BowlProbe` stays mounted either way — it bakes the reflection the
  coping and rail materials read and `Warmup` blocks on its ready signal.
- **The plaza's baked AO is refreshed for play-test.** `parkAOMap` is the one
  map not cached forever; commits refill `AO_FOOTPRINTS` and defer the bake,
  and entering play-test invalidates once.
- **Fog drops while editing** (FOG_NEAR 22 hazes exactly where you place
  things). **Held SPACE is the hand** — swaps OrbitControls' left button to
  PAN rather than adding a camera path; `groundDown` returns early while held;
  keyup is its own listener and `blur` clears it (alt-tab never delivers keyup).
- **The soundtrack ducks to 30% while editing** — duck, not pause, and a
  separate factor from `muted`. Called from `setEditing` and once at import.
- **The editor is DESKTOP ONLY**, gated on `(pointer: coarse)` being false,
  inlined in levelEdits.js rather than imported from input.js because the node
  checks pull this file in and it must stay game-module-free.
- **Export is the CLIPBOARD, not codegen** — levelData rows carry derived
  expressions a round-tripper would flatten.
- **The saved level is the editor's workbench, not the game.** `loadLevel()`
  runs at import only under `?edit`, so a plain visit is always the shipped
  park. Going to PLAY still carries the edits.
- The panel is playful but not childish: cream card, colour-coded tool tiles,
  one loud PLAY, plain copy. Three questions in order — WHAT (palette), WHERE
  (one hint line), IS IT RIGHT (steppers). Numbers hide in `<details>` drawers.
  The hint line always says the next ACTION. Only the middle strip scrolls.
  Armed tools read as LIFTED, not recoloured (the tint is how you identify the
  tool). Two CSS traps: `.ed-panel button` sets a `font:` SHORTHAND, so a bare
  `.ed-play { font-family }` loses on specificity; and `--e` is the panel's own
  unit, deliberately not the HUD's viewport-scaled `--u`.

Nothing in the editor touches `?shot=` or the node checks.

## Level content notes

- **hpN/hpS are a halfpipe** on a raised 0.35 `hpDeck` platform: two facing
  quarters, `HP_FLAT` 3.2m, `HP_H` 2.0 walls (a 2.4m run puts the lip at
  ~80deg; h == run is dead vertical and the arc degenerates). All z hangs off
  centre 24.5. All four boxes are style `'solid'` — a pale blue riding sheet
  over birch plywood — at width 12; at the old w:9 masonry it read as a walled
  courtyard. `SolidSlab` uses `texBox`, not `RoundedBox`, whose extruded-shape
  UVs put the flat's planks 90deg off the riding direction. `hpDeckN/S` are top
  decks behind the coping: a freestanding quarter is zero-thickness at its lip
  and a slow crest straddled it. Keep the run-in clear — nothing goes in the
  pipe's corner.
- **deckA's north/east and deckB's east walls are THICK (3m) on purpose**, flush
  to the kerb; at 1.2 they left a blind alley you got stuck in. Inner faces are
  unmoved. A collider face at the play edge puts probes OUTSIDE the clamp, so
  collision.check skips those (`inPlay`).
- **The plaza centre was deliberately opened up** — ledge2/ledge3 and two mid
  planters are gone. Don't refill the middle with props. Perimeter ring
  ellipses dip inside the play area at corners; `HP_CLEAR` keeps them out of the
  halfpipe and TREES drops any ring tree inside PERIMETER (trees live in the
  ring or a planter bed; shrubs may dip in).
- **bank1 was buried inside deckB** and deleted — before adding a transition,
  check it has a face AND a run-up.
- **Every wall cap, planter rim and bench seat is a grind path** (78 of them),
  derived in rails.js from the same boxes. Both top EDGES of a cap, not the
  centreline — you grind a lip with the dog hanging over the face. Offsets are
  measured off the DRAWN stone, and a wall cap's top is `w.h` absolutely
  (`base` does not add). Planter rims are four separate runs, not a loop (a
  loop snaps the heading 90deg at each corner). A bench is ONE run along the
  FRONT edge — the back edge sits under the backrest slats — trimmed only 0.15
  a side. Nothing new is drawn; findGrind's dy window (0.75 up / 0.45 down) is
  what stops a cap overhead from grabbing you.
- **A handrail doesn't know what it's standing in.** Three ran through walls at
  the old `w/2 + 0.5`; the other two were buried in the staircase's own drawn
  stringer (which is not a WALLS row, so the check had nothing to test). Default
  is `w/2 - 0.7` now and rails.check walks the drawn catmull-rom at 10cm.
- **Bones** (5) are solved against measured launch heights so each wants a
  specific line. Collection is a 1.1m sphere on `P.pos + 0.45`. It exports R2
  and POP because Letters.jsx collects on exactly those.
- **Letters** (D-O-G, S-K-A-T-E) are BILLBOARDED troika text, not spun — a
  glyph is a single-sided quad and reading which one you need is the objective.
  Hidden until `started` via a `visible` toggle, NOT an unmount (troika builds
  its SDF asynchronously). Parked on the three transitions the bones don't use.
- **Cans** are NOT colliders — you ride through and they burst. The hit is a
  horizontal circle gated on the FEET being in the can's height band, or a big
  air over the top. The dot field is an alphaMap (alphaTest, not transparent),
  not geometry. Two z-fights paid for: parts lifted 8mm off the paving, and the
  drum's bottom cap recessed 2.5cm into the foot ring (`FOOT_IN`) — everything
  above the foot offsets with it, LID_Y included. The wreck is ballistic, not
  physics, and never asks the level a question after the first frame (Skatepark
  turns off `matrixWorldAutoUpdate`); its height floor is the body's
  half-DIAGONAL. It emits `'smash'`, and AudioManager clangs an INHARMONIC drum
  — equal-tempered partials read as a bell, and a bell reads as a reward.
- **Floor decals are NOT baked into plazaMap** — the plaza map tiles every 8m,
  so a painted drain is ~120 drains on a grid. They are world-space quads over
  a 4x4 `decalAtlas` with a transparent GUTTER (mipping bleeds neighbours),
  merged into ONE geometry (~350 tris; instancing an atlas needs a per-instance
  uv attribute and buys nothing here). Per-decal fade rides vertex ALPHA —
  scaling RGB renders a faint chalk mark as a DARK one. Placement is
  `groundHeightAt` and nothing else; two things that shipped broken: the
  footprint is sampled as a 0.35m GRID, not four corners, and the perimeter
  test adds the quad's HALF-DIAGONAL. Cluster centres reroll until they land on
  open floor. Skatepark sits the mesh 6mm up, transparent with depthWrite off —
  not alphaTest, which stencils a hard edge onto every chalk line. The marks are
  drawn CUTE on purpose (heart paw pads, daisy weeds, a dachshund face) with
  intricacy that survives the fade.
- **Lamps** (`lampModel.js`) are procedural from a reference still. `lampParts()`
  is the part list Props instances; `createLampPostModel()` is preview-only (a
  Group per lamp is 9x the draw calls). Flat-shaded hex vs smooth turned parts
  is the whole material split; mullions sit ON hex corners with a composed YXZ
  yaw-then-tilt (the XYZ approximation read as BENT). Each lamp emits one
  shadowless PointLight, gated on TOUCH, **not on quality** — quality starts low
  and inclines, which would pop lights mid-run and hide them from the harness.

## Characters

- **The dog's fit is measured, not typed.** `Box3.setFromObject` on a
  SkinnedMesh returns skinned rest bounds; the raw position attribute is
  quantized and pre-skinning. The dog is authored nose at +X and yawed -90, so
  a bone delta swings fore/aft about **Z**, an ear about X, the tail about Y.
  `BACK_Y` (0.355) is where the rider's feet go.
- `dogFit.js` holds the shared numbers because a component file may not export
  shared state under react-refresh. `useCharacterSize` is the one reactive
  source both the editor panel and Player subscribe to; it must NOT call
  `bumpLevel()`. Dog and boy sizes are independent — cohesion comes from the
  planted-foot mount (`backY()`) and size-aware trick offsets, never a forced
  ratio. Shortening legs raises paws off the bind floor, so `LEG_DROP` comes out
  of both the model lift and `backY()`.
- **An imported bone does not rest at identity.** boy.glb's `L_Thigh` rests near
  180deg about Y, so a raw Euler swings the leg sideways. Angles go on as
  world-space deltas conjugated into the rest frame (`setBone`).
- **The bind pose is not the pose the numbers mean.** Tripo shipped a relaxed
  A-pose (right knee flexed 0.31, shin splayed 0.18, legs 17% different).
  `alignBone` bakes a per-bone correction so zero is straight down on both
  sides. Leg length can't be corrected the same way — pelvis height uses the
  mean, floating one foot ~1.5cm.
- **The rider's crouch is MIRRORED across the pair** so both legs drop the same
  amount; `body.position.y` takes the mean, so an asymmetric crouch floats one
  foot. `recolor.js` hue-rotates his shirt/sleeves +168deg to teal and shoes
  -28deg — a `material.color` tint can't do it (orange x blue is grey).
  Garments are picked by `map.name`; the rotation preserves chroma and
  lightness so Tripo's bake survives.
- **The dog's GLB carries one KTX2 baseColor map and no normal/rough**, and
  KTX2 pixels never reach the CPU, so the hue-rotate trick isn't available.
  The coat gets procedural `dogNormal`/`dogRough` plus `coatShader`, an
  onBeforeCompile: hue via Rodrigues about the grey axis (leaves luma),
  saturation 1.4, contrast 1.14 about a **0.2 LINEAR** pivot (sRGB's 0.5 crushes
  it to black), and a violet-sky rim (fresnel^3) that separates the silhouette
  from the warm plaza. All three knobs live in one module-scope `COAT_ADJ`
  uniform object shared with the "Dog coat" leva folder — its own folder,
  because the clash is two useControls on the same PATH. No roughness slider:
  assigning `mat.roughness` is a write to a useMemo return value.
- **Carving bends the whole body** — rear legs hang off tripoRoot and the entire
  front half off tripoSpine_0, so yawing spine + chest swings shoulders, front
  legs and head into the turn while the hips hold heading. Split 0.8/1.2, with
  `lag` whipping a reversal. LONG stretches x outside these bones, flattening
  the apparent yaw, so a longer dog needs a bigger bend.
- **Ears, tail and tongue trail a carve off one `lag` signal** (how far P.lean
  ran ahead of a damped copy). Ear springs are ALSO kicked by rig acceleration
  (P.vel differenced), clamped to ±60 — a landing kills 9 m/s in one substep, so
  the raw number is in the hundreds and the clamp makes it an impulse (it also
  swallows a respawn teleport). `wiggle`/WiggleBone was passed over: these bones
  carry authored motion a solver would own.
- **The tongue is a capsule** authored at the bind-pose mouth then `attach`ed
  (not `add`ed) to the skull bone, so the offset, lay-forward rotation, the
  bone's non-identity rest frame and its HEAD scale all carry over. Two nested
  groups: outer is the mount, inner is free for the frame loop.
- `clearCoat.js` is **RIDER ONLY** — a coated dog reads as wet plastic.
  `MeshPhysicalMaterial.copy` cannot read a standard material (it lands every
  physical param as `undefined`), so it borrows
  `MeshStandardMaterial.prototype.copy` and puts the `PHYSICAL` define back.
  `USE_CLEARCOAT` is a define keyed on `clearcoat > 0`, and the renderer only
  re-picks a program when the material version moves.
- There is deliberately **no dog voice** — the yip/whine generators were removed
  by request. Don't reintroduce barking.

## Collision

- **A ramp is not a box, and it is a hole in the deck it feeds.** Testing a ramp
  by `max(y0, y1)` made its whole footprint a wall — rolling at bank1's low end
  ejected you 4.9m sideways. Both halves are one rule now, `rampTopAt()`: a
  ramp's footprint suppresses any FLAT no taller than the ramp's top, and the
  ramp is measured at the nearest point of its footprint, not its peak.
- **The ramp's arc length starts at the low edge the footprint kept.** The
  footprint grows by `RAMP_OVER` uphill only, so `s = lz + hd`. Subtracting
  `RAMP_OVER/2` again slid every transition 0.5m uphill of its drawn mesh and
  hid 0.1–0.78m trenches that STEP_UP silently jumped. Nothing asserted
  mesh-vs-collider agreement, so it survived every ride-through test.
- **The broad phase must be dilated by the query radius.** Colliders bucketed by
  raw AABB left 22 of 58 unreachable from cells that never tested them.
  `GRID_PAD` (0.6 >= player RADIUS) on the bucketing bounds is the fix.
- **Ground adhesion must be geometric.** A real convex lip drops ~speed·dt per
  substep; the old constant 1.5m glued you to every deck edge. The branch uses
  `max(0.12, speed·dt·2)`. Same family: air landing samples with the same
  `feetY` the resolver used, grind entry projects velocity onto the rail tangent
  (the 3D magnitude turned a 9 m/s fall into 9 m/s of rail speed), `doJump`
  zeroes the coyote window (a double-tap inside 0.13s stacked a 5.2m ollie), and
  `slideAlongWall` only steers the heading on the ground.
- **Crossing a ramp's top, `gap` is ~0**, so the ground-snap branch caught it
  and `reproject` deleted the vertical velocity — a quarter returned you to the
  deck at walking pace. The test is the velocity's separation from the NEW
  normal (`sep`), positive only at the lip. Past that `launchOffLip()` rotates
  the exit toward vertical, conserving speed, overshooting to a slightly
  NEGATIVE horizontal so a vert air re-enters the transition. Banks sit below
  `VERT_LO` and still launch forward.
- **An ollie at the coping was being eaten.** The launch branch sets state to
  `air`, so the usual `if (jumpBuffer && state === 'ground')` never ran. That
  branch spends the jump itself now, AND `doJump` calls `launchOffLip()` too,
  because the press usually lands a frame below the lip. Do not apply the
  redirect in both paths — the second flips the horizontal forward. The coyote
  jump zeroes `P.slope` first. Flatground ollie is 1.28m and unchanged.
- **A wall cap is landable, never steppable.** Caps take `CAP_STEP`, split by
  where the body is: 0.3 inside the footprint (a landing frame sinks ~0.12m
  before stepAir's land check fires) but ~0 outside (pressing into the FACE is
  always a wall; a flat band let depth accumulate and eject in one 0.32m lurch).
  Solid caps also created corner pockets, so the resolver runs 8 passes with an
  early break.
- **Wall response is rate-based, or the camera lurches.** Bleed ~0.25s, turn
  6-14 rad-eq/s. Two traps: a near-dead head-on hit has no tangential velocity
  to pick a tangent from, and in an inside corner each face's tangent points
  into the other wall. The turn target blends the OUTWARD normal by `headOn`,
  with a facing-based fallback below 0.05 m/s. The into-wall component still
  vanishes in one substep, so CameraController aims off a ~0.2s-smoothed copy
  of P.vel, never the raw value.
- **Free thrust made ramps feel wrong twice.** Ground drive scales by `n.y` (a
  1.6m quarter threw you 3m over the coping for holding W), and air throttle is
  deleted.
- **A downhill must pay gravity visibly.** The tangent gravity term scales by
  `SLOPE_GRAVITY` while grounded and rolling resistance scales with `n.y` —
  full flatground `ROLL_DRAG` on a vertical wall erased the descent's gain.
- **The shadow fit plane is latched, not live.** `planeY` only updates when
  `P.state !== 'air'`, or every airborne frame remaps the whole shadow map.

## Foliage

- **A foliage instance is a LEAF BLADE, not a ball.** `leafBlade` is a succulent
  paddle along +Y, 7 stations x a 6-point ring (72 tris, both ends pinch so no
  caps). The ring is 6 because a 4-gon section is a rhombus with a hard crease
  down its spine that smooth normals only turn into a specular LINE; it is also
  PHASED half a step (`RING_PHASE`) so a vertex lands on the crest instead of a
  flat facet running the whole length, and `RING_K` divides cos(30) back out.
  PROFILE is a true lanceolate — 35% of max at the base, crest at 45%, long
  taper to a real point; the old parallel-sided capsule rendered as bottlebrush.
  Broad and fleshy is measured: 2.18:1 at max width, 3.28:1 mean. Do NOT narrow
  W to fix a fat bed — that's a profile problem. T matters MORE than W, because
  the roll slot is 0 so half of any rosette presents its SECTION to the camera.
- **Trees use a SECOND geometry** (`CROWN_LEAF`, W 0.32 / L 2.55 / T 0.26, 5
  stations x 4-ring = 32 tris) sharing the material — one extra draw call, not a
  second wind program. Its lanceolate point IS the read; the pad's rounded cap
  at 3.2:1 read as a green jellybean on a stick. **Do not unify the two blades.**
  Thin costs coverage (bare fraction goes as exp(-n·w·l·r²)), so 0.53x width was
  paid back with massClumps x1.61 + clumpR x1.08. Then a perf trim ran the same
  trade backwards across all species (massClumps x0.72, clumpR x1.18, n·r² =
  1.002): 122k crown rows at 60 tris was 7.3M triangles. Park total 9.1M ->
  4.6M in the same two draw calls. Every species' `bloom.per` is per LEAF ROW,
  so all three divide by 0.72. clumpR is now 1.27x its pre-thinning value — if
  crowns read as faceted boulders again, that's the number.
- **A clump is AIMED.** `clump()` takes the outward vector of its mass and
  writes the same two slots a branch uses. Slot 8 (roll) stays 0 because bake()
  reads YXZ and applies Z FIRST, so a roll swings the blade off the aim.
  Per-leaf variety is a jitter cone, ramping DOWN at the rim (0.34 -> 0.24) —
  the cone is the only thing that can throw a blade past the envelope.
- **A canopy mass is NOT aimed outward** — a radial blade presents its TIP and a
  dome of those is a pin-cushion. `leafMass` swings the aim 55-70deg into a
  tangent frame with a downward hang that RAMPS with `edge` (0.26 middle, 0.88
  rim); a flat 0.26 left the rim a horizontal fringe with no drop. The
  underside easing knee moved to -0.75 with it — foliage.check's crown floor
  reads centre and radius and cannot see an aim, so that knee is the only thing
  keeping the skirt off the ground. A tangential blade covers far less solid
  angle, so massClumps went up half again and clumpR down 0.84x.
- **A bed is COUNTABLE ROSETTES on a JITTERED GRID**, and the grid is the point
  — a Poisson scatter fused a third of the stars. Pitch is `gap` 2.9 x plan
  reach, PAST the 1.41 a square grid closes at. **The bed is not supposed to
  close**: target ~92% mean / 87% worst; measured gap 2.0 -> 99.9%, 2.9 -> 91.6,
  3.2 -> 89.2. Jitter is ±9%. 10 blades leave one shared centre (OFF_R 0.14 —
  at 0.4 the rosette had a hole where its centre should be), splayed 45-75deg.
  The FINE layer is thin (1.35): its job is stopping soil showing THROUGH a
  plant, not filling the space between two. The height ramp is tuned for RANGE
  at fixed mean (0.20 + 0.58q). foliage.check models a blade as a plan CAPSULE
  — the old single-number disc broke twice; don't reintroduce it.
- **Every species has a `core`** — one leafMass over the crown's centre, because
  a crown is a DOME and every other mass hangs off a branch, leaving the cone
  over the fork open to the 40deg camera. Branch-tip masses are pulled 12% back
  down the shaft (`TIP_IN`) or their outer clumps read as detached specks.
- **A planter tree is `pushTree(..., 'blossom')` BY NAME** — the random draw
  took a lawn species two thirds of the time and a 3m trunk in a 1.4m planter
  reads as a cone on a pole.
- **Flowers.** White and pink are 5-petal `daisy` with a YELLOW EYE, which is
  most of what separates a daisy from a blob of cream at distance. The pip rides
  a vertex-colour attribute carrying the ratio flowerYellow/flowerWhite taken
  against WHITE, so `MAT.flowerWhite/Pink` need `vertexColors: true` and the
  yellow bucket must NOT. YELLOW is not a daisy: it's `budCluster`, four
  two-thirds-overlapping beads plus a crown bead, and it's the bed's dominant
  flower (82%). Bead ring radius is UNDER bead radius so they fuse — merely
  kissing read as a corn cob, and six beads read as a ridged cylinder however
  spaced. Its scatter is 0.055, not the daisies' 0.22. The albedo is a saturated
  GOLD — cream renders as a bleached patch, and pale popcorn sitting a stop
  above the lit leaf doesn't read as a different material. There is no lilac in
  the bed: pale pink dropped to 4% because against the lavender rim it read as
  lilac popcorn. Pink belongs on the TREE.
- **Every species carries a `bloom` table** that speckles pink by SAMPLING the
  leaf rows just emitted — a crown built from masses is not a sphere, so solving
  a radius puts a third of them in mid-air.
- **One InstancedMesh set PER 24m CELL** (Props.jsx `byCell`), and that is the
  entire frustum-culling story. three culls by an InstancedMesh's own bounding
  sphere, so 80 trees in one mesh submitted every crown triangle every frame,
  main and shadow pass both. 80 trees -> 19 cells; the chase lens is 20.5deg so
  typically 3-5 are visible. `byCell` carries each item's ORIGINAL index because
  every seed is `base + i*stride` — regrouping must not renumber. There is
  deliberately no LOD.
- **`FoliageControls.jsx` is a SEARCH TOOL**, not a shipping feature — bake a
  winner back into palette.js/foliage.js/Props.jsx with the measurement. Knobs
  live in `foliageKnobs.js` (shared mutable state can't live in a component
  under react-refresh). A knob can't be a uniform write (the park bakes matrices
  once), so `bumpFoliage()` re-runs the useMemos through a
  useSyncExternalStore version — the same "a remount IS the reset" trick.
  `rebuildFoliageGeo()` DISPOSES the old geometry pair (a slider drag is a
  rebuild per tick) and every numeric knob carries a coarse step. Green knobs
  deliberately do NOT tint MAT.foliage/MAT.crown — LEAF_MAT is white and bake()
  divides the base out, so tinting applies the ramp twice; they reach the screen
  via `refreshStops()`, which rewrites SPECIES against a module-load SNAPSHOT so
  authored stops survive. Defaults mirror the shipped art byte-identically.
- **Foliage colour is set by histogram, not by patch.** Two patches cannot see a
  distribution that is the right shape at the wrong centre — which shipped
  twice. Bin every green pixel (hue 40-140, sat > 0.14) by lightness AND
  saturation AND hue, and crop the TREE and the BED separately (the reference's
  bed is hue 90, its crown 78 — one `leaf*` trio over both averages the
  difference away). An uncropped grove capture is mostly lawn, which passes the
  same green filter and reports nothing wrong. Leaf stops carry s74-86 to render
  at s48-50, because averaging ~100 differently-lit clumps plus a violet ambient
  eats ~10 points.
- **A canopy ramped by height alone reads as noise** — from a 40deg camera every
  mass presents its equator and height bands resolve into rings. foliage.js also
  ramps along the key's bearing (`SUN_FACE`), giving each mass a light and dark
  side; keep it under ~0.25. The shaded end is lifted a third toward the mid
  (`SHADE_LIFT`) — raw leafDark plus `deep` landed near L07, and a leaf in
  shadow is still lit by the violet sky.

## Effects and audio

- **Effects.jsx is a cartoon particle kit** — rainbow grind sparks, star pops,
  shockwave rings on jump/grind-start (none on land, rejected), speed streaks,
  dust, carve marks. Fixed-size instanced pools, zero alloc in the frame loop,
  fades are scale-to-zero (no per-instance alpha).
- **Big air**: PlayerController emits `'bigair'` once per air past 1.0s (a flat
  ollie is ~0.69s), giving a rainbow halo + trail, an AudioManager shimmer and a
  hang-time-scaled bonus.
- **Ambient air (220 dust motes) is the one thing with NO pool** — position is
  analytic in (index, time) and the field WRAPS around the camera, so nothing is
  allocated or respawned. It is CARRIED by a DAMPED copy of the camera position
  (1.1/s): world-anchored, the 13 m/s camera flew through a fixed lattice and
  motes streamed past as debris in a gale; camera-exact gives zero parallax. The
  damped centre settles on straights and falls behind on turns, which is where
  the parallax comes from. `wrapTo` wraps the OFFSET about 0; PHOTO snaps hard.
  Seeds are golden-ratio sequences and the clock is PHOTO_TIME under `?shot=`.
  Motes scale to zero at the box faces and y=0.7, are `toneMapped: false` but
  deliberately UNDER the bloom threshold — a mote glints, it does not glow.
- **Smash litter** is the one pool with a LIT MeshStandardMaterial — a scrap of
  rubbish is a real object for a second. It tumbles about a fixed axis stored in
  the pool's `q` slots (rate in `q.w`) and never asks where the floor is.
- **Clearing a SET** (`'goal'` id `fetch` or `cans`) adds `sfxFanfare` in ONE
  pooled voice — the pool is 8 and a ten-note fanfare taken a voice per note
  evicts itself halfway through.
- `sfxPlace`/`sfxDelete` are the editor's one-shots; they call `unlockAudio()`
  themselves (the editor never runs the game's start gesture) and are guarded
  for node, because the level checks import levelEdits -> AudioManager.
- **ui.css's upper-frame haze was REMOVED by request.** Do not bring it back via
  three's Fog — that's keyed on DEPTH, and the top of a chase frame is sky at
  every depth, so hazing it veils the hero too.
- **ToonFX.jsx** try-out passes are all OFF by default so the harness is
  untouched. TiltShiftEffect ships two masks that disagree (the composite flips
  at the INNER end of the blur ramp, giving a razor line), so its fragment
  shader is replaced with a crossfaded ramp driven by a `bandParams` vec4 whose
  slots are NOT ascending (`inner-, outer-, OUTER+, inner+`) because the shader
  reads the upper edge as `smoothstep(w, z)`. Ascending reverses it and a
  negative mask makes `mix()` extrapolate past the sharp frame. The effect is
  built at module scope and mutated — the r3f wrapper rebuilds render targets on
  every slider tick.

## Textures

- **The PLAZA is drawn at double everyone else's resolution** (albedo 2048,
  normal/rough 1024 = 256 px/m) because it's the only thing seen at a grazing
  angle for the whole run. Resolution is not a free knob: `grain()` counts go
  with AREA, `blur(Npx)` and lineWidths double. normalFrom's sobel is a FIXED
  3px kernel, so at 2x it reads a half-width slope — do NOT raise strength to
  compensate. That was tried and turned the paver pad's soft shoulder into a
  bright BEVEL RING inside all 121 tiles. `crack()`'s wander is `steps x len`:
  doubling STEPS is the HD move, doubling LEN just makes a longer crack.
- Scuff and MOSS live in plazaMap only. Moss is seeded ON a joint (one axis
  snapped to the grid, elongated, blurred) — moss creeps out of a joint, and a
  hard-edged green blob mid-slab reads as paint. Neither is in plazaRough yet;
  moss is matte and a skid is polished, so that's the next thing to add.
- **`dogNormal`/`dogRough` are one fibre height field** sobelled into a normal
  and remapped into a roughness, so the crest the normal bumps is the crest the
  roughness makes glossier. Strokes near a tile edge are redrawn wrapped, only
  the wraps that can reach (all nine doubles interior alpha). They ride the
  ALBEDO's uv channel (Tripo's arbitrary atlas); at FUR_TILE 7 the strands are
  sub-millimetre and an island seam is a direction change, not a line.
- **A bench slat is one board, so its grain runs along its LENGTH.** Slats wear
  the ramp ply maps, whose planks run along canvas *v*, so `slatGeo` writes v
  from local x. It rides plank 6 (the darkest tone), parked on its CENTRE with
  ±0.04 span (or the black plank-edge line runs down every slat), with v clear
  of the butt seam. The tint is NOT `C.benchWood` — it multiplies a map that
  already carries a mid-tan, and was SOLVED against a capture. Re-measure if the
  light rig moves. Bench-only MeshPhysicalMaterial for `sheen`; `woodRough` is a
  remap of the same `plyHeight` field. Ramp materials deliberately go without —
  they are what the halfpipe captures are compared against.
- **Tone-map operating point.** Khronos PBR Neutral is identity below linear
  0.76 then compresses hard. Sitting the plaza at 1.6 gives a slope of 0.05,
  where no shading can move a sunlit pixel.
- **Cylindrical UVs converge.** The bowl's flat uses a planar mapping; carrying
  the cylindrical one across puts a singularity at the centre, and with no
  tangent attribute three derives the frame from screen-space derivatives —
  a starburst even where the texture is one colour.
- **`v=1` is the TOP of the canvas** under three's default `flipY`.
- **Instance colour space.** `bake()` reads row slots 9-11 as an *absolute
  linear* colour and divides the material base out. Emitting a multiplier asks
  for `instanceColor` ~3.2 and renders white — this turned every trunk into a
  pale stick.
- **Wind and non-uniform scale.** The wind shader inverts the instance basis
  per-column. Dividing all three axes by column 0's length squared is only right
  for uniform scale — branches scale (0.085, 0.9, 0.085) and got 139x the
  displacement.
- **N8AO's `quality` prop** silently overwrites `aoSamples`, `denoiseSamples`
  and `denoiseRadius` in a second layout effect. Set them by hand.
- **The `prng` LCG needs `Math.imul`.** `seed * 1103515245` overflows 2^53 and
  the sequence falls into a short orbit (692 distinct values in 5000 draws).
  Unnoticed until `pushBed` drew thousands and the bed came out as 94 identical
  columns.
- **One stream per PLANT, never per planter.** Sharing one `rnd` between
  `pushTree` and `pushBed` meant any tree edit re-randomised every rosette and
  daisy in every bed (measured: bed interior 50-69% changed on byte-identical
  tables). It's `bedRnd` (7331) and `treeRnd` (8101) now. `flowerPink` is a
  SHARED bucket so its array order still moves; the bed's own rows don't.

## Conventions

- `P` (store.js) is mutable per-frame state read inside `useFrame`. Never React
  state.
- The stable Skatepark parent bakes its world matrix once; content-keyed table
  subtrees use normal child updates when a commit replaces one.
- Zero allocation inside the frame loop. Fixed-size pools, round-robin, reuse
  module-scope temporaries.
- Target 60fps at 1600x1000 (currently ~120). `quality === 'low'` scales
  expensive work down.
- **A prop's `rot` is a facing, not a normal** — it yaws local +Z to world
  `(sin rot, cos rot)`, and a bench's local +Z is the seat front.
- Comments explain **why**, with the measurement that forced the value. This
  codebase is dense with them on purpose — they are the record of what was tried
  and why it failed.

## Licence

PolyForm Noncommercial 1.0.0 (`LICENSE`); commercial use by separate paid
licence. No copyleft dependencies. `public/{boy,dog_compressed}.glb`,
`public/songs/*` and `ref/*` are carved OUT of the grant — they ship so the
project runs, they are not licensed for reuse. README.md is the public-facing
version of this file.
