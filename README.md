# Skate Dog

A boy rides a dachshund through a pastel skatepark. React 19 + three.js, in the
browser, no build step beyond Vite.

![Skate Dog title screen — the boy on his dachshund at the edge of a pastel
plaza, bowl and handrails behind him](docs/screenshot.png)

The park is **entirely procedural**. There are no image files and no network
fetches: every texture is painted into a canvas at load, every piece of geometry
is built in code, and the props and foliage are baked into `InstancedMesh`es
once and never touched again. The only binary assets are the two rigs and the
music.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

## Controls

| | Keyboard | Touch |
|---|---|---|
| Steer / throttle | `WASD` / arrows | left stick (world-directional — point where you want to go) |
| Ollie | `Space` | JUMP button |
| Brake | `Shift` | — |
| Spin (air) | left / right, or `Q` / `E` | stick x |
| Grab (air) | up, or `K` | stick up |
| Dogflip (air) | down, or `J` | stick down |

The dog *is* the board, so a kickflip is the dog's barrel roll. There is no air
steering and no air throttle — both were tried, both fought the spin and the
transitions. Collect the 5 floating bones; each one is placed to demand a
specific line (a coping ollie, a pumped halfpipe air, a rail grind, a deep-end
air, a stair gap).

## How it's put together

```
src/game/
  palette.js       art-direction contract — albedo, roughness, light, tone, ramps
  store.js         useGame = UI state; P = per-frame mutable state (never React state)
  level/           authored layout, colliders, analytic bowl, procedural textures, foliage
  components/      Game, Lighting, Skatepark, Props, Player, Effects, UI, Intro, ToonFX
  player/          movement, tricks, grinding, scoring; boneRig drives the rider's skeleton
  audio/           every sound effect is synthesised at runtime — no sfx files
tools/             deterministic screenshot + image-diff harness
```

Two things are worth knowing before you change anything:

**The palette is a contract.** Every value in `palette.js` is derived by
decomposing reference stills into albedo × light. A shadowed surface reads at
(0.62, 0.62, 0.78) of its sunlit self, which solves to a golden key and a cool
violet ambient whose sum is neutral white — the scene is warm-*painted*, not
warm-*lit*. So albedo is never pre-warmed, and **if a surface renders too
orange, the light is wrong, not the paint.**

**The level data is single-source.** `levelData.js` is read by both the renderer
and the collider builder, so the drawn surface and the ridden surface can't
drift apart. The bowl is analytic for the same reason.

`CLAUDE.md` is the long version — including a "gotchas paid for in blood"
section that is the record of what has already been tried and why it failed.
Read it before retuning a number.

## Seeing your changes

Don't eyeball it. `?shot=<pose>` freezes the sim, parks the camera on an
authored pose, pins the wind clock and flips `window.__shotReady`:

```bash
node tools/shoot.mjs --tag mywork plaza bowl        # -> shots/mywork-{plaza,bowl}.png
node tools/shoot.mjs --tag mywork                   # all poses, ~45s
node tools/px.mjs shots/mywork-bowl.png open,0.62,0.90,16
node tools/compare.mjs ref/ref-plaza.png shots/mywork-plaza.png out/ key.json
```

Poses: `plaza bowl hero props grove deck pipe`. `compare.mjs` builds a **blind**
A/B sheet — reference and capture in randomised order, key written separately.
Judging your own work against a labelled pair is worth very little. The harness
runs its own dev server on 3210 so it never fights yours.

## Self-checks

Plain `node`, no test framework. Run the ones covering what you touched.

```bash
node src/game/level/collision.check.js     # ~40s: broad phase, penetration, ramp seams, drops
node src/game/level/ramps.check.js         # every ramp and stair enterable and climbable
node src/game/level/rails.check.js         # rail/post clearance; lip-edge grinds
node src/game/level/foliage.check.js       # crowns, branch coverage, colour space, bed coverage
node src/game/level/benches.check.js
node src/game/level/bones.check.js
node src/game/player/boneRig.check.js      # rider joint angles, measured in world space
node src/game/player/steering.check.js
node src/game/player/scoring.check.js
node src/game/input.check.js
node src/game/components/shadowfit.check.js
node src/game/components/clearCoat.check.js
```

`boneRig.check.js` rebuilds the rider's skeleton straight out of the glTF node
tree — no loader, no DOM — and measures the result in world space. It is the
only thing standing between a sign error and a knee that bends sideways: a
wrong axis still produces smooth, finite, plausible numbers.

## Third-party assets

The GLB decoders in `public/draco` and `public/basis` are copied out of
three.js (MIT) on purpose — drei's default decoder path is a CDN, and nothing
here fetches over the network. `public/fonts/LuckiestGuy-Regular.ttf` is under
the SIL Open Font License, vendored for the same reason.

`public/boy.glb`, `public/dog_compressed.glb`,
`public/songs/*.mp3` and
`ref/*.png` are **not** covered by this project's licence — see below.

## Licence

Source code is **[PolyForm Noncommercial 1.0.0](LICENSE)**. In short: fork it,
change it, redistribute it, learn from it, build hobby and student projects with
it — free, forever. Anything commercial (shipping it or a derivative in a
product, running it in an ad-supported or paid context, or any other use in
furtherance of a business) needs a separate commercial licence.

Commercial licences are available — email **mattcgreenberg@gmail.com** and we'll
work something out. Rough shape: flat fee for small studios and indies,
revenue-share above that.

The bundled models, music and reference images are not licensed for reuse at
all, commercial or otherwise. Fork the code, bring your own dog.

© 2026 Matt Greenberg
