/**
 * Live knobs for the "Foliage" leva folder.
 *
 * Its own module for the same reason dogFit.js is one: a component file may not
 * export shared mutable state under react-refresh, and BOTH Props.jsx (geometry)
 * and level/foliage.js (colour + distribution) read these.
 *
 * Defaults are the shipped values, so an untouched panel renders the committed
 * art exactly. Tune here, then bake the winners back into palette.js /
 * foliage.js / Props.jsx — the panel is a search tool, not the source of truth.
 *
 * Nothing here is read per frame. The park bakes its InstancedMeshes once and
 * sets matrixWorldAutoUpdate = false, so a knob change cannot be a uniform
 * write — it has to REBUILD the rows. `bumpFoliage()` is that rebuild signal:
 * Trees/Shrubs/Planters subscribe to it and re-run their useMemo, which is the
 * same "a remount IS the reset" trick the runId bump uses for Bones/Letters.
 */
import { C } from './palette.js'

export const F = {
  // bed blade — leafBlade()'s defaults. T is the sleeper: bake() reads the aim
  // in YXZ with the roll slot 0, so a blade's width axis is always horizontal
  // and half of every rosette presents its SECTION to the camera. At T 0.30
  // that section is 8.4:1 and the bed reads as needles.
  bladeW: 0.532,
  bladeL: 2.55,
  bladeT: 0.42,
  // tree crown blade — its own geometry on purpose. Sharing the bed's pad made
  // the crowns read as green jellybeans on a stick at chase distance.
  crownW: 0.62,
  crownL: 2.79,
  crownT: 0.06,
  // albedo under white light — do NOT pre-warm these, the light rig is already
  // key + ambient ~= white. See the palette contract in CLAUDE.md.
  leafLight: C.leafLight,
  leaf: C.leaf,
  leafDark: C.leafDark,
  shrub: C.shrub,
  flowerYellow: C.flowerYellow,
  flowerPink: C.flowerPink,
  flowerWhite: C.flowerWhite,
  // ramp shaping. sunFace is the key-bearing term that gives a mass a light
  // side and a dark side; over ~0.25 the lit clumps all clamp to the top stop
  // and read as bright blobs stamped on a dark crown.
  sunFace: 0.22,
  shadeLift: 0.04,
  bedLift: 0.24,
  // bed density multiplier. Bare fraction goes as exp(-fill), so small moves
  // here swing visible soil a lot.
  bedFill: 1,
}

let version = 0
const subs = new Set()

export const foliageVersion = () => version
export const subscribeFoliage = (fn) => {
  subs.add(fn)
  return () => subs.delete(fn)
}
export function bumpFoliage() {
  version++
  subs.forEach((fn) => fn())
}
