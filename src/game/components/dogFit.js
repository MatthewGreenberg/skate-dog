// The dachshund's fit numbers, split out of Dog.jsx because Rider and Player
// need them too and a component file may not export shared mutable state
// (react-refresh/only-export-components).
//
// The fit itself is still MEASURED off the bind pose in Dog.jsx — everything
// here only skews it.

import { create } from 'zustand'

export const TARGET_LENGTH = 1.12 // nose to tail tip before the editor's dog scale

// One reactive source of truth for every character consumer. The editor panel
// and Player subscribe directly; simulation/persistence use getState(). There
// is no mutable mirror and no version/bump channel to keep in sync.
export const useCharacterSize = create(() => ({
  dog: 1.58,
  boy: 1.58,
  long: 1.16,
  tall: 0.92,
}))
export const characterSize = () => useCharacterSize.getState()
export const CHARACTER_LIMITS = {
  dog: [0.9, 2.4],
  boy: [0.9, 2.4],
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Clamp each character independently. Their visual connection comes from the
 *  rider's planted-foot mount and size-aware pose offsets, never by silently
 *  changing the other character. */
export function clampedCharacterSizes(dog, boy) {
  const current = characterSize()
  dog = clamp(Number.isFinite(dog) ? dog : current.dog, ...CHARACTER_LIMITS.dog)
  boy = clamp(Number.isFinite(boy) ? boy : current.boy, ...CHARACTER_LIMITS.boy)
  return { dog, boy }
}

export function applyCharacterSizes(dog, boy) {
  const pair = clampedCharacterSizes(dog, boy)
  useCharacterSize.setState(pair)
  return pair
}

export function setDogProportions(long, tall) {
  useCharacterSize.setState({ long, tall })
}

// Limbs shrink toward their hips. Not a slider: the limb scales are set once on
// the bones (setBone only writes quaternions, so they survive the frame loop),
// and nothing anyone means by "size" is in here. Shortening a leg about the hip
// raises the paw off the bind-pose floor, so the body drops by the same amount:
// the bind-pose hips sit at y 0.163 (front) / 0.184 (rear) with the paws at
// 0.008, so the leg is 0.166.
export const LEG = 0.78
export const LEG_DROP = 0.166 * (1 - LEG)

// Where the rider's feet go. The model is authored exactly 1.0 long and its
// skinned rest bounds top out at 0.293 between the shoulders and the hips, so
// the back scales with the fit; the feet then sink 0.02 into the coat rather
// than hovering on it. A function, not a constant, because `tall` is a slider —
// the rider has to follow the back down when the dog is squashed.
export const backY = (dogSize = characterSize().dog, tall = characterSize().tall) =>
  ((0.293 - LEG_DROP) * tall * TARGET_LENGTH - 0.02) * dogSize

/** Rendered nose-to-tail length, used by curved-surface clearance. */
export const dogLength = () => {
  const { dog, long } = characterSize()
  return TARGET_LENGTH * long * dog
}
