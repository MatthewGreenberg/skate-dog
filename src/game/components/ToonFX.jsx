import { useEffect, useMemo } from 'react'
import { useControls, folder } from 'leva'
import { Uniform, Color, Vector4 } from 'three'
import { Effect, EffectAttribute, TiltShiftEffect, KernelSize } from 'postprocessing'
import { Pixelation, DotScreen } from '@react-three/postprocessing'

// Aesthetic try-out rig: four toggleable fullscreen toon passes behind a leva
// panel, everything OFF by default so gameplay and the shoot harness render
// exactly as before. Mounted after ToneMapping so the passes quantise the
// display-referred image, not the HDR buffer — posterising linear HDR puts
// every band the tone curve will later crush into the same output level.
//
// This is a HOOK returning elements, not a component, and that is load-bearing:
// EffectComposer only rebuilds its pass chain when its direct `children` prop
// changes (the pass-building layout effect closes over the children array). A
// nested component toggling its own state re-renders itself, adds the effect
// instance to the composer's group, and the composer never re-walks it — the
// effect exists but is wired into no pass. Calling this as a hook makes PostFX
// itself re-render on every control change, which changes the children array.

// Quantises luminance only and rescales RGB by the ratio, so hue and chroma
// survive — a straight per-channel floor() shifts hue at every band edge.
const posterizeFrag = /* glsl */ `
  uniform float levels;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float l = dot(inputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float q = floor(l * levels + 0.5) / levels;
    outputColor = vec4(inputColor.rgb * (q / max(l, 1e-4)), inputColor.a);
  }
`

class PosterizeEffect extends Effect {
  constructor() {
    super('PosterizeEffect', posterizeFrag, {
      uniforms: new Map([['levels', new Uniform(5)]]),
    })
  }
}

// Depth-gradient ink lines. The threshold scales with the pixel's own viewZ so
// a rail 5 m away and the bowl lip 40 m away draw the same line weight —
// a fixed threshold either misses the far edges or inks every slope up close.
const outlineFrag = /* glsl */ `
  uniform float thickness;
  uniform float strength;
  uniform float threshold;
  uniform vec3 ink;
  void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
    vec2 t = texelSize * thickness;
    float c = abs(getViewZ(depth));
    float dx = getViewZ(readDepth(uv + vec2(t.x, 0.0))) - getViewZ(readDepth(uv - vec2(t.x, 0.0)));
    float dy = getViewZ(readDepth(uv + vec2(0.0, t.y))) - getViewZ(readDepth(uv - vec2(0.0, t.y)));
    float edge = smoothstep(threshold * c, threshold * c * 2.0, length(vec2(dx, dy)));
    outputColor = vec4(mix(inputColor.rgb, ink, edge * strength), inputColor.a);
  }
`

class ToonOutlineEffect extends Effect {
  constructor() {
    super('ToonOutlineEffect', outlineFrag, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['thickness', new Uniform(2)],
        ['strength', new Uniform(1)],
        ['threshold', new Uniform(0.0015)],
        ['ink', new Uniform(new Color('#2b2440'))],
      ]),
    })
  }
}

// Tilt shift is postprocessing's own effect, so the only thing here is wiring.
// Module scope rather than useMemo on purpose: its properties are setters that
// have to be written every control change, and the react-hooks immutability
// rule forbids mutating anything a hook handed back. One canvas, one effect.
const KERNELS = [
  KernelSize.VERY_SMALL,
  KernelSize.SMALL,
  KernelSize.MEDIUM,
  KernelSize.LARGE,
  KernelSize.VERY_LARGE,
  KernelSize.HUGE,
]
const tiltShift = new TiltShiftEffect()

// THE STOCK COMPOSITE IS A HARD SWITCH, AND ON AN INKED FRAME THAT IS FATAL.
// TiltShiftEffect keeps two masks that do not agree. The blur material ramps
// its own strength with a smoothstep across [focusArea - feather, focusArea],
// so the blurred buffer fades in gradually — but the composite that chooses
// between that buffer and the sharp frame is
//
//     step(offset - b, x) - step(offset + b, x),  b = focusArea - feather
//
// which flips at the INNER edge of that ramp, where the buffer is still nearly
// unblurred but is also half-resolution. Blurred pixels are therefore never
// mixed with sharp ones anywhere: there is a razor line, and on this scene it
// separates "has ink outlines" from "has none". That reads as a UI overlay
// clipping the frame, not as depth of field, which is why no slider setting
// looked right.
//
// Same ramp as the blur material, crossfaded. Patched here rather than
// subclassed: the base class computes its vec2 in a private updateParams(), so
// an override would still be writing this uniform from the outside.
tiltShift.uniforms.set('bandParams', new Uniform(new Vector4()))
tiltShift.fragmentShader = /* glsl */ `
  #ifdef FRAMEBUFFER_PRECISION_HIGH
    uniform mediump sampler2D map;
  #else
    uniform lowp sampler2D map;
  #endif
  uniform vec4 bandParams;
  varying vec2 vUv2;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // One-sided: only the band's upper edge fades. Everything below it stays
    // sharp (mask 1), so the blur reads as distance falling off toward the
    // horizon instead of a vignette that also softens the ground under the
    // rider. The lower ramp — smoothstep(bandParams.x, bandParams.y, vUv2.y) —
    // is what brought the bottom back; slots x/y are unused now but stay in the
    // uniform so the JS side keeps mirroring the blur material's params.
    float mask = 1.0 - smoothstep(bandParams.w, bandParams.z, vUv2.y);
    outputColor = mix(texture2D(map, uv), inputColor, mask);
  }
`

export default function useToonFX() {
  const c = useControls('toon fx', {
    posterize: folder({
      posterizeOn: { value: false, label: 'on' },
      levels: { value: 5, min: 2, max: 12, step: 1 },
    }),
    outline: folder({
      outlineOn: { value: false, label: 'on' },
      thickness: { value: 2, min: 0.5, max: 4, step: 0.25 },
      strength: { value: 1, min: 0, max: 1 },
      // Leva truncates tiny decimals in the UI, so this is ×1e-3 of the
      // shader value — 10 = 0.01, 0.5 = 0.0005.
      threshold: { value: 1.5, min: 0, max: 100, step: 0.5 },
      ink: '#2b2440',
    }),
    halftone: folder({
      halftoneOn: { value: false, label: 'on' },
      dotScale: { value: 0.9, min: 0.3, max: 2 },
      dotAngle: { value: 1.57, min: 0, max: 3.14 },
    }),
    pixelate: folder({
      pixelateOn: { value: false, label: 'on' },
      granularity: { value: 6, min: 2, max: 16, step: 1 },
    }),
    // ponytail: postprocessing ships TiltShiftEffect (Kawase blur masked by a
    // rotatable band), so this is a control panel, not a shader.
    tiltShift: folder({
      tiltOn: { value: false, label: 'on' },
      // 0 = band centred on screen middle. The rider sits below centre in most
      // framings, so the useful range is negative.
      tiltOffset: { value: 0.15, min: -1, max: 1, step: 0.01, label: 'offset' },
      tiltRotation: { value: 0, min: -1.57, max: 1.57, step: 0.01, label: 'rotation' },
      // These are in the band's own space, which is NDC scaled by aspect on x:
      // 1.0 is half the frame height, but only ~0.62 of half the width. So at
      // rotation ±90° a max of 1 could not even reach the frame edge — hence
      // the 2 ceiling. Defaults are sized for rotation 0: sharp through the
      // middle 5% where the rider rides, fully blurred by 50% out — and since
      // the composite is one-sided, that is the top quarter of the frame only.
      focusArea: { value: 0.66, min: 0, max: 2, step: 0.01 },
      feather: { value: 1.14, min: 0, max: 2, step: 0.01 },
      // KernelSize VERY_SMALL..HUGE. Blur cost is the pass, not the kernel.
      kernelSize: { value: 3, min: 0, max: 5, step: 1 },
      // The blur runs at this fraction of the frame. Below ~0.4 the band edge
      // crawls when the camera moves.
      tiltResolution: { value: 0.25, min: 0.25, max: 1, step: 0.05, label: 'resolution' },
    }),
  })

  const posterize = useMemo(() => new PosterizeEffect(), [])
  const outline = useMemo(() => new ToonOutlineEffect(), [])

  useEffect(() => {
    posterize.uniforms.get('levels').value = c.levels
  }, [posterize, c.levels])

  useEffect(() => {
    outline.uniforms.get('thickness').value = c.thickness
    outline.uniforms.get('strength').value = c.strength
    outline.uniforms.get('threshold').value = c.threshold * 0.001
    outline.uniforms.get('ink').value.set(c.ink)
  }, [outline, c.thickness, c.strength, c.threshold, c.ink])

  useEffect(() => {
    tiltShift.offset = c.tiltOffset
    tiltShift.rotation = c.tiltRotation
    tiltShift.focusArea = c.focusArea
    tiltShift.feather = c.feather
    tiltShift.blurPass.kernelSize = KERNELS[c.kernelSize]
    tiltShift.resolution.scale = c.tiltResolution
    // Mirrors TiltShiftBlurMaterial.updateParams so the crossfade tracks the
    // blur ramp exactly: full sharp inside ±b, full blur outside ±a.
    const a = Math.max(c.focusArea, 0)
    const b = Math.max(a - c.feather, 0)
    // Slot order is the library's, NOT ascending: (inner-, outer-, OUTER+,
    // inner+), because the shader reads the upper edge as smoothstep(w, z).
    // Writing them in ascending order reverses that smoothstep, which leaves
    // the top half permanently sharp and drives the bottom half to mask = -1 —
    // and a negative mask makes mix() extrapolate past the sharp frame, so the
    // blurred half comes back with bright fringes around every dark edge.
    tiltShift.uniforms
      .get('bandParams')
      .value.set(c.tiltOffset - a, c.tiltOffset - b, c.tiltOffset + a, c.tiltOffset + b)
  }, [
    c.tiltOffset,
    c.tiltRotation,
    c.focusArea,
    c.feather,
    c.kernelSize,
    c.tiltResolution,
  ])

  return (
    <>
      {c.outlineOn && <primitive object={outline} />}
      {c.posterizeOn && <primitive object={posterize} />}
      {c.halftoneOn && <DotScreen scale={c.dotScale} angle={c.dotAngle} />}
      {c.pixelateOn && <Pixelation granularity={c.granularity} />}
      {/* Last: an out-of-focus region should blur the ink lines and the
          posterised bands too, not have them drawn crisply on top. */}
      {c.tiltOn && <primitive object={tiltShift} />}
    </>
  )
}
