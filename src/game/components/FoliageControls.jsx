// The "foliage" leva folder. Its own component and its own PATH: two
// useControls on the same path is a duplicate-key clash, which is why Dog.jsx's
// coat and Player.jsx's size folders are split the same way.
//
// Every knob writes into foliageKnobs.F and then calls bumpFoliage(), which
// re-runs Trees/Shrubs/Planters' useMemo. That is a full regeneration of every
// plant in the park — the park bakes its InstancedMeshes once and turns off
// matrixWorldAutoUpdate, so there is no cheaper path for a blade dimension or a
// ramp stop. Hence the coarse `step` on every numeric knob: leva fires per tick
// and a fine step would regenerate the park a hundred times across one sweep.
//
// Defaults mirror the shipped art exactly, so an untouched panel renders what is
// committed. These are a SEARCH TOOL — bake a winner back into palette.js /
// foliage.js / Props.jsx with the measurement that justified it, the way every
// other number in this codebase carries its reason.
import { useEffect } from 'react'
import { useControls, folder } from 'leva'
import { F, bumpFoliage } from '../foliageKnobs.js'

const D = { ...F } // shipped values, captured before any knob can move them

export default function FoliageControls() {
  const knobs = useControls('foliage', {
    'bed blade': folder(
      {
        bladeW: { value: D.bladeW, min: 0.15, max: 1.2, step: 0.004, label: 'width' },
        bladeL: { value: D.bladeL, min: 1, max: 4, step: 0.01, label: 'length' },
        // thickness is the sleeper knob: half of every rosette presents its
        // SECTION to the camera (bake reads YXZ with the roll slot 0), so this
        // sets how needle-like the bed reads more than width does
        bladeT: { value: D.bladeT, min: 0.08, max: 0.9, step: 0.004, label: 'thickness' },
      },
      { collapsed: true },
    ),
    'crown blade': folder(
      {
        crownW: { value: D.crownW, min: 0.12, max: 0.9, step: 0.004, label: 'width' },
        crownL: { value: D.crownL, min: 1, max: 4, step: 0.01, label: 'length' },
        crownT: { value: D.crownT, min: 0.06, max: 0.7, step: 0.004, label: 'thickness' },
      },
      { collapsed: true },
    ),
    greens: folder(
      {
        // albedo under white light. If a leaf renders too warm the LIGHT is
        // wrong, not the paint — see the palette contract in CLAUDE.md.
        leafLight: { value: D.leafLight, label: 'lit tip' },
        leaf: { value: D.leaf, label: 'crown mid' },
        shrub: { value: D.shrub, label: 'bed mid' },
        leafDark: { value: D.leafDark, label: 'shade' },
      },
      { collapsed: true },
    ),
    flowers: folder(
      {
        flowerYellow: { value: D.flowerYellow, label: 'yellow knot' },
        flowerWhite: { value: D.flowerWhite, label: 'white daisy' },
        flowerPink: { value: D.flowerPink, label: 'pink daisy' },
      },
      { collapsed: true },
    ),
    ramp: folder(
      {
        // over ~0.25 the sunlit clumps all clamp to the top stop and read as
        // bright blobs stamped on a dark crown
        sunFace: { value: D.sunFace, min: 0, max: 0.4, step: 0.005, label: 'sun bearing' },
        shadeLift: { value: D.shadeLift, min: 0, max: 0.4, step: 0.005, label: 'crown floor' },
        bedLift: { value: D.bedLift, min: 0, max: 0.6, step: 0.005, label: 'bed floor' },
        // bare fraction goes as exp(-fill), so this swings visible soil fast
        bedFill: { value: D.bedFill, min: 0.5, max: 2, step: 0.01, label: 'bed fill' },
      },
      { collapsed: true },
    ),
  })

  // Keyed on the VALUES, not on the object: leva hands back a fresh object every
  // render, so depending on it would regenerate the park on every unrelated
  // re-render of this component.
  const key = JSON.stringify(knobs)
  useEffect(() => {
    Object.assign(F, knobs)
    bumpFoliage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return null
}
