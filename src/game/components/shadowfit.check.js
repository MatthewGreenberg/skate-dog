// Self-check for the shadow box fit in Lighting.jsx: the box has to contain
// every bit of ground the camera can see, or shadows pop in and out at the
// frame edges. Mirrors the fit maths; run it after touching either file.
// Run: node src/game/components/shadowfit.check.js

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'

// --- rig constants, kept in step with CameraController.jsx / Lighting.jsx ----
const YAW = -0.42
const HEIGHT = 20.9
const BACK = 24.9
const FOV = 26
const SUN = new THREE.Vector3(0.55, 0.68, -0.48).normalize()
const UP = new THREE.Vector3(0, 1, 0)
const PAD = 4
const QUANT = 2

const LIGHT_BASIS = new THREE.Matrix4().lookAt(SUN, new THREE.Vector3(), UP)
const TO_LIGHT = LIGHT_BASIS.clone().invert()

/** The fit, as Lighting.jsx does it: ground hits of the 4 corner rays. */
function fit(camera) {
  const p = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const box = new THREE.Box3()
  for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    p.set(nx, ny, -1).unproject(camera)
    dir.set(nx, ny, 1).unproject(camera).sub(p)
    const t = Math.abs(dir.y) > 1e-6 ? (0 - p.y) / dir.y : 1
    p.addScaledVector(dir, Math.min(Math.max(t, 0), 1)).applyMatrix4(TO_LIGHT)
    box.expandByPoint(p.clone())
  }
  const size = box.getSize(new THREE.Vector3())
  return {
    box,
    hx: Math.ceil((size.x / 2 + PAD) / QUANT) * QUANT,
    hy: Math.ceil((size.y / 2 + PAD) / QUANT) * QUANT,
    centre: box.getCenter(new THREE.Vector3()),
  }
}

function rigCamera(aspect, zoom = 1) {
  const cam = new THREE.PerspectiveCamera(FOV, aspect, 1, 240)
  cam.position.set(Math.sin(YAW) * BACK * zoom, HEIGHT * zoom, Math.cos(YAW) * BACK * zoom)
  cam.lookAt(0, 0.7, 0)
  cam.updateMatrixWorld()
  cam.updateProjectionMatrix()
  return cam
}

// A dense sample of the visible ground must land inside the fitted box.
function assertCovers(aspect, zoom) {
  const cam = rigCamera(aspect, zoom)
  const { hx, hy, centre } = fit(cam)
  const p = new THREE.Vector3()
  const dir = new THREE.Vector3()
  let worst = 0
  for (let i = 0; i <= 20; i++) {
    for (let j = 0; j <= 20; j++) {
      const nx = (i / 20) * 2 - 1
      const ny = (j / 20) * 2 - 1
      p.set(nx, ny, -1).unproject(cam)
      dir.set(nx, ny, 1).unproject(cam).sub(p)
      const t = Math.abs(dir.y) > 1e-6 ? (0 - p.y) / dir.y : 1
      p.addScaledVector(dir, Math.min(Math.max(t, 0), 1)).applyMatrix4(TO_LIGHT)
      const dx = Math.abs(p.x - centre.x) / hx
      const dy = Math.abs(p.y - centre.y) / hy
      worst = Math.max(worst, dx, dy)
      assert(
        dx <= 1 && dy <= 1,
        `visible ground at ndc(${nx.toFixed(1)},${ny.toFixed(1)}) falls outside the shadow box ` +
          `at aspect ${aspect.toFixed(2)} zoom ${zoom}`,
      )
    }
  }
  return { hx, hy, worst }
}

for (const aspect of [4 / 3, 16 / 10, 16 / 9, 21 / 9]) {
  for (const zoom of [1, 1.12]) {
    const { hx, hy, worst } = assertCovers(aspect, zoom)
    console.log(
      `aspect ${aspect.toFixed(2)} zoom ${zoom}: box ${(hx * 2).toFixed(0)}x${(hy * 2).toFixed(0)}` +
        `  texel@2k ${((hx * 2 * 100) / 2048).toFixed(1)}cm  fill ${(worst * 100).toFixed(0)}%`,
    )
  }
}

// near/far have to span the whole box too — clipping there pops shadows just
// as visibly as the sides do. Depth is measured along the sun from the light.
{
  const SUN_DIST = 44
  const NEAR = 1
  const FAR = 96
  const cam = rigCamera(21 / 9, 1.12)
  const { centre } = fit(cam)
  const lightPos = centre.clone().applyMatrix4(LIGHT_BASIS).addScaledVector(SUN, SUN_DIST)
  const p = new THREE.Vector3()
  const dir = new THREE.Vector3()
  for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    p.set(nx, ny, -1).unproject(cam)
    dir.set(nx, ny, 1).unproject(cam).sub(p)
    p.addScaledVector(dir, (0 - p.y) / dir.y)
    // tallest caster (a 6-unit lamp post) and the bowl floor bracket the range
    for (const h of [-4.5, 0, 6]) {
      const depth = lightPos.clone().sub(p).addScaledVector(UP, -h).dot(SUN)
      assert(
        depth > NEAR && depth < FAR,
        `shadow depth ${depth.toFixed(1)} at height ${h} escapes near/far [${NEAR}, ${FAR}]`,
      )
    }
  }
}

// A fixed box centred on the player — what this replaced — must NOT cover it,
// otherwise the fit is pointless complexity.
{
  const cam = rigCamera(16 / 9)
  const p = new THREE.Vector3()
  const dir = new THREE.Vector3()
  let outside = 0
  for (const [nx, ny] of [[-1, 1], [1, 1]]) {
    p.set(nx, ny, -1).unproject(cam)
    dir.set(nx, ny, 1).unproject(cam).sub(p)
    const t = (0 - p.y) / dir.y
    p.addScaledVector(dir, t).applyMatrix4(TO_LIGHT)
    if (Math.abs(p.x) > 19 || Math.abs(p.y) > 19) outside++
  }
  assert(outside > 0, 'a 19-unit box centred on the player would have covered the frame')
}

// Lighting.jsx disposes the shadow targets whenever quality changes the map
// size, because three only allocates them when they are null. If a three
// upgrade ever starts handling the resize itself, this fires and the workaround
// (and this assertion) can go.
{
  const src = await readFile(
    new URL('../../../node_modules/three/src/renderers/webgl/WebGLShadowMap.js', import.meta.url),
    'utf8',
  )
  assert(
    /if \( shadow\.map === null \|\| typeChanged === true \)/.test(src),
    'three now reallocates shadow maps differently — recheck the dispose-on-quality-change in Lighting.jsx',
  )
  assert(
    /if \( shadow\.mapPass === null \)/.test(src),
    'three now manages shadow.mapPass differently — recheck the dispose in Lighting.jsx',
  )
}

console.log('shadow fit ok')
