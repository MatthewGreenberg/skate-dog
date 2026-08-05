import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Environment, Lightformer } from '@react-three/drei'
import { C, LIGHT, mix } from '../palette.js'
import { P, useGame } from '../store.js'
import { TOUCH } from '../input.js'
import { useEditing, useSceneSettings, timeOf, groundOf } from '../level/levelEdits.js'

// The whole rig is the decomposition in palette.js made real: a golden key and a
// violet sky that sum to white. Every colour, every direction and the haze come
// straight from LIGHT; the handful of levels this file sets for itself are
// gathered below with the measurement that forced each one.
//
// The shadow box is fitted to the ground the camera can actually see — a box
// centred on the player misses the frame, which is what makes shadows pop in and
// out along the edges.
const SUN = new THREE.Vector3(...LIGHT.sunDir).normalize()
const SUN_DIST = 44
const UP = new THREE.Vector3(0, 1, 0)

// The shadow camera's own frame: three aims a directional light from
// light.position at light.target with up = +Y, so this is that basis.
const LIGHT_BASIS = new THREE.Matrix4().lookAt(SUN, new THREE.Vector3(), UP)
const TO_LIGHT = LIGHT_BASIS.clone().invert()

// Slack for surfaces that sit off the plane we intersect (the bowl). At the 36
// deg elevation the spec asks for, a point 3.5 units below the plaza displaces
// ~4.8 units in light space, so 4 was quietly clipping the deep end's shadow.
const PAD = 6
const QUANT = 2 // box sizes step in 2s so speed-zoom does not make the fit breathe
let planeY = 0 // last grounded P.pos.y — held through the air so jumps don't refit the box

// ---------------------------------------------------------------- rig levels
// The four intensities LIGHT publishes are the one place this file argues with
// it, and each was solved for off the render rather than guessed. LIGHT.target
// is the contract they serve.
//
// 1. SUN-TO-SHADE RATIO. A shadow is albedo x ambient, so the ambient level IS
//    the shadow level and nothing else sets it. Measured off ref-plaza.png:
//    plaza albedo reads (247,182,166) and its deepest tree shade (126,92,91),
//    which puts the reference's ambient at (0.51, 0.505, 0.548) of white — flat
//    across red and green with a lift in blue only, and about a quarter of its
//    key. Our shadows now render (125,93,94) against that (126,92,91), which is
//    the tightest match in the rig and the reason none of these four numbers
//    should be nudged without re-measuring the pair.
// 2. THE AMBIENT IS NEUTRAL-TO-COOL, NOT WARM, AND THAT IS THE WHOLE OF THE
//    SHADOW-HUE FIX. Two revisions ago shadowed pavement rendered at hue 21 —
//    the SUNLIT hue, unchanged — which is the signature of an ambient that is
//    itself golden, and it is exactly what a blind critic reads as "a flat 10%
//    albedo multiply with zero hue shift". The culprit was a warm Lightformer
//    facing straight down from the zenith: it was the largest single
//    contributor to the irradiance every horizontal surface integrates, and the
//    plaza is most of both framings. The zenith card is now the cool sky
//    (C.skyHigh) and the warm card has been stood up on the sun side where it
//    reaches faces that already look toward the sun. Shadow hue: 0.
// 3. WHERE THE BLUE COMES FROM. C.fill is by far the bluest thing in the rig
//    (B/R 2.8 linear against the sky dome's 1.4), so blue is bought from the
//    fill and level is bought from the dome. Shadows have to GAIN saturation as
//    they deepen, not lose it, or they go to the desaturated navy the bowl used
//    to render.
// 4. HEMISPHERE VS ENVIRONMENT ARE NOT INTERCHANGEABLE, and the masonry proves
//    it. A hemisphereLight blends sky and ground by 0.5*dot(N,up)+0.5, so a
//    VERTICAL face takes half its ambient from the warm bounce colour — which
//    had shaded lavender walls rendering warm-grey at 14% saturation against
//    the reference's 25% blue-violet. The env dome is cool from every
//    direction, so almost all the weight sits on the environment. The warm
//    bounce that undersides genuinely need is delivered by the peach
//    Lightformer beneath the park, where it only reaches downward faces.
// 5. THESE THREE WENT UP BY THE RECIPROCAL OF THE EXPOSURE CUT IN Game.jsx, and
//    that is ONE change with two files, not two changes. Exposure came down to
//    pull the sunlit plaza off Neutral tone mapping's shoulder, where its slope
//    was 0.05 and no shading of any kind — occlusion, contact, even the plaza
//    texture's own slab variation — could move a sunlit pixel. Applied alone
//    that would also have dropped cast shadows, which were already correct.
//    Shadows are lit by ambient alone, so scaling the ambient by the inverse
//    holds them exactly where they measured while the key half of the image
//    comes off the shoulder. Sun-to-shade contrast is unchanged in the render;
//    only the curve's operating point moved.
// 6. THE RATIO WAS STILL WRONG BY A FACTOR OF FIVE, and measuring the finished
//    frame rather than a flat-lit patch is what finally showed it. Point 1
//    above is right about open shade — pavement in broad shadow does measure
//    correctly. But an OCCLUDED point does not: at the wall-to-plaza seam the
//    frame rendered rgb(29,9,11), lightness 7, where the reference's deepest
//    seam sits at rgb(121,89,104), lightness 41, with its chroma intact. The
//    rig was key-dominant at roughly 7:1 (key 10.4 against ~1.5 of ambient),
//    which puts a fully-occluded surface at 13% of its sunlit value. The
//    decomposition this whole file is built on says 62%.
//
//    That single ratio is what produced a bimodal image — a uniformly hot open
//    field and a cliff into crushed black, with nothing in between — and it is
//    why four blind critics in a row reported "no ambient occlusion anywhere"
//    while the AO buffer was in fact resolving a strong 69% term at that exact
//    pixel. They were reading the histogram, not the effect: everything not
//    occluded sat at one value, and everything occluded fell off a cliff.
//
//    Solving A/(A+K) = 0.62 wants ambient ABOVE the key, not a seventh of it.
//    The three ambient terms are not interchangeable units (see 4), so these
//    were bracketed against the render rather than computed: the target is a
//    sunlit plaza near lightness 74 and an occluded seam near 41 that KEEPS its
//    violet, which is LIGHT.target's contract.
const KEY_INTENSITY = 3.8
const HEMI_INTENSITY = 0.68
const FILL_INTENSITY = 0.98
const ENV_INTENSITY = 1.34

// ---------------------------------------------------------------- haze
// This is the one place the spec's letter is not followed, and the render is
// the reason. The spec asks for fogExp2 at 0.0075. fogExp2 has no start
// distance, and every authored pose puts the camera 25-30 world units from its
// subject, so an exp-squared curve dense enough to matter at the back of the
// park is already 10% opaque ON THE HERO. Measured on the previous build that
// is exactly what happened: near plaza (239,173,123) against far plaza
// (245,180,130) — the far ground came out BRIGHTER and no less saturated than
// the near ground, which inverts the depth cue instead of building it. The haze
// was being spent on the foreground.
//
// three's linear Fog runs smoothstep(near, far, depth), so it has a genuine
// soft start and no hard onset ring on a sixty-unit slab. Starting it past the
// hero at 22 leaves the character and the near ground untouched; ending at 120
// puts 33% at the back of the plaza framing.
//
// 120 rather than the 100 that would have matched the reference's saturation
// falloff exactly, and the histogram is why. Fog adds a fixed radiance, so it
// costs a dark pixel proportionally far more than a bright one: at FOG_FAR 100
// the far plaza's saturation drop landed on the reference's 8%, but the frame's
// p1 went from 55 to 69 against the reference's 59, far masonry shade lifted
// from (101,75,114) to (122,93,123), and its hue slid from 279 — dead on the
// acceptance target — to 298. Aerial perspective that eats the shadows it
// passes through has stopped being depth and started being a veil. At 120 the
// far plaza still loses 4% of its chroma and the darks stay where the reference
// puts them, which is the better trade by a wide margin.
const FOG_NEAR = 22
const FOG_FAR = 120

// And the colour changes with it, for the same measured reason. C.fog
// (249,220,202) is BRIGHTER than the sunlit plaza in every channel, so mixing
// it in lifted far ground instead of hazing it. Pulling it 55% of the way to
// the plaza albedo lands it at (248,199,182): the same luminance as sunlit
// pavement, a third of its saturation. Distance now costs chroma and contrast
// and not value, which is what aerial perspective is — the reference's far
// plaza loses ~30% of its saturation while holding its level.
const FOG_COLOR = mix(C.fog, C.plaza, 0.55)

const NDC = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]
const _p = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _c = new THREE.Vector3()

// ---------------------------------------------------------------- light cookie
// WHAT THIS USED TO BE, AND WHY IT IS NOT THAT ANY MORE. The previous revision
// projected leaf-scale noise from the sun to fake canopy dapple across the whole
// park. Blind-judged against the reference it was the single most damaging thing
// in the frame, and looking at the render it is obvious why: the pattern had no
// caster anywhere in shot, held one penumbra width and one density from the near
// ledge to the far wall, and climbed onto ledge tops and stair treads at the
// same world scale as the ground two metres below. Leaf shade at that frequency
// is not a light cookie, it is camouflage — it covered ~40% of the plaza and no
// form in the frame could read through it. Worse, it never removed more than 78%
// of the key, so every "shadow" it drew still carried a fifth of a golden light
// and came out at the SUNLIT hue. That is the whole reason our shadows measured
// hue 21 where the reference measures hue 2.
//
// Real canopy shade has to come from real canopies through the shadow map, where
// it gets correct parallax, a penumbra that opens with caster distance, and a
// key contribution of exactly zero.
//
// What survives is the other half of the problem this was written for: open
// ground holding one single value across sixty units is the tell that a scene is
// lit by a slider rather than by a sky. So the cookie stays, at WEATHER scale —
// one noise tap whose features are ~50 world units across, attenuating by at
// most 12%. At that frequency and that depth it can never read as an object's
// shadow (there is no edge to read); it reads as the slow brightness drift of
// high thin cloud, and it costs the flat plaza its dead flatness without costing
// it a single form.
//
// The patch itself is deliberately a global edit to THREE.ShaderChunk rather
// than per-material onBeforeCompile: the materials belong to other modules and
// every lit surface in the park has to agree about the light. It attenuates the
// KEY only, so the drift stays chromatic — the ambient underneath it is
// unchanged. Cost is two value-noise taps per lit fragment, no texture fetch, no
// uniform, every constant folded at compile time.

// Orthonormal basis perpendicular to the sun. Projecting world position onto it
// is an orthographic projection along the light — i.e. exactly what a cookie is.
const SUN_T = new THREE.Vector3().crossVectors(SUN, UP).normalize()
const SUN_B = new THREE.Vector3().crossVectors(SUN, SUN_T).normalize()
const glsl3 = (v) => `vec3( ${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)} )`

const COOKIE_PARS = /* glsl */ `
const vec3 sdSunT = ${glsl3(SUN_T)};
const vec3 sdSunB = ${glsl3(SUN_B)};
const vec3 sdSunW = ${glsl3(SUN)};
// Phase. Only decides which end of the park sits under the brighter half of the
// sky; at 12% depth there is no wrong answer, but it is fixed rather than
// derived so two captures of the same pose are always comparable.
const vec2 sdShift = vec2( 25.0, 4.0 );

float sdHash( vec2 p ) {
	vec3 q = fract( vec3( p.xyx ) * 0.1031 );
	q += dot( q, q.yzx + 33.33 );
	return fract( ( q.x + q.y ) * q.z );
}

float sdNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = p - i;
	f = f * f * ( 3.0 - 2.0 * f );
	return mix(
		mix( sdHash( i ), sdHash( i + vec2( 1.0, 0.0 ) ), f.x ),
		mix( sdHash( i + vec2( 0.0, 1.0 ) ), sdHash( i + vec2( 1.0, 1.0 ) ), f.x ),
		f.y );
}

// 1.0 = open sky, 0.88 = under the thicker part of a high cloud sheet.
//
// Everything about this function is chosen so that it cannot be mistaken for a
// shadow. Frequency: one feature spans ~50 world units, so a whole framing sees
// at most two of them and there is never a contour inside the frame to read as
// an edge. Depth: 12%, which is under a tenth of a stop — a form's own shading
// always dominates it. Ramp: full width, so it is gradient everywhere and hard
// nowhere. What is left is a slow diagonal drift of key brightness across the
// park, which is what open ground under a real sky actually does.
//
// The warp tap costs one extra sample and is what stops the value-noise lattice
// from showing up as a soft chequer at this scale — at 50 units per cell the
// grid would otherwise be plainly axis-aligned on a flat plaza.
float sdCookie( vec3 wPos ) {
	vec2 uv = vec2( dot( wPos, sdSunT ), dot( wPos, sdSunB ) ) * 0.02 + sdShift;
	float n = sdNoise( uv + vec2( sdNoise( uv * 0.47 ) ) * 1.3 );
	return 1.0 - 0.12 * smoothstep( 0.30, 0.74, n );
}
`

// Idempotent: Vite re-executes modules on HMR, and patching twice would nest the
// cookie call inside itself.
if (!THREE.ShaderChunk.lights_pars_begin.includes('sdCookie')) {
  THREE.ShaderChunk.lights_pars_begin += COOKIE_PARS

  // vViewPosition is view space; the rigid view matrix inverts to
  // `cameraPosition + transpose(mat3(viewMatrix)) * viewPos`, and in GLSL
  // `v * M` already means `transpose(M) * v`. Cheaper than a mat4 inverse and
  // exact for any camera three can produce.
  const before = THREE.ShaderChunk.lights_fragment_begin
  THREE.ShaderChunk.lights_fragment_begin = before
    .replace(
      'IncidentLight directLight;',
      `vec3 sdWorldPos = cameraPosition + geometryPosition * mat3( viewMatrix );
vec3 sdSunView = normalize( ( viewMatrix * vec4( sdSunW, 0.0 ) ).xyz );

IncidentLight directLight;`,
    )
    // Only the key gets the cookie. Matching on direction rather than on loop
    // index means reordering the lights in the JSX below can never silently
    // move the dapple onto the cool fill.
    .replace(
      'getDirectionalLightInfo( directionalLight, directLight );',
      `getDirectionalLightInfo( directionalLight, directLight );

		directLight.color *= dot( directLight.direction, sdSunView ) > 0.985 ? sdCookie( sdWorldPos ) : 1.0;`,
    )
  if (import.meta.env.DEV && THREE.ShaderChunk.lights_fragment_begin === before) {
    console.error('[Lighting] light-cookie patch found no anchor — three internals moved')
  }
}

export default function Lighting() {
  const key = useRef()
  const target = useRef()
  const quality = useGame((s) => s.quality)
  const editing = useEditing()

  // Time-of-day preset from the editor's scene store. 'sunset' (the shipped default,
  // and the only value a plain visit can hold) carries no overrides, so every
  // ?? and ×1 below is identity and the measured rig renders untouched.
  const time = useSceneSettings((s) => s.time)
  const ground = useSceneSettings((s) => s.ground)
  const tod = timeOf(time)
  const theme = groundOf(ground)
  const keyK = tod.keyK ?? 1
  const ambK = tod.amb ?? 1
  const envK = tod.envK ?? 1
  const sky = theme.air ? mix(tod.sky ?? C.sky, theme.air, theme.airK) : (tod.sky ?? C.sky)
  const skyHigh = tod.skyHigh ?? C.skyHigh
  const fog = theme.air ? mix(tod.fog ?? FOG_COLOR, theme.air, theme.airK * 0.55) : (tod.fog ?? FOG_COLOR)

  const fillPos = useMemo(
    () => new THREE.Vector3(...LIGHT.fillDir).normalize().multiplyScalar(26),
    [],
  )

  // three allocates light.shadow.map once (`if shadow.map === null`) and never
  // resizes it, so changing mapSize at runtime is silently ignored — and the
  // shader still gets the NEW mapSize in its uniform while sampling the OLD
  // target, so every texel offset is computed against a resolution the texture
  // does not have and the filter walks off the edges. Quality flips when the
  // framerate dips, which is why this looked like "shadows go wrong as soon as
  // I move". Drop the targets and let the next frame reallocate at the size we
  // actually asked for. mapPass is the VSM ping-pong buffer: null under PCF,
  // but this hook has to survive a future flip back, and three never disposes
  // it itself.
  useEffect(() => {
    const shadow = key.current?.shadow
    if (!shadow?.map) return
    shadow.map.depthTexture?.dispose()
    shadow.map.dispose()
    shadow.map = null
    shadow.mapPass?.dispose() // VSM ping-pong target: three never disposes this one
    shadow.mapPass = null
  }, [quality, editing])

  useFrame(({ camera }) => {
    if (!key.current || !target.current) return
    if (key.current.target !== target.current) key.current.target = target.current

    // Latch the fit plane to the last grounded height: a high ollie raises
    // P.pos.y several units, and refitting to that moving plane resized the box
    // every airborne frame — each QUANT crossing remaps the whole shadow map,
    // which reads as the shadows redrawing mid-jump. The camera's own rise is
    // damped and air-capped, so with the plane held QUANT absorbs the rest.
    if (P.state !== 'air') planeY = P.pos.y

    // Where the four frustum corner rays cross the plane the player is on.
    // Casters share their shadow's light-space x/y, so anything whose shadow
    // lands in frame is already inside this box — height needs no padding here,
    // only the near/far range below.
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const [nx, ny] of NDC) {
      _p.set(nx, ny, -1).unproject(camera)
      _dir.set(nx, ny, 1).unproject(camera).sub(_p)
      const t = Math.abs(_dir.y) > 1e-6 ? (planeY - _p.y) / _dir.y : 1
      _p.addScaledVector(_dir, Math.min(Math.max(t, 0), 1)).applyMatrix4(TO_LIGHT)
      minX = Math.min(minX, _p.x)
      maxX = Math.max(maxX, _p.x)
      minY = Math.min(minY, _p.y)
      maxY = Math.max(maxY, _p.y)
      minZ = Math.min(minZ, _p.z)
      maxZ = Math.max(maxZ, _p.z)
    }

    const hx = Math.ceil(((maxX - minX) / 2 + PAD) / QUANT) * QUANT
    const hy = Math.ceil(((maxY - minY) / 2 + PAD) / QUANT) * QUANT

    // Snap the centre to whole shadow texels, or the shadow edges crawl as the
    // box slides under them.
    const size = key.current.shadow.mapSize.x
    const tx = (hx * 2) / size
    const ty = (hy * 2) / size
    _c.set(
      Math.round((minX + maxX) / 2 / tx) * tx,
      Math.round((minY + maxY) / 2 / ty) * ty,
      (minZ + maxZ) / 2,
    ).applyMatrix4(LIGHT_BASIS)

    target.current.position.copy(_c)
    target.current.updateMatrixWorld()
    key.current.position.copy(_c).addScaledVector(SUN, SUN_DIST)

    const cam = key.current.shadow.camera
    if (cam.right !== hx || cam.top !== hy) {
      cam.left = -hx
      cam.right = hx
      cam.top = hy
      cam.bottom = -hy
      cam.updateProjectionMatrix()
    }
  })

  return (
    <>
      <color attach="background" args={[sky]} />
      {/* Linear rather than exp2, and starting past the hero — see FOG_NEAR.
          The colour is still the sunlit-AIR value and not the sky: hazing
          toward a cool blue punches a cold hole in the middle of a warm frame.
          three runs smoothstep(near, far, depth), so there is no onset ring.
          Off while EDITING: the far end of the park is where you place things
          from, and a haze over it hides the row you are aiming at. */}
      {!editing && <fog attach="fog" args={[fog, FOG_NEAR, FOG_FAR]} />}

      {/* the ambient gradient: cool sky above, warm peach bounce off the plaza
          below, so an underside never reads the same as a face */}
      <hemisphereLight args={[tod.hemiSky ?? LIGHT.hemiSky, tod.hemiGround ?? LIGHT.hemiGround, HEMI_INTENSITY * ambK]} />
      {/* the only cool light that reaches geometry the key cannot see, hence
          more saturated than the dome it sits inside */}
      <directionalLight position={fillPos} intensity={FILL_INTENSITY * ambK} color={tod.fill ?? LIGHT.fillColor} />

      <object3D ref={target} />
      {/* left/right/top/bottom are fitted per frame above, so they are absent here */}
      <directionalLight
        ref={key}
        intensity={KEY_INTENSITY * keyK}
        color={tod.key ?? LIGHT.keyColor}
        castShadow
        // 3072 rather than 2048: with the box fitted to the visible ground a
        // plaza frame spans ~70 units, and at 2048 that is 34mm of world per
        // texel — coarser than a skateboard is thick, which is why bench legs
        // and the rider's shadow were dissolving before they reached the slab.
        shadow-mapSize={editing ? [1024, 1024] : TOUCH ? [1024, 1024] : quality === 'low' ? [1536, 1536] : [3072, 3072]}
        // Under PCF this is the Vogel disk radius in TEXELS, not a blur kernel.
        // It is a noise budget as much as a softness one: three spends exactly
        // five Vogel taps and rotates the pattern per pixel by interleaved
        // gradient noise, so the sampling error grows with the radius and comes
        // out as stipple. At 4.0 the dog's cast shadow was visibly dithered at
        // 1:1 and 2.2 still was. 1.4 keeps all five taps inside about one texel
        // of each other, so the rotation has almost nothing left to scatter,
        // and the hardware compare sampler still bilinearly filters each tap —
        // the edge is antialiased, just not wide.
        //
        // 2.2 rather than 1.4 now that canopy shade comes from the shadow map
        // instead of from a cookie. A tree crown is the one caster in the park
        // that stands metres above what it falls on, and the previous value was
        // solved when nothing soft was allowed to come through here at all. It
        // is still short of a real penumbra — three's PCF radius is constant and
        // cannot open with occluder distance — but it is enough that a canopy
        // edge is not the same hard line as a kerb, while a bench leg's contact
        // stays tight enough to seat.
        shadow-radius={2.2}
        shadow-camera-near={1}
        shadow-camera-far={96}
        // Depth bias alone cannot clear a grazing curved surface, and cranking
        // it is what makes shadows detach from the feet that cast them. Almost
        // all of the budget is therefore in normalBias, which displaces along
        // the surface normal and so costs nothing at a face-on contact: 0.03
        // world units is under two texels at this fit.
        shadow-bias={-0.00035}
        shadow-normalBias={0.03}
      />

      {/* Generated environment: no network fetch, baked once (frames={1}).
          This is where the broad low-contrast specular that makes every surface
          read as physical comes from, so its colours have to obey the same
          key/sky split as the analytic lights. */}
      {/* key={tod.id}: frames={1} bakes once per mount, so a time-of-day
          change has to remount the probe or the dome keeps the old sky */}
      <Environment key={tod.id} resolution={128} frames={1} environmentIntensity={ENV_INTENSITY * ambK * envK}>
        <color attach="background" args={[skyHigh]} />
        {/* Sun card — the one hot spot a glancing surface can catch. Its
            position is SUN * 11, so the env highlight and the cast shadows agree
            about where the sun is. Bright but small on purpose: a small solid
            angle barely moves the diffuse irradiance a flat plaza integrates,
            while the bowl at roughness 0.28 samples a narrow lobe and reads it
            as the broad sky sheen that is the whole point of that surface. */}
        {/* form="circle" and half the intensity because the rect version was
            landing on the bowl as a hard-shouldered white lozenge — read as a
            lens smudge, not as a sun. A sun 6 units across at 11 units away is
            still a wildly oversized solid angle, but it is now round, and its
            peak sits under the bloom knee so it glows instead of smearing. */}
        {/* Smaller and dimmer again (was 11 units at 0.5). On the bowl — the one
            surface in the game at roughness 0.28, sampling a narrow lobe — an
            11-unit card landed as a single blown circular blob that read as
            plastic sheen rather than as a reflected sky, and it was the only
            modulation the bowl interior had. At 6.5 units and 0.34 it is a soft
            elongated glint the curvature can sweep, and the bowl's shape is
            once again drawn by the key's terminator rather than by one hotspot. */}
        <Lightformer form="circle" intensity={0.16 * keyK} color={tod.key ?? LIGHT.keyColor} position={[6.7, 6.5, -5.8]} scale={[8, 8, 1]} />
        {/* The warm half of the sky — MOVED, not merely dimmed. It used to face
            straight down from the zenith, which meant it was the largest single
            contributor to the irradiance every horizontal surface integrates:
            the plaza took warm ambient even in full shadow, and shadowed
            pavement therefore rendered at the SUNLIT hue (21 against the
            reference's 2). Standing it up on the sun side turns it into the warm
            half of the sky proper — it reaches faces that already look toward
            the sun and contributes almost nothing to a flat floor, so the
            shadow's hue is now set by the cool dome and the peach bounce alone. */}
        <Lightformer
          intensity={0.55}
          color={tod.envWarm ?? LIGHT.envWarm}
          position={[8, 3.5, -7]}
          scale={[16, 9, 1]}
        />
        {/* THE ZENITH, and it is cool. This replaces the warm card that used to
            sit here, and swapping the colour of the one light that faces
            straight down is the whole shadow-hue fix in a single line: a
            shadowed plaza is lit by whatever is overhead, and what is overhead
            is sky. Paired with the peach card below it, this is the ambient
            GRADIENT the frame was missing — violet from above, terracotta
            bounce from below, so a wall cap, a wall face and a stair riser can
            never render as three copies of one value. */}
        <Lightformer
          intensity={0.9}
          color={tod.envZenith ?? LIGHT.envColor}
          position={[0, 9, 0]}
          rotation-x={Math.PI / 2}
          scale={[24, 24, 1]}
        />
        {/* The cold half, opposite the key — the one part of the ambient that
            goes UP while everything else comes down, because blue is the only
            channel already landing on the reference. */}
        <Lightformer intensity={1.7} color={tod.envFill ?? LIGHT.fillColor} position={[-8, 2, 6]} scale={[11, 7, 1]} />
        {/* Peach light coming back UP off the plaza: without it every underside
            and every downward-facing bevel reflects the cool dome and goes grey.
            It is the one card that goes UP as the dome comes down — the whole
            reason the dome was cut is that flat ambient was filling shadows, and
            this card fills only what faces the ground, which is exactly the warm
            lift along stair risers and wall bases the reference has. */}
        <Lightformer
          intensity={0.55}
          color={tod.bounce ?? C.bounce}
          position={[0, -6, 0]}
          rotation-x={-Math.PI / 2}
          scale={[26, 26, 1]}
        />
      </Environment>
    </>
  )
}
