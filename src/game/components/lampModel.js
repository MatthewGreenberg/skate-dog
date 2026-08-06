// Teal Victorian lamp post, rebuilt procedurally from a reference still via the
// img2threejs pipeline (spec + pass reviews live in the session job dir).
// Pure module: imports only 'three', so tools/lamp-preview.html can render the
// exact same parts the park instances — Props.jsx consumes lampParts() through
// its existing instanceProp path and NEVER mounts the Group factory (the park
// bakes InstancedMeshes; a Group per lamp would be 9x the draw calls).
//
// Proportions are measured off the reference (1024x1536, lamp spans ~93% of
// frame height, head = 26% of total), then the SHAFT was shortened 0.7m by
// request (column 3.2 -> 2.5, head stack translated down whole) — the head
// keeps its measured size, so it is deliberately a stop larger than the
// reference's head-to-height ratio now. Banner arms mount at y2.86.
import * as THREE from 'three'

// Hex parts (cage, skirt, roof) read as facets on purpose — the reference
// lantern is 6-sided. Round parts smooth. The lathe profile for the base bell
// is the reference's concave ogee flare, not a cone.
const lathe = (pts, segs) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs)

const G = {
  plinthLo: new THREE.CylinderGeometry(0.42, 0.44, 0.12, 16),
  plinthHi: new THREE.CylinderGeometry(0.35, 0.375, 0.10, 16),
  bell: lathe([[0.345, 0], [0.335, 0.06], [0.29, 0.16], [0.21, 0.30], [0.155, 0.44], [0.13, 0.55], [0.122, 0.62]], 24),
  bellRib: new THREE.BoxGeometry(0.028, 0.5, 0.06),
  beadBig: new THREE.TorusGeometry(0.135, 0.038, 8, 18),
  column: new THREE.CylinderGeometry(0.078, 0.101, 2.5, 12),
  sleeve: new THREE.CylinderGeometry(0.107, 0.112, 0.42, 12),
  beadMid: new THREE.TorusGeometry(0.112, 0.036, 8, 16),
  beadNeck: new THREE.TorusGeometry(0.098, 0.031, 8, 16),
  neck: new THREE.CylinderGeometry(0.14, 0.078, 0.22, 12),
  skirt: new THREE.CylinderGeometry(0.26, 0.135, 0.24, 6),
  dripLip: new THREE.CylinderGeometry(0.3, 0.3, 0.05, 6),
  mullion: new THREE.BoxGeometry(0.038, 0.58, 0.038),
  glass: new THREE.CylinderGeometry(0.205, 0.26, 0.56, 6),
  eave: new THREE.CylinderGeometry(0.31, 0.335, 0.055, 6),
  roof: lathe([[0.31, 0], [0.26, 0.055], [0.17, 0.15], [0.11, 0.22], [0.078, 0.27], [0.06, 0.3]], 6),
  // Finial kept modest: a tall 8-seg cone read crooked and "dramatic" from the
  // chase angles, so the spike is short, slim and 12-sided (rounder silhouette).
  fCollar: new THREE.CylinderGeometry(0.062, 0.085, 0.07, 12),
  fKnob: new THREE.SphereGeometry(0.06, 12, 10),
  fNeck: new THREE.CylinderGeometry(0.03, 0.044, 0.05, 12),
  spike: new THREE.CylinderGeometry(0, 0.045, 0.19, 12),
}

// Cage taper: mullions lean in with the glass (bottom r0.2 -> top r0.16 over
// 0.56 is a 4.1deg tilt about each corner's tangent axis).
const CAGE_Y = 3.62, CAGE_H = 0.56, TILT = Math.atan(0.055 / CAGE_H)

// Build pass stages, per the sculpt spec's locked pipeline: 0 blockout masses,
// 1 structure (cage/mullions/glass/eave/finial stack), 2 form (beads, ribs,
// sleeve, drip lip). Materials and lighting are the caller's stages 3/4.
const parts = []
const add = (stage, geo, mat, pos, extra = {}) => parts.push({ stage, geo, mat, pos, ...extra })

// blockout — primary masses
add(0, G.plinthLo, 'paintFlat', [0, 0.06, 0], { receive: true })
add(0, G.bell, 'paint', [0, 0.2, 0])
add(0, G.column, 'paint', [0, 2.09, 0])
add(0, G.neck, 'paint', [0, 3.23, 0])
add(0, G.skirt, 'paintFlat', [0, 3.46, 0])
add(0, G.roof, 'paintFlat', [0, 4.2, 0])
add(0, G.spike, 'paint', [0, 4.76, 0])
// structure — hex cage, glass, eave, finial stack, second plinth disc
add(1, G.plinthHi, 'paintFlat', [0, 0.17, 0])
// Mullions sit ON the hex corners (CylinderGeometry puts corner k at k*60deg,
// first at +Z), half-sunk into the glass so the bright panel never slivers
// through them, and the lean is a composed yaw-then-tilt (YXZ) — an XYZ euler
// approximation twisted each bar slightly, which read as "bent" from above.
const _e = new THREE.Euler(), _q = new THREE.Quaternion()
for (let k = 0; k < 6; k++) {
  const a = (k / 6) * Math.PI * 2, r = 0.2325
  _q.setFromEuler(_e.set(-TILT, a, 0, 'YXZ'))
  const rot = new THREE.Euler().setFromQuaternion(_q, 'XYZ')
  add(1, G.mullion, 'paintFlat', [Math.sin(a) * r, CAGE_Y + CAGE_H / 2, Math.cos(a) * r],
    { rot: [rot.x, rot.y, rot.z] })
}
add(0, G.glass, 'glass', [0, CAGE_Y + CAGE_H / 2, 0], { cast: false })
add(1, G.eave, 'paintFlat', [0, 4.205, 0])
add(1, G.fCollar, 'paint', [0, 4.53, 0])
add(1, G.fKnob, 'paint', [0, 4.61, 0], { scale: [1, 0.8, 1] })
add(1, G.fNeck, 'paint', [0, 4.66, 0])
// form — beads, bell ribs, mid-band sleeve, drip lip
add(2, G.beadBig, 'paint', [0, 0.83, 0], { rot: [Math.PI / 2, 0, 0] })
add(2, G.beadMid, 'paint', [0, 2.16, 0], { rot: [Math.PI / 2, 0, 0] })
add(2, G.sleeve, 'paint', [0, 1.93, 0])
add(2, G.beadNeck, 'paint', [0, 3.1, 0], { rot: [Math.PI / 2, 0, 0] })
add(2, G.dripLip, 'paintFlat', [0, 3.6, 0])
for (let k = 0; k < 8; k++) {
  const a = (k / 8) * Math.PI * 2, r = 0.185, slope = 0.62
  add(2, G.bellRib, 'paintFlat', [Math.sin(a) * r, 0.42, Math.cos(a) * r],
    { rot: [Math.cos(a) * slope, a, -Math.sin(a) * slope], scale: [0.6, 0.42, 0.4] })
}

export const LAMP_TIP_Y = 4.86
export const LAMP_LIGHT_Y = CAGE_Y + CAGE_H / 2 + 0.06 // glass centre, slightly high like the reference hotspot
export const LAMP_COLORS = { paint: '#499d8c', glassTint: '#fff3dd', glow: '#ffc178' }

/** Part list for Props.jsx's instanceProp: [{geo, mat, pos, rot?, scale?, cast?, receive?, stage}]. */
export function lampParts(maxStage = 2) {
  return parts.filter((p) => p.stage <= maxStage)
}

/** Standalone Group factory (preview / skill deliverable — the game instances
 *  lampParts instead). stage: 0 blockout, 1 structure, 2 form, 3 material,
 *  4 lighting (emissive glass + real PointLight). */
export function createLampPostModel({ stage = 4 } = {}) {
  const real = stage >= 3
  const mats = {
    paint: new THREE.MeshStandardMaterial(real
      ? { color: LAMP_COLORS.paint, roughness: 0.38, metalness: 0 }
      : { color: '#9a9a9a', roughness: 0.7 }),
    glass: new THREE.MeshStandardMaterial(real
      ? {
          color: LAMP_COLORS.glassTint, roughness: 0.9, metalness: 0,
          emissive: new THREE.Color(LAMP_COLORS.glow), emissiveIntensity: stage >= 4 ? 1.1 : 0.0,
        }
      : { color: '#d8d8d8', roughness: 0.9 }),
  }
  mats.paintFlat = mats.paint.clone()
  mats.paintFlat.flatShading = true
  mats.paintFlat.roughness = real ? 0.42 : 0.7

  const root = new THREE.Group()
  root.name = 'TealVictorianLampPost'
  for (const p of lampParts(Math.min(stage, 2))) {
    const m = new THREE.Mesh(p.geo, mats[p.mat])
    m.position.set(...p.pos)
    if (p.rot) m.rotation.set(...p.rot)
    if (p.scale) m.scale.set(...p.scale)
    m.castShadow = p.cast !== false
    m.receiveShadow = !!p.receive
    root.add(m)
  }
  if (stage >= 4) {
    const light = new THREE.PointLight(LAMP_COLORS.glow, 10, 12, 2)
    light.position.set(0, LAMP_LIGHT_Y, 0)
    root.add(light)
  }
  root.userData.sculptRuntime = {
    sockets: { bannerMount: [0, 2.86, 0], lightSource: [0, LAMP_LIGHT_Y, 0], tip: [0, LAMP_TIP_Y, 0] },
    collider: { type: 'cylinder', radius: 0.44, height: LAMP_TIP_Y },
    lightEmitter: stage >= 4,
  }
  return root
}
