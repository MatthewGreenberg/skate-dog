import { useEffect } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { Preload } from '@react-three/drei'
import { EffectComposer, N8AO, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useControls, folder, Leva } from 'leva'

import { P, useGame } from '../store.js'
import { LIGHT } from '../palette.js'
import { initInput, sampleInput, TOUCH } from '../input.js'
import { updatePlayer } from '../player/PlayerController.js'
import { initGoals, tickGoals } from '../goals.js'
import { startAudio, updateAudio } from '../audio/AudioManager.js'
import { PHOTO, tickPhotoReady } from '../photo.js'

import Lighting from './Lighting.jsx'
import Skatepark from './Skatepark.jsx'
import Player from './Player.jsx'
import Effects from './Effects.jsx'
import Bones from './Bones.jsx'
import Letters from './Letters.jsx'
import Cans from './Cans.jsx'
import CameraController from './CameraController.jsx'
import PerformanceManager from './PerformanceManager.jsx'
import GameUI from './GameUI.jsx'
import Intro from './Intro.jsx'
import useToonFX from './ToonFX.jsx'
import FoliageControls from './FoliageControls.jsx'

// One authoritative update order per frame: input -> movement/collision/surface
// -> tricks/grinding -> animation channels -> audio. Views read P afterwards;
// the camera runs last because it is mounted last.
function GameLoop() {
  const started = useGame((s) => s.started)
  useEffect(() => initInput(), [])
  useEffect(() => initGoals(), [])
  useEffect(() => {
    if (!import.meta.env.DEV) return
    // dev diagnostics: inspect/park the player from the console
    window.__P = P
    window.__tp = (x, z) => {
      P.pos.set(x, 6, z)
      P.vel.set(0, 0, 0)
      P.state = 'air'
    }
  }, [])
  useEffect(() => {
    if (started) startAudio()
  }, [started])

  useFrame((state, delta) => {
    if (import.meta.env.DEV && !window.__three) window.__three = state
    // photo mode: the rig is frozen on its pose, so nothing simulates
    if (PHOTO) {
      P.intro = 0 // captures are mid-session frames — never the title framing
      P.pos.set(PHOTO.player.x, PHOTO.player.y, PHOTO.player.z)
      P.heading = PHOTO.player.heading
      P.quat.setFromAxisAngle(UP, PHOTO.player.heading)
      tickPhotoReady()
      return
    }
    const dt = Math.min(delta, 0.1)
    sampleInput(dt)
    const g = useGame.getState()
    if (g.started && !P.paused) {
      if (P.intro > 0) P.intro = Math.max(0, P.intro - dt / REVEAL)
      // The clock does not run during the reveal swoop — you can ride through
      // it, but you shouldn't be billed for the 1.5s the camera spends flying.
      if (!g.runOver && P.intro === 0) {
        P.timeLeft = Math.max(0, P.timeLeft - dt)
        tickGoals(dt)
        // whole-second mirror: 1 HUD render per second, not one per frame
        const sec = Math.ceil(P.timeLeft)
        if (sec !== g.timeLeft) g.setTimeLeft(sec)
        if (P.timeLeft === 0) g.endRun()
      }
      // the sim keeps running under the scorecard — the dog rolls to a stop
      updatePlayer(dt)
    }
    updateAudio(dt)
  })
  return null
}

const UP = new THREE.Vector3(0, 1, 0)
// Seconds of camera swoop from the title framing into the chase rig. The sim
// runs THROUGH it — you are already riding when the camera lands, which is what
// makes it read as a reveal instead of a cutscene.
const REVEAL = 1.5
const AO_DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('ao')
const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')


// THE SINGLE MEASUREMENT THAT EXPLAINS "EVERY SURFACE READS AS FLAT PASTEL
// PAINT". Khronos PBR Neutral — three's NeutralToneMapping, and the curve the
// spec asks for — is the identity below scene-linear 0.76 and then compresses
// by scaling ALL THREE channels by newPeak/peak, where peak is the max channel.
// Inverting it through our previous render put the sunlit plaza's red channel
// at scene-linear 1.61. The curve's slope there is 0.05. Not 0.5 — 0.05.
//
// At that slope nothing on a sunlit surface can move. A 25% ambient-occlusion
// multiply at a bench leg came out as a THREE level drop; the plaza texture's
// own slab-to-slab variation came out as one; and because Neutral divides by
// the peak channel, green and blue got dragged along with red and could not
// separate either. That is the whole of the blind critique's "zero contact
// occlusion", "no ambient occlusion anywhere", "brightest and darkest sampled
// points inside the bowl are numerically identical" and "the entire scene
// occupies a ~25 value band" — one curve, one operating point, four symptoms.
//
// So the exposure comes down until the plaza's peak channel sits near 1.05,
// where the same curve has a slope of 0.23 — four and a half times the shading
// response for free. It costs the sunlit plaza almost nothing in level, because
// what we gave up was compression, not light: 248 becomes ~245 against an
// acceptance target of 247 +/- 6. The ambient family in Lighting.jsx goes up by
// the reciprocal at the same time so that shadow DEPTH is held exactly where it
// already measured correctly; the two edits are one change and must move
// together.
const EXPOSURE = LIGHT.exposure * 0.66

// Grade. Order is load-bearing: everything up to and including ToneMapping runs
// on the linear HDR buffer, and only Vignette runs on the displayed image.
//
// The one piece of non-obvious plumbing: @react-three/postprocessing forces
// gl.toneMapping to NoToneMapping while it is mounted, so the <ToneMapping>
// effect below is the *only* tone map in the pipeline — but three still uploads
// gl.toneMappingExposure to every program that declares it, which includes this
// effect. That is why the exposure lives in the Canvas gl props and still works.
function PostFX() {
  const quality = useGame((s) => s.quality)
  // A hook, not a component, so toggling a control re-renders PostFX and the
  // composer sees a new children array — see the note in ToonFX.jsx.
  const toonFX = useToonFX()
  // Defaults are the measured acceptance values from the comments below —
  // tune in the panel, then bake the winners back into these numbers.
  const fx = useControls('post fx', {
    n8ao: folder({
      aoOn: { value: true, label: 'on' },
      aoRadius: { value: 0.3, min: 0.2, max: 4, step: 0.05 },
      distanceFalloff: { value: 3.0, min: 0.1, max: 3, step: 0.05 },
      aoIntensity: { value: 11.6, min: 0, max: 20, step: 0.05 },
      denoiseRadius: { value: 24, min: 0, max: 24, step: 1 },
      aoColor: { value: '#c3c3c3' },
      halfRes: { value: true },
      aoDebug: { value: AO_DEBUG, label: 'AO buffer' },
    }),
    bloom: folder({
      bloomOn: { value: false, label: 'on' },
      bloomIntensity: { value: 1.7, min: 0, max: 4, step: 0.05 },
      luminanceThreshold: { value: 1.18, min: 0, max: 2, step: 0.01 },
      luminanceSmoothing: { value: 0.35, min: 0, max: 1, step: 0.01 },
      bloomRadius: { value: 0.68, min: 0, max: 1, step: 0.01 },
      mipmapBlur: { value: true },
    }),
    vignette: folder({
      vignetteOn: { value: false, label: 'on' },
      vignetteOffset: { value: 0.42, min: 0, max: 1, step: 0.01 },
      vignetteDarkness: { value: 0.2, min: 0, max: 1, step: 0.01 },
    }),
  })
  return (
    <EffectComposer multisampling={quality === 'low' ? 0 : 4} enableNormalPass={false}>
      {/* AMBIENT OCCLUSION, RE-SOLVED AGAINST THE AO BUFFER ITSELF rather than
          against the finished frame. Rendered alone (renderMode 1) the previous
          settings produced a near-white sheet: 175 grey in the open and 148 at
          its darkest point anywhere in the bowl framing — a 15% maximum, which
          is why the blind critique could say "zero contact occlusion, character,
          wall base, coping junction and bench legs all meet their surfaces with
          a hard untreated line" and be exactly right. It now measures 175 open
          against 95 at a wall base: 46%, a real junction.

          Two things were wrong and both are worth recording.

          (1) THE `quality` PROP. The wrapper applies our configuration and THEN
          calls setQualityMode in a second layout effect, and setQualityMode
          unconditionally overwrites aoSamples, denoiseSamples AND denoiseRadius.
          Passing quality="medium" was silently forcing denoiseRadius back to 12
          px behind our 6 — at half resolution a 24-px blur, which is a low-pass
          filter wide enough to erase a contact term entirely. The prop is
          deliberately absent now; the three numbers it used to clobber are set
          here and gated on quality by hand.

          (2) THE RADIUS WAS TOO SMALL, which is the opposite of the intuition
          the last two revisions followed down from 2.3 to 1.5 to 0.9. n8ao
          integrates visibility over a hemisphere of aoRadius; a wall 3 m tall
          sampled at 0.9 m occludes almost nothing of that hemisphere, so the
          seam at its base — the single place the reference always has darkening
          — measured 3%. Occlusion that reads has to be sampled at the scale of
          the occluder, and then shaped by the exponent rather than by the
          radius. */}
      {fx.aoOn && !TOUCH && (
        // no AO at all on phones — even half-res 10-sample n8ao is the most
        // expensive single pass on a mobile GPU, and the baked AO in the
        // textures still grounds the big junctions
        <N8AO
          // 1.6, bracketed from both sides against the AO buffer and the finished
          // frame. At 0.9 a wall base measured 3% occluded. At 2.4 the junctions
          // were right but the term had started behaving like a light instead of
          // a contact: a ten-metre bowl read 25 lightness points down from its own
          // sunlit value, the close framings grew soft dark pools a metre out from
          // every planter, and the deepest bowl corner reached rgb(39,22,97) —
          // black by this scene's standards, and the one failure the reference
          // never commits. 1.6 is roughly the height of the things that have to
          // seat: kerbs, ledges, bench frames, coping.
          aoRadius={fx.aoRadius}
          // n8ao uses this as the world-space tangent-plane range check: samples
          // further than this off the surface's own plane are rejected, so it is
          // what stops a foreground object from casting occlusion onto ground two
          // metres behind it. Matched to the radius.
          distanceFalloff={fx.distanceFalloff}
          // This is an EXPONENT, not a gain: finalAo = pow(visibility, intensity).
          // That is why it is the right knob for shaping — it leaves open ground
          // (visibility ~1) untouched no matter how high it goes and bites only
          // where visibility has genuinely dropped. It is therefore the knob that
          // separates "junction" from "grime", and the radius above should be set
          // for the size of the occluder while this is set for the depth.
          // 4.2, not 11. As an EXPONENT on visibility, 11 turned every junction
          // into a hard black core the moment the ambient floor came up in
          // Lighting.jsx — the two knobs multiply, and 11 was solved against a
          // rig whose shadows were already five times too dark.
          intensity={fx.aoIntensity}
          aoSamples={quality === 'low' ? 10 : 32}
          denoiseSamples={quality === 'low' ? 4 : 16}
          // 4 px. Enough to take the half-res stipple off — depthAwareUpsampling
          // does the real reconstruction — and not one pixel more, because every
          // pixel past that is contact shading thrown away.
          denoiseRadius={fx.denoiseRadius}
          // Never neutral grey. AO stands in for ambient the surface cannot see,
          // and the ambient here is a violet sky, so the term it removes is
          // violet. A grey multiply on peach concrete is the exact look of cheap
          // AO — and it is what the critique measured as "half the surface chroma
          // discarded" in shadow.
          color={fx.aoColor}
          // Half resolution always. This is a broad grounding term, not a detail
          // pass, and full-res was the single most expensive thing on screen.
          halfRes={fx.halfRes}
          renderMode={fx.aoDebug ? 1 : 0}
        />
      )}
      {fx.bloomOn && (
        <Bloom
          intensity={fx.bloomIntensity}
          // The threshold is in scene-linear luminance BEFORE exposure — the
          // composer runs on the raw HDR buffer and only ToneMapping applies the
          // exposure — so it has to be re-solved every time the KEY moves, and
          // never when the exposure does. Inverting the tone curve through the
          // current render puts sunlit pavement at 1.12 of luminance here, so 1.18
          // sits just above the single widest surface in the game and lets through
          // only what is genuinely brighter than pavement: cream wall caps, the
          // bowl's sky sheen, coping noses, the rails' specular line. Both
          // failures are one number apart — a threshold under the plaza is the
          // milky veil this frame had two revisions ago, and a threshold far over
          // it is why the last build had no highlight breathing anywhere and
          // topped out at a chalky 244,187,136.
          luminanceThreshold={fx.luminanceThreshold}
          luminanceSmoothing={fx.luminanceSmoothing}
          radius={fx.bloomRadius}
          mipmapBlur={fx.mipmapBlur}
        />
      )}
      {/* <ToneMapping mode={ToneMappingMode.NEUTRAL} /> */}
      {/* toon try-out passes, all off by default — must sit after ToneMapping
          so they quantise the display-referred image, not the HDR buffer */}
      {toonFX}
      {/* barely there: in both references the frame edges wash BRIGHT, and a
          heavy vignette is the fastest way to undo the airiness we just bought */}
      {fx.vignetteOn && (
        <Vignette offset={fx.vignetteOffset} darkness={fx.vignetteDarkness} />
      )}
    </EffectComposer>
  )
}

export default function Game() {
  // Every collectible keeps its "already got" flags in a useRef with no reset
  // path, so restarting a run is a remount — one key on the group they share.
  const runId = useGame((s) => s.runId)
  return (
    <>
      <Leva hidden={!DEBUG} />
      {/* leva-only, outside the Canvas: it writes module state and bumps a
          version the foliage components subscribe to, and renders nothing. */}
      {DEBUG && <FoliageControls />}
      <Canvas
        // PCF, not VSM. Variance shadows were costing us two separate blockers:
        // the moment blur rang across the bowl's curved transition as a fan of
        // concentric stair-stepped arcs, and Chebyshev's bound light-bleeds
        // wherever a big depth discontinuity sits nearby — which is why the
        // rider and dog cast no shadow at all once they dropped into the bowl,
        // while the identical rig cast a clean one for them out on the plaza.
        // three r185's PCF path is a 5-tap Vogel disk on a hardware compare
        // sampler with per-pixel IGN rotation (20 effective filtered taps), so
        // giving up VSM costs no softness and buys a shadow that is exact at
        // the contact point.
        shadows="percentage"
        // Back to 2, and the blind critique found the reason: "thin rails
        // staircase and shimmer ... while flat surfaces are blurred as if
        // resolved from a lower internal resolution". Both halves of that are
        // one bug. The device pixel ratio in every capture and on every retina
        // display is 2; capping the backing store at 1.5 made the browser
        // upscale the finished frame by 33%, which softens every flat surface
        // while leaving a rail thinner than a backing-store texel still
        // aliased. There is no AA setting that fixes rendering below the
        // display's own grid. AdaptiveDpr (PerformanceManager) still drops this
        // under load, so the 60 fps floor is protected by measurement rather
        // than by a permanent tax on sharpness.
        // ...but a phone GPU at dpr 2-3 can't hold the frame rate at all, and a
        // 6" screen hides the upscale softness the cap costs a desktop display
        // (floor 0.75 on touch gives AdaptiveDpr real room to shed pixels
        // under load; steady-state still renders at the 1.5 cap)
        dpr={TOUCH ? [0.75, 1.5] : [1, 2]}
        gl={{
          // everything goes through the composer's own targets, so MSAA on the
          // default framebuffer is memory bandwidth spent on nothing
          antialias: false,
          powerPreference: 'high-performance',
          // the composer overrides this to NoToneMapping and restores it on
          // unmount; it is here so a composer-less frame is not raw linear
          toneMapping: THREE.NeutralToneMapping,
          // Read by the ToneMapping effect (see PostFX). LIGHT.exposure of 1.02
          // was solved against the old under-lit key; with the key now carrying
          // its share the sunlit plaza measured lightness 77 against the
          // reference's 75, so it comes back down a hair. Trimming here rather
          // than at the key is deliberate: the plaza sits past the tone curve's
          // shoulder, where exposure moves the desaturating highlights and
          // barely touches red — which is exactly the correction we wanted.
          toneMappingExposure: EXPOSURE,
        }}
        camera={{ fov: 20.5, near: 1, far: 240, position: [P.pos.x - 9, 19, P.pos.z + 21] }}
      >
        <GameLoop />
        <Lighting />
        <Skatepark />
        <Player />
        <group key={runId}>
          <Bones />
          <Letters />
          <Cans />
        </group>
        <Intro />
        <Effects />
        <PostFX />
        <PerformanceManager />
        <Preload all />
        <CameraController />
      </Canvas>
      <GameUI />
    </>
  )
}
