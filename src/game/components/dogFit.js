// The dachshund's fit numbers, split out of Dog.jsx because Rider and Player
// need them too and a component file may not export shared mutable state
// (react-refresh/only-export-components).
//
// The fit itself is still MEASURED off the bind pose in Dog.jsx — everything
// here only skews it.

export const TARGET_LENGTH = 1.12 // nose to tail tip in parent units

// Dachshund bias. `long` stretches the model's length axis, `tall` squashes its
// height. Both are LIVE: the "Dog size" leva folder in Player.jsx writes them.
// Mutable, not React state, for the same reason P is — the fit group and the
// rider's foot height both read them in the frame loop, so one slider moves
// both rigs without re-rendering either.
export const SIZE = { long: 1.16, tall: 0.92 }

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
export const backY = () => (0.293 - LEG_DROP) * SIZE.tall * TARGET_LENGTH - 0.02
