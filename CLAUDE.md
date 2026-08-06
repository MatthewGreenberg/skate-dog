# Skate Dog

React 19 + @react-three/fiber + three.js browser game. A boy rides a dachshund
through a pastel skatepark. The park is entirely procedural — no image files, no
network fetches. Textures are painted into canvases at load, geometry is built in
code, props and foliage are baked into InstancedMeshes once and never touched.

The assets are `public/boy.glb` (the rider) and `public/dog_compressed.glb` (the
dachshund he rides). Neither ships
animation clips: the boy and dog are driven every frame by authored pose tables,
so they react to the sim rather than playing a loop — see `player/boneRig.js`
for what that costs.

The dog is Draco + KTX2 compressed; the boy is Draco only (his
textures total ~0.7MB — all 33MB of him was geometry). All pass `/draco/` to
`useGLTF`.
The decoders are copied out of
`three/examples/jsm/libs` into `public/draco` and `public/basis` — drei's
default draco path is a gstatic CDN, and nothing here fetches over the network
(the shoot harness least of all).

## Layout

```
src/game/
  palette.js          art-direction contract — C (albedo), M (roughness), LIGHT, TONE, RAMP
  photo.js            deterministic capture poses (see "Seeing your changes")
  store.js            useGame = UI state; P = per-frame state (never React state)
  level/
    levelData.js      authored layout. Single source of truth: renderer AND colliders read it.
                      hpN/hpS are a halfpipe (two facing quarters, HP_FLAT 3.2m
                      of flat, HP_H 2.0 walls — a 2.4m run puts the lip at
                      ~80deg; h == the run would be dead vertical and the arc
                      degenerate. All the z geometry hangs off the centre 24.5
                      so the flat can be retuned in one place)
                      on a raised 0.35 platform (hpDeck, under STEP_UP so you
                      roll straight on) in the south-west corner. All four hp
                      boxes carry style 'solid' and the quarters' width (12):
                      Skatepark renders 'solid' as a pale blue sheet riding
                      surface (hpSurfMap; buildRampGeometry group 0 = surface,
                      group 1 = skirts/back, and hpDeck's box +Y face) over
                      birch plywood structure (woodMap / woodNormal, RAMP.wood
                      stops) — SolidSlab uses texBox, not RoundedBox, because
                      RoundedBox's extruded-shape UVs put the flat's planks 90
                      degrees off the riding direction. At the old w:9 masonry
                      the structure read as a walled courtyard, not a
                      halfpipe. hpDeckN/S are top decks behind the coping — a
                      freestanding quarter is zero-thickness at its lip, and a
                      dog cresting slowly straddled it with half its body out
                      the back face; no rig lift can fix "the surface ends
                      here". The ramp collider's 1m top overhang hands off to
                      them seamlessly. sampleSurface returns analytic arc
                      curvature (out.curv, 1/R on quarters) so the rig's
                      clearance lift is exact and instant instead of measured
                      a frame late.
                      deckA's north/east and deckB's east walls are THICK (3m)
                      on purpose: they run flush out to the kerb. At the old
                      1.2 they left a 1.6m blind alley between their outer face
                      and the kerb masonry, wrapping deckA's NE corner as an L
                      — a tight nothing-space you rolled into and got stuck in.
                      Inner faces are unmoved, so nothing inside the park
                      changed. A collider face at the play edge means probes
                      OUTSIDE the clamp; collision.check.js skips those
                      (`inPlay`) because brute force has no clamp and
                      "resolves" them out into the grass.
                      The halfpipe's run-in is kept clear: the planters that
                      used to sit at (-26,8) and (-34,16) stood in the only
                      approach lane and made every entry a slalom. Their
                      replacement at (-35.5,24.5), alongside the pipe against
                      the west kerb, was removed by request too — the pipe's
                      corner is empty. Don't put props back there.
                      The perimeter tree/shrub ring ellipses dip INSIDE the
                      rectangular play area at its corners — HP_CLEAR keeps
                      them out of the halfpipe, and TREES also drops any ring
                      tree landing inside PERIMETER (no lone trees in the
                      plaza; trees live in the ring or a planter bed). Shrubs
                      may still dip in — that's ground cover, not trees. The plaza centre was
                      deliberately opened up — ledge2, ledge3 and the two mid
                      planters are gone, r1/r4/r2 run longer instead. Don't
                      refill the middle with props.
    rails.js          grind paths. RAILS are the drawn tubes; every wall cap,
                      planter rim and BENCH SEAT is ALSO a path, derived here
                      from the same boxes (`wallcap*_a/b` / `planter*_*` /
                      `bench*`, 96 of them): both
                      top EDGES of a cap, not its centreline — you grind a lip
                      with the dog hanging over the face, and a centreline put
                      it in the middle of the structure. Offsets are measured
                      off the DRAWN stone (cap = w + 0.18, planter rim =
                      p.w + 0.24), not the collider box, and a wall cap's top
                      is `w.h` absolutely — `base` does not add. Nothing new
                      is drawn — Skatepark still renders only RAILS — and
                      findGrind's dy window (0.75 up / 0.45 down) is what stops
                      a cap 0.95 overhead from grabbing you as you roll past.
                      Planter rims are four separate runs, not a loop: a loop
                      snaps the heading 90 degrees at each corner. A bench is
                      ONE run along the FRONT edge of the seat only — the back
                      edge sits under the backrest slats, so a path there
                      grinds the dog through them — measured off Props' seat
                      slats (top 0.4625, front face at local z 0.335) plus the
                      row's `base`, and trimmed only 0.15 a side because a
                      1.72m seat trimmed 0.35 is barely a lock-on at 13 m/s.
                      Benches are not colliders, so nothing had to change to
                      let you roll onto one.
    decals.js         floor detail — a skating-dog mascot, candy-colour paw
                      trails, rainbow skids, landing bursts, drains, flower
                      weeds, confetti, party chalk and sticker bombs in clusters
                      over the open plaza. They are NOT baked into plazaMap and
                      that is the whole reason this file exists: the plaza map
                      tiles every 8m over a ~70m park, so a drain painted into
                      it is ~120 drains on a perfect grid. These are scattered
                      in WORLD space as quads reading cells out of textures.js's
                      `decalAtlas` (4x4, transparent GUTTER because mipping
                      averages across cell borders and bleeds a neighbour's
                      paint into every edge). One MERGED BufferGeometry, one draw
                      call, ~350 tris — deliberately not an InstancedMesh, since
                      instancing an atlas needs a per-instance uv-offset
                      attribute and an onBeforeCompile to consume it, which at
                      this triangle count buys nothing. Per-decal fade rides on
                      vertex ALPHA (the colour attribute is itemSize 4, so three
                      reads vColor as a vec4): scaling RGB instead would render a
                      faint chalk mark as a DARK chalk mark. Character cells use
                      confident pastel inks and high per-instance fade; drains,
                      weeds and grit stay subdued. Transparent breathing room,
                      chalk wobble and worn cutouts keep the brighter marks from
                      reading as square sprites pasted over the render.
                      The marks are drawn CUTE and deliberately so: paw pads are
                      HEARTS, weeds carry tiny daisies (the flower bed's own
                      language for "this is alive" — a bare green spike is
                      neglect), the chalk is a dachshund face and a wobbling
                      party dog, rainbow, wheel badge and wobbling hopscotch;
                      sticker bombs mix a BONE, STAR, HEART and lightning bolt.
                      `heartPath`/`starPath`/`bonePath`/
                      `chalkLine` are the shape kit; chalkLine walks a polyline
                      TWICE with a wobble, because chalk never closes a
                      rectangle and a crisp stroked rect reads as a UI element
                      lying on the floor. Intricacy is second-order detail that
                      survives the fade: tread ribs cut ACROSS the rainbow skid,
                      claw ticks pass each toe, a leaf catches on the drain, and
                      grit has contact shadows and lit tops so it sits ON the
                      slab. Character cells are weighted and scaled UP in
                      decals.js KINDS, while utilitarian marks are punctuation.
                      Placement is `groundHeightAt` and nothing else: every
                      sample must land within 0.02 of y=0, so the existing
                      collider tree is the single source of what a decal may sit
                      on and there is no second footprint table to drift. Two
                      things that shipped broken and are asserted now: the
                      footprint is sampled as a GRID at 0.35m, not at four
                      corners (a 0.95m planter fits neatly between two corner
                      samples of a 2m quad, putting a chalk drawing up its side),
                      and the perimeter test adds the quad's HALF-DIAGONAL to the
                      margin (the test is on the centre, but the quad is what has
                      to stay in bounds — a 3.4m dirt patch hung over the kerb).
                      Cluster CENTRES reroll until they land on open floor, or
                      the clusters that open on a deck lose every member and the
                      park quietly ends up with a third of its decals. The
                      scatter is cached by `fixedDecalGeometry()`, so placing or
                      moving a piece never rearranges the floor art. Pool edits
                      run `poolSafeDecalGeometry()` over that fixed source and
                      hide any whole doodle whose bounding circle could touch
                      the pool; they never relocate it or leave art over water.
                      Skatepark's `Decals` sits the mesh 6mm up, transparent with
                      depthWrite off — not alphaTest, which stencils a hard edge
                      onto every soft chalk line, and depthWrite off is also what
                      lets quads inside a cluster blend instead of z-fighting on
                      a shared plane. polygonOffset alone still fights at the
                      grazing angle this floor is seen at for the whole run.
    colliders.js      simplified collision built from levelData
    parkGeometry.js   plaza / grass / ramp meshes
    bowlGeometry.js   analytic bowl — the drawn surface IS the ridden surface
    textures.js       every procedural map: albedo, normal, roughness, baked AO.
                      The PLAZA is the one surface drawn at double everyone
                      else's resolution (albedo 2048, normal/rough 1024 = 256
                      px/m over PLAZA_TILE 8): it is the only thing the camera
                      sees at a grazing angle for the entire run. Resolution is
                      not a free knob here — every PIXEL-unit constant moves
                      with it. grain() counts go with AREA (x4), canvas
                      `blur(Npx)` doubles, lineWidths double (or a 1cm crack
                      becomes 2cm). normalFrom's sobel is a FIXED 3px kernel, so
                      at 2x res it reads a half-width slope — but do NOT raise
                      the strength to compensate. That was tried (0.55 -> 1.1)
                      and the paver pad is a roundRect with a soft shoulder, so
                      it turned that shoulder into a bright BEVEL RING inset
                      from every paver edge: a white outline drawn inside all
                      121 tiles of the floor. The shallower normal is the
                      correct read — the joints are meant to be hard to find.
                      crack()'s wander is `steps x len`: doubling
                      STEPS at the same len is the HD move (same world length,
                      finer segments); doubling LEN just makes a longer crack.
                      Scuff (skid smears — wide, soft, neutral-dark, drawn OVER
                      the grain) and MOSS live in plazaMap only. Moss is seeded
                      ON a joint — one axis snapped to the paver grid, elongated
                      along it, blurred — because moss creeps out of a joint and
                      a hard-edged green blob in the middle of a slab reads as
                      paint. Neither is in plazaRough yet; moss is matte and a
                      skid is polished, so that is the next thing to add if the
                      floor reads uniformly specular in a capture.
                      dogNormal/dogRough are the dog's coat — one fibre height
                      field (short strokes curled by a low-frequency noise
                      field, so the coat gets partings instead of a combed grid
                      that moires at chase distance) sobelled into a normal and
                      remapped into a roughness, so the crest the normal bumps
                      up is the crest the roughness makes glossier. Strokes near
                      a tile edge are redrawn wrapped — only the wraps that can
                      reach, since drawing all nine doubles the alpha of every
                      interior stroke. They ride the ALBEDO's uv channel, which
                      is Tripo's arbitrary atlas; at FUR_TILE 7 the strands are
                      sub-millimetre and read as surface, not as a hairstyle,
                      and an island seam is a direction change, not a line.
    foliage.js        plant generation, pure data -> instance rows. Trees,
                      shrubs and planters are baked ONE InstancedMesh set PER
                      24m CELL (Props.jsx `byCell`), not one for the park, and
                      that is the entire frustum-culling story — there is no
                      culling code. three culls an InstancedMesh by its own
                      boundingSphere, computed off the instance matrices, so
                      80 trees in one mesh had a sphere covering the whole park
                      and every crown triangle was submitted every frame, main
                      pass and shadow pass both. 80 trees -> 19 cells, 44
                      shrubs -> 8, 12 planters -> 10; ~140 foliage draw calls if
                      every cell were visible, and the chase lens is 20.5deg so
                      typically 3-5 tree cells are. Draw calls were never the
                      bottleneck; triangles were. `byCell` carries each item's
                      ORIGINAL index because every seed here is `base + i*stride`
                      — regrouping the list must not renumber it, or the whole
                      park re-randomises. There is deliberately no LOD: with
                      cells the visible crown load is ~0.7M tris and a second
                      geometry tier would be speculative. There are
                      TWO leaf buckets and they are two GEOMETRIES on purpose:
                      `foliage` (beds + bushes, Props.jsx `LEAF`) and `crown`
                      (trees, `CROWN_LEAF`). They share the material, so it is
                      one extra draw call, not a second wind program. The bed's
                      blade is a fleshy succulent PAD and is signed off; the
                      tree's is thin and pointed, because a 3.2:1 pad rounded at
                      BOTH ends reads as a green jellybean stuck on a stick at
                      chase distance — which is what the trees were. CROWN_LEAF
                      is W 0.32 / L 2.55 / T 0.26 over CROWN_PROFILE (lanceolate:
                      widest at 0.46, then a long taper to a real POINT — 0.72 of
                      max width at t=0.75 closing over the last QUARTER, a 20deg
                      half-angle, against the pad's 0.62 over 10% = 52deg, which
                      renders as a rounded cap). Mean aspect 6.0:1 against the
                      pad's 3.2:1 (4.0:1 at the crest), 5 stations x a 4-ring =
                      32 tris against the pad's 7 x 6 = 72. The crown's ring and
                      station count are a PERF cut and the two arguments the pad
                      makes against them are close-up arguments: the 6-gon
                      section exists to kill a specular crease line, and the
                      0.1/0.5 base station is a flare buried inside its own
                      clump — at 0.32 wide seen from 15m+ a crown blade's tris
                      are already sub-pixel and neither resolves. The shape
                      stations (0.46 shoulder, 0.75 taper) are untouched,
                      because the lanceolate point IS the read.
                      Do NOT unify the two blades — the direction asked for is
                      the opposite. Thin costs coverage: a blade's plan
                      footprint is (mean width x length x r^2) and bare fraction
                      goes as exp(-f), so 0.53x the width was paid back with
                      massClumps x1.61 + clumpR x1.08 (r is free — it is an
                      instance scale, not a triangle, and LONGER is not a
                      regression here: a long narrow blade is more leaf-like, a
                      wider one is the jellybean). Net n*w*l holds to within 1%
                      per mass. Then a straight PERFORMANCE trim ran that same
                      trade BACKWARDS across all three species — massClumps
                      x0.72, clumpR x1.18 (n*r^2 = 1.002, coverage held, since
                      the blade is a fixed shape scaled by r) — because 122k
                      crown rows at 60 tris was 7.3M triangles, ~80% of all
                      foliage in the park. With the 32-tri crown blade above:
                      88k rows / 2.8M tris, and the park total 9.1M -> 4.6M in
                      the same two draw calls. Every species' `bloom.per` is per
                      LEAF ROW, so all three divide by 0.72 to hold the speckle.
                      The cost is a coarser dome — clumpR is now 1.27x its
                      pre-thinning value, so if the crowns read as faceted
                      boulders again that is the number that did it; take it
                      back and pay in count. `tools/` has no triangle census;
                      the numbers here are newBuckets + pushTree/pushBush/
                      pushBed over levelData, times tris-per-bucket-geometry. leafMass's jitter cone also RAMPS
                      DOWN at the rim (0.34 -> 0.24 at edge 1): the cone is the
                      only thing that can throw a blade past the crown envelope,
                      and a 40%-narrower stray reads as debris where a pad read
                      as foliage. Measured: crown edge density +30/33/43% on the
                      three visible crowns, and the dome did not open. Every
                      species' `bloom.per` is per LEAF ROW, so it divides by 1.45
                      against the x1.61 count — a deliberate +11% net on the pink
                      speckle, since a narrower leaf hides less of the head. A foliage
                      instance is a LEAF BLADE, not a ball: Props.jsx's
                      `leafBlade` is a succulent PADDLE centred on the
                      origin running along +Y (7 stations x a 6-point ring = 72
                      tris; both ends pinch, so it needs no caps). PROFILE is a
                      lens: convex on both edges, widest at HALF its length, and
                      blunt — the last station still carries 62% of max width, so
                      the tip closes as a 52deg cone and renders as a rounded cap.
                      The spear it replaced (widest at a fifth of the length,
                      straight edges, a point) read as agave/yucca and spiked the
                      bed silhouette against the pale paving. The ring is 6,
                      not 4, and that is the difference between a succulent pad
                      and a QUARTZ SHARD: a 4-gon section is a rhombus, so the
                      blade carries a hard crease down its spine where two faces
                      meet at ~50deg, and smooth vertex normals only turn that
                      into a hard specular LINE. A 6-gon meets at 120deg. It is
                      also PHASED half a step (RING_PHASE): at phase 0 no vertex
                      lands on the crest, so the top of the lens is a flat facet
                      running the whole length — the one hard longitudinal crease
                      every blade used to show. Phase 30deg puts a vertex on the
                      crest and straddles the margin with the pair that used to
                      sit on the width axis, which also rolls the leaf EDGE
                      instead of leaving it a knife; RING_K divides the resulting
                      cos(30) back out or the silhouette quietly narrows.
                      PROFILE is a true LANCEOLATE: ~35% of max width at the base,
                      one crest at 45%, then a long taper over the whole top half
                      through 18% at t=0.94 to a real POINT. It used to be 78% of
                      max by t=0.16 and still 60% at t=0.93, which is a
                      PARALLEL-SIDED CAPSULE with two rounded caps — at play
                      distance the lawn crowns rendered as bottlebrush / hop
                      cones. The two stations in the last 12% are what makes the
                      tip converge as a blunt point rather than a chamfered cut.
                      It is BROAD and FLESHY, and both of those are measured, not
                      taste: 2.18:1 at max width but 3.28:1 as a mean (PROFILE's
                      area is 0.664 of its bounding box), which is what the eye
                      integrates at play distance and is the top half of the
                      reference's 2.5-3.5:1 band. Do NOT narrow W to fix a bed
                      that looks fat — that is a profile problem, and narrowing
                      gives you the rosemary W exists to prevent. T (0.42 against
                      W 0.585, ratio held at 1.33) matters MORE than
                      W does, because the roll slot is 0 and so a blade's width
                      axis is always horizontal and perpendicular to its own
                      bearing — half of any rosette therefore presents its
                      SECTION to the camera, and at the old T 0.3 that section
                      was 8.4:1 and read as a spike stuck through the plant.
                      Every
                      plant in the reference is a rosette of pointed leaves and
                      no amount of lumping makes a sphere read as one; the
                      long-running "canopy reads as a faceted boulder" fight was
                      a sphere problem. So a clump is AIMED: `clump()` takes the
                      outward vector of the mass or rosette it belongs to and
                      writes it into the same two slots a branch uses. Slot 8
                      (roll) stays 0 on every foliage row for the same reason it
                      does on a branch — bake() reads YXZ, which applies Z
                      FIRST, so a roll swings the blade's own long axis off the
                      aim. Per-leaf variety is a jitter CONE about the aim.
                      A shrub lobe's aim is lifted (|oy| + lr*0.75) because an
                      outward-only aim drives the lower half's tips into the
                      paving. A CANOPY mass is not aimed outward at all any more:
                      a blade along the mass's own radial presents its TIP to the
                      silhouette, and a dome of those is a PIN-CUSHION — the lawn
                      crowns rendered as a ring of blunt bullet-ends pointing
                      radially out. leafMass builds a tangent frame on the radial
                      and swings the aim 55-70deg off the normal into it, with a
                      downward hang, so the dome edge is a scallop of
                      overlapping leaf TIPS lying across the surface. That hang
                      RAMPS WITH `edge` (0.26 in the middle, 0.88 at the rim)
                      rather than being flat: a flat 0.26 is ~15deg, and 15deg
                      off tangential is a TUFT — the only blades whose tips
                      clear the silhouette are the outer ones, and those were
                      the ones lying flattest, so the dome rim read as a
                      horizontal fringe with no drop. Measured after: tip pitch
                      below horizontal p10 -6deg / median 39 / p90 59, and the
                      lowest blade tip in the park sits 0.42 over its own soil.
                      Interior blades keep the shallow hang deliberately —
                      droop a fill blade and it just points at the trunk. The
                      underside easing knee moved -0.2 -> -0.75 with it, or it
                      caught nearly every rim blade and squashed the droop
                      straight back out; foliage.check's crown floor reads a
                      row's centre and radius and CANNOT see an aim, so that
                      knee is the only thing keeping the skirt off the ground. Two
                      consequences, both paid for: an underside blade's aim is
                      eased back toward level below -0.2 or its tip hangs a full
                      length under the row the checks measure the crown floor
                      from; and a tangential blade covers far LESS solid angle
                      than a radial one, so massClumps went UP half again (to
                      ~48) and clumpR down 0.84x with it — at the old count the
                      first tangential capture came back as lace with daylight
                      between every leaf.
                      A bed's body is a field of COUNTABLE ROSETTES on a
                      JITTERED GRID, and the grid is the point: 11 blades round
                      one shared centre was already true when the beds still read
                      as chopped foliage, because the CENTRES were a Poisson
                      scatter and at closing density two land 0.2 radii apart as
                      often as 1.5, so a third of the stars fused. The
                      reference's readability comes from the GAPS. Pitch is
                      `gap` (2.9) x a rosette's plan reach — PAST the 1.41 a
                      square grid of discs closes at, on purpose, so the rosettes
                      do not tile and a dark valley survives between neighbours.
                      **The bed is not supposed to close.** The reference shows
                      soil-dark wedges between plants and that is what makes them
                      countable, so the plan target is ~92% mean / 87% worst, not
                      solid. Measured across foliage.check's 60 beds: gap 2.0 ->
                      99.9%, 2.3 -> 97.9, 2.6 -> 95.9, 2.9 -> 91.6, 3.2 -> 89.2
                      and the soil starts reading as patches rather than wedges.
                      Jitter is +/-9% of pitch;
                      more and it is a scatter again. 10 blades leave ONE shared
                      centre (OFF_R 0.14 — at 0.4 each base sat a third of a
                      radius out along its own bearing and the rosette had a hole
                      where its centre should be), splayed 45-75deg off vertical
                      (`splay` = tan, 1.0 + t^2*2.55 across the whorl, so the star
                      has a crown and a skirt). The FINE layer is now thin
                      (fineF 1.35, was 2.6): its job is to stop soil showing
                      THROUGH a plant, not to fill the space BETWEEN two of them,
                      and at 2.6 it was standing in every valley the grid opens.
                      foliage.check.js's bed raster models a blade as a plan
                      CAPSULE — project the row's aimed segment (-0.42L to +0.58L
                      of its scaled length) onto the ground, give it the blade's
                      half-width. The old single-number disc model (LEAF_EFF)
                      broke twice, because it cannot see where a blade points:
                      don't reintroduce it.
                      The bed's height ramp is tuned for RANGE at fixed MEAN:
                      0.20 + 0.58q has the same mean (0.45 over a rectangle's q)
                      as the old 0.28 + 0.40q and a range of 0.79 instead of
                      0.55, which is what reaches lime at the crest and a real
                      mid-green in the valleys. Do not lift the base instead —
                      the medians already match the reference.
                      Every species has a `core`: one leafMass over the crown's
                      own centre. A crown is a DOME, not N balls on sticks —
                      every other mass hangs off a branch, so the cone of air
                      directly over the fork was only ever closed by `fill`, and
                      from the 40deg camera you saw trunk and paving straight up
                      through the middle. leafMass squashes y by 0.82 on its own,
                      so a core renders 1.22 wide for 1 tall. Branch-tip masses
                      are also pulled 12% back down the shaft (TIP_IN): centred
                      ON the tip, a mass puts its outer clumps a full radius
                      beyond any wood and the ones that clear the silhouette read
                      as detached specks floating beside the tree.
                      A PLANTER tree is `pushTree(..., 'blossom')` BY NAME. Left
                      to the random draw it took a lawn species two thirds of the
                      time, and a 2.5-3.4m trunk in a 1.4m planter renders as a
                      cone on a pole.
                      White and pink blooms are 5-petal daisies (`daisy`) rather
                      than spheres, and the pip is a YELLOW EYE — most of what
                      separates a daisy from a blob of cream at chase distance.
                      It rides a vertex-colour attribute rather than a second
                      bucket, because instanceColor and vertexColor BOTH multiply
                      the material base: the pip carries the ratio
                      flowerYellow/flowerWhite, taken against WHITE deliberately,
                      so the white daisy lands on the exact yellow and the pink
                      one gets the same eye a stop warmer. MAT.flowerWhite/Pink
                      therefore need `vertexColors: true` and the yellow bucket
                      (which has no colour attribute) must NOT have it.
                      YELLOW is not a daisy: it is `budCluster`, a knot of four
                      two-thirds-overlapping beads plus a crown bead, and it is
                      the bed's DOMINANT flower (82% of clusters) because that is
                      what the reference reads as from across the plaza. Three
                      things about it are load-bearing. The bead ring radius is
                      well UNDER the bead radius, so the beads fuse into a lumpy
                      ball — where they merely kissed, the knot rendered as a
                      CORN COB from the 40deg camera, and six beads read as a
                      ridged cylinder however they were spaced (four beads at 6x4
                      segments is both rounder and cheaper). pushBlooms' own
                      scatter for the yellow tint is 0.055, not the daisies' 0.22:
                      the knot shape is the geometry's job, and a wide scatter put
                      two heads side by side as a sausage. And the albedo is a
                      saturated GOLD (`flowerYellow` hsl 48/90/52): #f7dc8c was a
                      cream, which on lime renders as a bleached patch rather than
                      a flower, and hsl 50/88/58 was still pale popcorn sitting a
                      stop ABOVE the lit leaf — it has to read as a different
                      material from the leaf, not a brighter version of it.
                      There is no LILAC in the bed. The pale pink heads went from
                      14% of bed clusters to 4%: against the lavender planter rim
                      they read as lilac popcorn, a colour the reference does not
                      contain, and they outnumbered the yellow it leads with. Pink
                      belongs on the TREE, where it sits against green.
                      EVERY species carries a `bloom` table that
                      speckles pink over the crown by SAMPLING the leaf rows
                      that tree just emitted — solving a crown radius and
                      scattering over the sphere puts a third of them in mid-air,
                      because a crown built from masses is not a sphere. It used
                      to be `blossom` only, and since both the lawn trees and the
                      planter tree drew their species at random that meant two
                      thirds of the park's crowns had no speckle at all.
  goals.js            the run's challenge table (see "The run" below)
  components/         Game (canvas + post), Lighting, Skatepark, Props, Player, Effects, UI
                      ui.css had an upper-frame atmospheric haze on
                      `.hud::before` (a screen-space FOG_COLOR gradient); it was
                      REMOVED by request and the sky reads clean. Do not bring
                      it back via three's Fog — that is keyed on DEPTH and the
                      top of a chase frame is sky and far park at every depth,
                      so hazing the sky veils the hero too.
                      Intro.jsx = the SKATE DOG title as troika text (drei
                      <Text>) floating in the park, billboarded to the camera.
                      Its font is served from public/fonts — troika's default
                      fontURL is a gstatic CDN and nothing here fetches over the
                      network. One reveal clock drives everything: P.intro goes
                      1 -> 0 over 1.5s from GameLoop on start, CameraController
                      smoothsteps between the title orbit (radius 13, height
                      +8.6 — ~27deg down, part way to the chase rig's 40 rather
                      than the near-eye-level 10 it started at, so the reveal is
                      a drop and a pull-back instead of only a pull-back) and the
                      chase rig, while the title gives a small press-response
                      pop and dissipates diagonally into one instanced field of
                      cream, gold, and purple flecks. The solid SDF text fades
                      and contracts under that field; the flecks scale to zero
                      individually, so the dissolve adds only one draw call and
                      needs no per-particle opacity materials.
                      The START FRAME is composed as three claims on the frame,
                      and nothing in it is placed in metres-above-the-dog any
                      more: the TITLE takes the centre, the challenges card the
                      upper right (DOM), and the DOG is pushed middle-left out of
                      both. Each is anchored independently, which is the point —
                      the title used to hang off P.pos, so the aim offset that
                      slid the dog out from under the PLAY button dragged the
                      title off the frame with it.
                        - Title (Intro.jsx): anchored at the frame's CENTRE at
                          the dog's depth (walk out along the camera's own
                          forward), then offset by UP 0.06 of frame height —
                          optical, since PLAY and the key legend weight the
                          bottom. It scales to MAX_W 0.42 of frame width via
                          viewport.getCurrentViewport, which replaces an old
                          min(1, aspect) fudge: it measures the frame in METRES,
                          so a portrait phone scales the title by what actually
                          fits. The title and its breakup flecks render in a
                          foreground order with depth testing off; they are
                          graphic UI staged in 3D, and plaza decals must never
                          punch through them during the camera move.
                        - Dog: INTRO_AIM dropped 1.9 -> 0.9 and INTRO_SIDE slides
                          the aim along the camera's own right. Shifting the AIM
                          and not the EYE is deliberate — he moves in frame at an
                          unchanged distance, so neither his size nor the title's
                          scale follows. INTRO_SIDE is metres AT ASPECT 1 and is
                          multiplied by the live aspect, because half-width is
                          half-height x aspect: a fixed metre offset is a third
                          of the way out on a monitor and off the edge on a
                          phone. 1.64 against the 2.64m half-height is 0.62 of
                          half-width, which is what clears the centred title's
                          +-0.42 instead of parking the dog behind the letters.
                      The sim runs THROUGH the swoop, so you are
                      already riding when the camera lands. Player.jsx slerps
                      the WHOLE rig (dog + rider, one group) onto a
                      camera-facing yaw by that same smoothstep while P.intro is
                      up: the intro camera ORBITS, and a parked dog holding its
                      spawn heading shows the lens its back half the way round.
                      Because the sim is live underneath, that blend has to hand
                      the real heading back as intro decays rather than release
                      it on a flag. PHOTO mode pins
                      P.intro to 0 and Intro renders nothing, so captures are
                      untouched. GameUI shows a loading screen until drei's
                      useProgress hits 100 (bone-chase bar + quips), latched so
                      it can't blink off mid-load, with an 8s escape hatch so a
                      manager that never reports 100 can't strand the page.
                      GameUI also owns the mobile controls: on coarse-pointer
                      devices a left joystick + right JUMP button write into
                      input.js's `touch` state. The stick is WORLD-directional
                      on the ground — it points where you want to go on screen
                      (the chase camera never rotates, so screen axes are one
                      fixed world basis, CAM_YAW mirroring CameraController's
                      YAW) and applyTouchStick derives steer from the heading
                      error, called by PlayerController every SUBSTEP with the
                      live heading because a stick held still while the dog
                      turns must keep steering (input.check.js asserts the
                      convergence). In the air the raw axes are the trick pad:
                      x spin, up grab, down kickflip — same as the arrows.
                      Stick response saturates at 55% deflection (raw 1:1 put
                      every input at half strength on a phone). input.js's
                      TOUCH flag also drops the default quality to 'low'
                      (PINNED — PerformanceManager's incline never lifts it
                      on touch, a mid-play flip rebuilds the composer),
                      disables N8AO entirely, shrinks the shadow map to 1024,
                      runs dpr [0.75, 1.5] (Game.jsx/Lighting.jsx), pulls the
                      chase camera back (CameraController zoom 0.9 vs 1.2)
                      and scales MAX_SPEED/ACCEL by 0.7 (PlayerController
                      SPEED_K — the same speed reads much faster on a phone
                      screen) — the shoot harness is desktop headless, so
                      captures and the node checks see none of it.
                      Effects.jsx = cartoon particle kit: rainbow grind sparks +
                      star-sparkle glitter (per-instance colour), star pops on
                      tricks/bails, shockwave rings on jump/grind-start (none on
                      land — rejected), anime speed streaks, dust, bowl carve
                      marks. All fixed-size instanced pools, zero alloc in
                      the frame loop; fades are scale-to-zero (no per-instance
                      alpha). Grind sparks escalate with hold time. Big air:
                      PlayerController emits 'bigair' once per air past 1.0s
                      (a flat ollie is ~0.69s, so only pumped ramp/bowl airs
                      fire) — rainbow star halo + a streaming rainbow trail
                      until landing here, shimmer in AudioManager, and a
                      hang-time-scaled Big Air bonus through scoreAir.
                      AMBIENT AIR (220 dust motes; drifting leaves lived here
                      too and were cut by request) is the
                      one thing here with NO pool: position is analytic in
                      (index, time) and the field WRAPS around the camera, so
                      nothing is allocated, expired or respawned and the park
                      is never empty of air wherever you ride. The field is
                      CARRIED by a DAMPED copy of the camera position (1.1/s),
                      not anchored in the world: world-anchored, every particle
                      is a fixed lattice point the 13 m/s chase camera flies
                      through, so the motes streamed past sideways and crossed
                      the whole 26m box in 2s — debris in a gale, not drift.
                      Following the camera exactly is the other failure (motes
                      pinned to your speed, zero parallax); the damped centre
                      settles to the camera's velocity on a straight line and
                      falls behind on turns, pops and stops, which is where the
                      parallax comes from. wrapTo therefore wraps the OFFSET
                      about 0, and the anchor is snapped hard to the camera
                      under PHOTO. Seeds are
                      golden-ratio sequences, not Math.random, and the clock is
                      PHOTO_TIME under ?shot= — same pinning the wind and the
                      bones use, so captures stay comparable run to run.
                      Motes rise (sunlit dust), leaves fall and tumble. Both
                      scale to zero at the wrap-box faces and at y=0.7, which
                      is what stops a pop at the seam and clipping through the
                      paving; the leaves are LIT (they are park matter, like
                      the litter scraps) and the motes are toneMapped:false but
                      deliberately UNDER the bloom threshold — a mote glints,
                      it does not glow.
                      Bones.jsx = 5 floating collectible bones (positions in
                      levelData BONES, solved against the measured launch
                      heights so each wants a specific line: qp1 coping ollie,
                      pumped halfpipe air, r1 grind, bowl deep-end air, the
                      stairA gap). One merged lathe+lobes geometry, ivory
                      MeshPhysicalMaterial with clearcoat and a pulsing warm
                      emissive held under the bloom threshold. Collection is a
                      1.1m sphere on the body centre (P.pos + 0.45); collect
                      pops the bone (overshoot, spin, rise, shrink), emits
                      'bone' (gold star burst + ring in Effects, arpeggio in
                      AudioManager), scores 500 (2500 + ALL BONES! on the 5th)
                      and ticks the HUD bone pill. bones.check.js asserts the
                      float band and spacing. It exports R2 and POP because
                      Letters.jsx collects on exactly those — a second
                      collectible with its own radius is a rule difference
                      nobody can see until they measure it.
                      Letters.jsx = D-O-G, the S-K-A-T-E letters (levelData
                      LETTERS). Troika <Text>, so zero new assets — the font is
                      already served locally for the intro title. BILLBOARDED,
                      not spun like a bone: a troika glyph is a flat
                      single-sided quad, so a world-Y spin shows you the letter
                      backwards half the time, and reading which one you still
                      need from across the park is the whole objective. Parked
                      Hidden until `started` — the start frame is a composed shot
                      (title centred, dog middle-left, briefing card top-right)
                      and eight glyphs over the park is clutter in it. It is a
                      `visible` toggle, NOT an unmount: troika builds its SDF
                      geometry asynchronously, and deferring eight of those to
                      the PLAY click buys a hitch on the run's first frame.
                      Parked
                      on the three transitions the bones DON'T use (bank4 onto
                      pad2, the ledge1 grind, bank2 onto deckB) so spelling the
                      word walks you round the park.
                      Cans.jsx = five smashable trash cans (levelData CANS).
                      A can is NOT a collider — you ride through and it bursts.
                      The hit is a horizontal circle GATED ON THE FEET being in
                      the can's height band, or a big air over the top counts as
                      a smash. Modelled off a galvanised PERFORATED municipal
                      bin: punched barrel, solid collar + rolled lip, stepped
                      foot, white litter badge, and a lid whose handle is a
                      CHILD of the lid — it has to leave with it. The dot field
                      is an alphaMap on a generated canvas (staggered grid,
                      wrapped in x or the odd rows clip into a seam up the can),
                      NOT geometry — 600 holes x 5 cans is a CSG bill for a prop
                      you ride through — and it is alphaTest, not transparent,
                      so the holes are real to the shadow map and there is no
                      sort order. The BackSide liner is what you see THROUGH
                      them; it was already there for the mouth. The drum is
                      smooth 20-sided now: faceting a surface whose read is a
                      regular dot grid beats against it. Two coplanar-surface
                      z-fights were paid for here: the parts are lifted 8mm off
                      the paving plane (the drum's bottom cap and the foot ring
                      both sat exactly ON it, reading as aliasing crawling round
                      the base), and the drum's bottom cap is RECESSED 2.5cm up
                      into the foot ring (FOOT_IN) instead of sharing its plane —
                      that pair z-fought into a pinwheel you only ever saw once
                      the wreck rolled the can onto its side. Everything above
                      the foot is offset by FOOT_IN with it, LID_Y included,
                      because the frame loop rewrites the lid's y. The wreck is ballistic, not
                      physics: launched along TRAVEL (the dog is a 13 m/s
                      wrecking ball) at 0.75x speed, tumbling about the axis
                      ACROSS travel, hand-integrated and never asking the level
                      a question after the first frame. The group that tumbles
                      sits at the can's CENTRE with an inner group pushing the
                      parts back down — rotating the base group end-over-end
                      swung the drum through the paving — and its height floor
                      is the body's half-DIAGONAL, eased in over the pop, since
                      a tumbled corner reaches further down than H/2 — Skatepark bakes every
                      world matrix once and turns off matrixWorldAutoUpdate, so
                      a can that queries the ground while moving is a whole
                      second class of object in a park that has none. It emits
                      its own `'smash'` (not `'bone'`): Effects throws paint
                      chips + grit fanned along travel with a ground shockwave,
                      plus ~10 pieces of LITTER out of the mouth (Effects'
                      `trash` pool — the one pool here with a LIT
                      MeshStandardMaterial, because a scrap of rubbish is a real
                      object in the park for a second and a toneMapped:false
                      one reads as another sparkle; it tumbles about a single
                      fixed axis stored in the pool's `q` slots with the spin
                      RATE in q.w, and never asks the level where the floor is —
                      it shrinks out about when it would have landed),
                      and AudioManager clangs an INHARMONIC drum (1, 1.51, 2.13,
                      2.77, 3.61 — equal-tempered partials read as a bell, and a
                      bell reads as a reward) before the score chime.
                      lampModel.js = the teal Victorian lamp post, rebuilt
                      procedurally from a reference still via the img2threejs
                      pipeline. Pure module importing only 'three', so
                      tools/lamp-preview.html (served statically, captured by
                      tools/lamp-shoot.mjs) renders the exact parts the park
                      instances. lampParts() is the part list Props.jsx maps
                      onto MAT (paint / paintFlat / glass) through the same
                      instanceProp path as every prop; createLampPostModel()
                      is a standalone Group factory for the preview ONLY — the
                      park never mounts it (a Group per lamp is 9x the draw
                      calls). Flat-shaded hex parts vs smooth turned parts is
                      the whole material split. Mullions sit ON the hex
                      corners (k*60deg — CylinderGeometry's first vertex is
                      +Z, and the 6-seg lathe shares the phase) leaning with a
                      composed YXZ yaw-then-tilt: the XYZ euler approximation
                      twisted each bar and read as BENT from the chase camera.
                      The spike finial is deliberately short and 12-sided — a
                      tall 8-seg cone read crooked from above. The shaft was
                      shortened 0.7m by request (column 3.2 -> 2.5, head stack
                      translated whole, tip 4.86, banner mount 2.86) — the head
                      keeps its measured size, so it runs larger than the
                      reference's head-to-height ratio on purpose. The paint is
                      C.lamp pulled 60% toward the cans' #5c7d78 so the park's
                      two greens read as one family, over `lampWear` (Props.jsx)
                      — a seeded worn-enamel mottle multiplied under the colour
                      and doubled as bump, drawn wrapped in x because u runs
                      around the shaft. Every lamp ALSO
                      EMITS: one shadowless distance-11 PointLight per lamp at
                      LAMP_LIGHT_Y in LampPosts, gated on TOUCH, not on
                      quality — quality starts 'low' everywhere and inclines,
                      which would pop the lights in mid-run and keep them out
                      of the shoot harness (that gate shipped wrong once and
                      the harness proved the lights absent). Spill is
                      invisible at the measured patches in full sun at
                      intensity 60; it was verified real by capturing at 300.
                      ?shot=lamp frames a lantern head close-up.
                      Rider.jsx = boy.glb + the pose table that drives it. The
                      ride pose is a real crouch, and the two legs' angles are
                      MIRRORED across the pair (front thigh 0.68 forward / shin
                      0.42 back, rear the other way) so both legs DROP the same
                      amount — body.position.y takes the mean of the two, so an
                      asymmetric crouch floats one foot and buries the other
                      (a 0.5/0.54 rear knee left the back foot 8cm in the air).
                      His shirt and both sleeves ship the SAME orange as the
                      dog's coat and the warm plaza, so the player unit read as
                      one blob; recolor.js hue-rotates those maps at load (a
                      `material.color` tint can't do it — orange times blue is
                      grey, not teal). SHIFTS is the table: shirt + both sleeves
                      +168deg to teal, both shoes -28deg (measured hue 25 -> 357,
                      a real red, not a red-orange). Garments are picked by
                      `map.name` (GLTFLoader carries the glTF image name
                      through), the rotation preserves chroma and lightness so
                      Tripo's baked shading survives, and the shorts are
                      already blue and left alone. Canvas work is Rider's; the
                      pixel maths is a separate pure module so it can be checked
                      in node.
                      Dog.jsx = dog_compressed.glb, fitted and posed the same way
                      — the fit is still measured, dogFit.js's character store/LEG only
                      skew it (length x1.16, height x0.92, limbs x0.78 about
                      their hips). dog and boy default to the old
                      shared 1.58 scale but are independently editable in the
                      level editor. Shortening the legs raises the paws
                      off the bind floor, so LEG_DROP (bind hips 0.163/0.184,
                      paws 0.008) comes out of BOTH the model's lift and
                      backY() or the dog floats and the rider stands on air.
                      dogFit.js = those numbers, split out because Player and
                      Rider need them and a component file may not export
                      shared state (react-refresh). useCharacterSize is the one
                      reactive source of truth: both the editor panel and Player
                      subscribe directly, while undo/save use getState(). The
                      optional Dog proportions leva folder keeps long/tall.
                      The dog's fit scale and paw drop are applied per frame.
                      The rider scales about his planted feet, which ride
                      backY(); backY() follows dog height and dog scale. Dog and
                      boy sizes are fully independent; cohesion comes from that
                      planted-foot mount and size-aware trick offsets, never a
forced ratio or silently resizing the mate. Character size has its own
                      store update must NOT call bumpLevel(), which invalidates
                      plaza AO, rebuilds colliders/rails and remounts the whole
park for a change only Dog/Rider consume.
                      LEG is deliberately NOT a slider: the limb scales
                      are set once on the bones. The skull scale (HEAD)
                      carries the snout and both ears with it; setBone only
                      writes quaternions, so a bone scale set once survives.
                      COAT (0xd9a06a) multiplies the ktx2 albedo down into a
                      richer brown — Tripo's pale tan sat barely a stop off the
                      warm plaza and the silhouette went missing against it.
                      Colour multiplies in linear space, so an sRGB tint reads
                      as an sRGB value scale (0.92,0.71,0.46 -> ~0.78,0.45,0.19).
                      The GLB carries ONE map (baseColor) and no normal or
                      roughness map, and it is KTX2 — transcoded straight to a
                      GPU format, so its pixels never reach the CPU and the
                      hue-rotate recolor.js plays on the rider is not available.
                      So the coat gets both: procedural fur maps from
                      textures.js (dogNormal / dogRough, see below) and a
                      colour grade in `coatShader`, an onBeforeCompile on that
                      one shared material. The grade is hue (Rodrigues about
                      the grey axis — rotates hue, leaves luma, so Tripo's bake
                      survives), saturation 1.4 and contrast 1.14 about a 0.2
                      LINEAR pivot — sRGB's 0.5 would crush the whole coat to
                      black — plus a violet-sky rim (0x8f96de x 0.34, fresnel^3
                      on outgoingLight) that separates the silhouette from the
                      warm plaza when he is between the camera and the sun. The
                      rim is sky WRAP, not a second key: key + ambient still
                      sums to white, and it sits under the bloom threshold.
                      All three grade knobs live in ONE module-scope
                      `COAT_ADJ` uniform object shared by the compiled shader
                      and the "Dog coat" leva folder — three re-reads
                      uniform.value every frame, so a slider is live with no
                      recompile. Its own folder, not Player's: the clash is two
                      useControls on the same PATH. There is no roughness
                      slider — assigning `mat.roughness` is a write to a memo
                      return value and react-hooks/immutability rejects it;
                      normalScale is mutated in place and passes. The material
                      comes back out of the fit useMemo rather than through a
                      ref, because a ref written inside the traverse is a ref
                      read during render.
                      Carving bends the whole body: the rear legs and tail hang
                      off tripoRoot and the entire front half off tripoSpine_0,
                      so yawing spine + chest (the only two segments between the
                      hips and the neck) swings shoulders, front legs and head
                      into the turn while the hips hold the heading. Split
                      0.8/1.2 so it curves through the shoulders rather than
                      hinging at the hips, and `lag` whips it on a reversal.
                      The skull's own yaw came down 0.28 -> 0.14 because it now
                      inherits the bend. LONG stretches x OUTSIDE these bones,
                      which flattens the apparent angle of a yaw (the nose lands
                      at (LONG*cos, sin)) — so a longer dog needs a bigger bend
                      for the same read: 0.34 raw is ~35deg on screen at 1.16.
                      Grinds add a balance wobble (roll + a quarter of it as
                      yaw, two detuned sines) gated on `splay` — the same
                      damped grind blend the leg splay uses, so it eases in and
                      out instead of popping. It is on the DOG's root only, so
                      the rider rides steady on top of it.
                      The tongue is a capsule, not a bone — the GLB has none.
                      It is authored at the bind-pose mouth in model space, then
                      `attach`ed to the skull bone at mount: it used to just sit
                      at a fixed point on the grounds that the skull moved by a
                      few hundredths, and the carve bend broke that (the head
                      swings ~35deg and the tongue stayed behind in mid air).
                      `attach`, not `add`, so the authored offset, the mesh's
                      lay-forward rotation, the bone's non-identity rest frame
                      and its HEAD scale all carry over instead of being typed
                      in. Two nested groups: the outer is the mount the attach
                      rewrites, the inner is free for the frame loop's trail. Ears, tail and tongue trail a carve off one
                      `lag` signal (how far P.lean has run ahead of a damped
                      copy of itself: zero on a held arc, biggest on a reversal).
                      The ear springs are ALSO kicked by the rig's own
                      acceleration (P.vel differenced over the render frame),
                      which is what pops, landings and wall hits look like —
                      lean cannot see any of them. Clamped to +-60: a landing
                      kills 9 m/s inside one 1/120 substep, so the raw number is
                      in the hundreds, and the clamp is what makes it an impulse
                      rather than a spike (it also swallows a respawn's
                      teleport). `wiggle` (WiggleBone) was considered for this
                      and passed over: the ears and tail carry AUTHORED motion
                      (flare, wag, the air tuck) on the same bones a solver
                      would own, and the spring was already there — it was only
                      missing an input.
                      clearCoat.js = swaps standard materials for physical ones
                      and drives their clearcoat. RIDER ONLY: Player.jsx wraps
                      <Rider /> in the group it hands to applyClearCoat, so the
                      dog keeps its MeshStandardMaterial — a coated dog reads as
                      wet plastic, not fur. Player.jsx owns the leva folder
                      ("Clear coat") because two useControls on the same path
                      is a duplicate-key clash
                      FoliageControls.jsx = the "foliage" leva folder (blade
                      dimensions for bed and crown, the four greens, the three
                      flower colours, the ramp lifts, sun bearing, bed fill).
                      Mounted from Game.jsx under ?debug, outside the Canvas —
                      it renders nothing. The knobs live in src/game/
                      foliageKnobs.js, its own module for the same reason
                      dogFit.js is one: a component file may not export shared
                      mutable state under react-refresh, and BOTH Props.jsx
                      (geometry) and level/foliage.js (colour, ramp, fill) read
                      them. A knob CANNOT be a uniform write — the park bakes
                      its InstancedMeshes once and sets matrixWorldAutoUpdate
                      false — so bumpFoliage() re-runs Trees/Shrubs/Planters'
                      useMemo through a useSyncExternalStore version, which is
                      the same "a remount IS the reset" trick the runId bump
                      uses for Bones/Letters/Cans. Consequences worth knowing:
                      the blade geometries are `let` and rebuildFoliageGeo()
                      DISPOSES the old pair (a slider drag is a rebuild per
                      tick, and leaking a BufferGeometry per tick is a GPU
                      leak); every numeric knob carries a coarse step for the
                      same reason. The green knobs deliberately do NOT tint
                      MAT.foliage/MAT.crown — LEAF_MAT is white on purpose and
                      bake() divides the material base out to recover
                      instanceColor, so tinting it applies the ramp twice; the
                      greens reach the screen through foliage.js's
                      refreshStops() instead, which also rewrites SPECIES' leaf
                      triples against a module-load SNAPSHOT so a species with
                      an authored stop (`tall`'s hot '#dee949') keeps it.
                      Defaults mirror the shipped art exactly — foliage.check.js
                      reports byte-identical numbers with the panel untouched.
                      The panel is a SEARCH TOOL: bake a winner back into
                      palette.js/foliage.js/Props.jsx with the measurement that
                      justified it.
                      ToonFX.jsx = leva-driven toon try-out passes (posterize,
                      depth outline, halftone, pixelate, tilt shift), all OFF by
                      default so the shoot harness and acceptance targets are
                      untouched. Tilt shift is postprocessing's own
                      TiltShiftEffect, built at module scope and mutated —
                      react-hooks/immutability rejects writing setters on a
                      useMemo'd object, and the r3f wrapper rebuilds the effect
                      (render target included) on every slider tick. Its
                      composite shader is REPLACED — see the gotcha below
  audio/
    AudioManager.js   fully synthesised SFX, no files. Cartoon-styled: slide-whistle
                      jump/bail, boing landings, per-surface paw patter and
                      rolling noise, glassy pentatonic shimmer on 'bigair'.
                      Clearing a SET — 'goal' with id 'fetch' (all 5 bones) or
                      'cans' (all 5 smashed) — adds sfxFanfare on top of the
                      shimmer + chime every goal gets: a rising arpeggio landing
                      on a held triad over a noise cheer, all in ONE pooled
                      voice, since the pool is 8 and a ten-note fanfare taken a
                      voice per note evicts itself halfway through. There is deliberately NO dog voice — the
                      yip/whine generators and their four call sites were removed
                      by request; don't reintroduce barking on jump/trick/bail
                      or through a grind.
  player/
    PlayerController.js  movement, tricks, grinding. updatePlayer consumes the
                       sub-STEP accumulator remainder as one variable-size
                       step: whole 1/120 steps alone advanced the rendered
                       pose 1-3 steps per display frame (rAF beat against the
                       8.33ms grid), an 11cm-per-step stutter at speed with a
                       perfect frame rate. Safe because every response in
                       step() is rate-based and dt-scaled.
                       Scoring: `airTrick()` is the ONE table of what an air is
                       worth so far — stepAir flushes it to the trick tape every
                       0.1s (live name + multiplied value, `trickLive` in the
                       store holds the popup open instead of fading it) and
                       scoreAir reads the same function at landing, so the
                       popup can never name a trick the landing doesn't pay.
                       Air points still BANK at landing, not mid-air: a bail
                       shows 'Bail!' and you lose them. Grind points DO pay
                       live (below). A grind claims
                       its combo slot at lock-on and pays the score LIVE
                       (42 pts/s x the chain multiplier, flushed every 0.15s —
                       never per-frame store sets), settling the rounding
                       remainder at exit WITHOUT going through award(), which
                       would count the grind twice. The multiplier (x0.5 per
                       link) is for CHAINS, not landed tricks in a row: the
                       combo clock is CHAIN_GRACE (0.6s), only runs on the
                       ground, and mid-air / mid-grind you are still in a
                       trick — so links must connect land-and-pop fast, but a
                       long air or rail can't time the chain out.
                       scoring.check.js measures both rates on r1 and that
                       plain rolling drops the chain. Pool Gap (+400) pays for
                       flying over the bowl: the air must be CLEAR of the rim
                       (k>1) at some point first, then reach k<0.7 of the polar
                       rim radius, and LAND at k>1. All three, because two of
                       them alone still pays for an air you didn't fly: without
                       the land test an ordinary air out of the deep end and
                       back in counts, and without the leave test (trick.leftPool)
                       a straight ollie off the bowl's flat bottom onto the deck
                       counts — it starts inside the hole, so the k<0.7 test is
                       already satisfied on its first airborne frame. G is 22, so a
                       flat ollie clears ~9m and the full 12m diameter is out of
                       reach — the line that pays is a corner cut across the
                       rim. Air tricks are on the
                       direction keys — left/right spin, back kickflips (the dog
                       IS the board, so its barrel roll is the flip). There is no
                       air *steering*: a slow AIR_TURN on the same stick just
                       fights the spin. Q/E/J still work as aliases. There is no
                       air *throttle* either — see the ramp section below.
                       A fresh grab press rolls a random style from
                       GRAB_STYLES (nose/tail/indy/method, never the same
                       twice running): Rider's grab_<style> poses pair with
                       Dog.jsx's GRABS reaction table by key and the trick UI
                       names each one. All four were measured against the real
                       skeletons (hand-to-target gaps 0.06-0.14) — don't
                       retune them by eye.
                       Ground carve is TURN_LOW/HIGH (heading rate) x GRIP (how
                       fast velocity chases it) — raising one without the other
                       reads as understeer. Concave creases (flat -> ramp base
                       and ramp foot -> flat) preserve speed through the ground
                       snap instead of projecting it away — a bare projection
                       ate 1 - cos(slope) of your speed in one frame each way,
                       which is what made straight ramps feel mushy. Hits
                       steeper than ~72 degrees still project (0.3 floor). Steering *against* the lean you hold
                       boosts both by `shift` (= -steer * P.lean, so a reversal
                       whips ~1.3x over the first 0.1s). It needs no timer:
                       P.lean already scales with speed and decays as you cross.
                       Landing clean (square within ~20deg, flip ridden out,
                       >0.3s of air) pays a momentum boost (CLEAN_BOOST +
                       airtime bonus, capped at 1.25x MAX_SPEED) — the pump
                       loop. steering.check.js asserts an ollie lands faster
                       than it took off.
                       Two halfpipe aids: PUMP and ALIGN. Holding W on a wall
                       cannot drive you (pushK -> 0.15 by design), so a session
                       only ever LOST energy crossing the flat; the pump term is
                       NOT on the throttle (a pump is what riding a transition
                       IS — hands off, the pipe sustains ~0.85m over the coping
                       indefinitely), it is
                       gated on surf.curv (nonzero only on a quarter's arc),
                       applied along the direction of TRAVEL — facing-aligned it
                       brakes you on the fakie roll-out — and fades to zero at
                       MAX_SPEED, so it tops a session up rather than winding it
                       up. ALIGN eases the heading onto the fall line when
                       steer is EXACTLY zero. It runs off a PIPE_HOLD timer, not
                       off the live slope: a quarter (surf.curv > 0 — colliders
                       computes curvature for 'quarter' ONLY, so the bowl is
                       excluded on purpose; a bowl wants carving lines, and
                       guiding there made the 3s trajectories chaotic enough to
                       break collision.check.js's dt agreement) stores its fall
                       line as pipeAxis and holds it 0.9s, which carries the
                       assist across the 3.2m flat — otherwise the guide ends at
                       the bottom of every wall and the run to the other one is
                       exactly where you drift out the side. A 40deg entry now
                       peaks 3.0m off centre of the 6m half-width instead of
                       leaving the pipe; ramps.check.js asserts it. resetPlayer clears
                       the hold — a stale axis steers the next run or respawn,
                       which is what failed stairA's climb in ramps.check.js.
                       Any steer input switches it off, so it never fights a
                       correction you are making.
                       Landing in a transition (slope > 0.35)
                       moving OPPOSITE your facing auto-turns the heading to
                       the travel direction, easing the visual 180 through
                       spinResidual — without it a halfpipe session dies
                       against one wall with the throttle fighting the
                       roll-out. Flat fakie is untouched. It is gated on the
                       FALL LINE, not on velocity alone: landing already facing
                       the roll-out while the velocity still carries up the wall
                       read as fakie under the old test and spun a deliberate
                       180 straight back into the wall. It fires only when
                       facing UPHILL, and aims at downhill — the horizontal
                       projection of the NORMAL, +(nx,nz). Negating that points
                       UPHILL and the session dies at one wall (it did, in
                       testing). ramps.check.js
                       asserts a landed 180 is left alone, and a halfpipe
                       session pumps wall to
                       wall. P.surfLift lifts the rendered rig by measured
                       path curvature (the rendered dog is ~1.6m nose to tail
                       and chords ~12cm deep into the 2.6m quarter — cap 0.12,
                       slow air decay); Player.jsx applies it along P.up. The
                       rig up-tracking is split: ground damp 26 / air 7 — a
                       quarter turns the normal ~60deg in its last metre, and
                       at the old damp 11 the rig lagged ~30deg, printing the
                       tail out the BACK face of the lip, where a quarter is
                       nearly zero thickness. Ramp lips are coping TUBES
                       hugging the top corner — the old 0.4-deep stone
                       RoundedBox jutted ~0.3 out of a quarter's near-vertical
                       face and the dog rode through it at every lip.
                       Colliders ignore lips on purpose, so any lip geometry
                       must protrude less than surfLift clears.
    boneRig.js        drives boy.glb's skeleton from angles authored for a
                      procedural rig — read it before touching any pose number
tools/                capture harness (see below)
public/boy.glb        the rider. 1.7MB draco, 112k verts, 41 joints, no clips
public/dog_compressed.glb  the dog. 1.4MB draco+ktx2, 144k verts, 31 joints, no clips
                      Both were DECIMATED (meshopt, ~0.2 ratio) from Tripo's
                      490k/534k. That 1.02M verts was 42% of every frame's
                      triangles — skinned twice, main pass and shadow pass —
                      for two characters a few hundred pixels tall. Measured
                      via renderer.info: hero 5.27M -> 2.23M tris/frame, plaza
                      9.05M -> 6.01M. The hero capture (the closest framing
                      there is) is indistinguishable from the original.
                      Redo after any asset change:
                        gltf-transform simplify in.glb tmp.glb --ratio 0.2 --error 0.002
                        gltf-transform draco tmp.glb out.glb
                      (simplify decodes draco, so it must be re-encoded after,
                      or the file comes out BIGGER than the source. KTX2
                      survives both passes.) boneRig.check.js still passes —
                      meshopt leaves the node/skin tree alone.
public/{draco,basis}/ decoders for the above, served locally on purpose
public/fonts/         Luckiest Guy (OFL), the intro title face — local for the
                      same reason as the decoders
ref/                  the reference stills the art is measured against
```

## The run

The park is not a sandbox any more. A session is a **2:00 clock you extend by
playing**: every bone and every completed challenge is +15s, a bail is −5s, and
zero puts up a scorecard with PLAY AGAIN. `RUN_TIME`/`TIME_BONUS`/`TIME_BAIL`
are the knobs, all in store.js. A short base clock is the point — at a flat 5:00
the challenges carry no urgency and the timer is only pressure in the last
thirty seconds. The scorecard's PLAY AGAIN is a CLICK ONLY — the start card
still takes Enter/Space, but a run ends with keys held or mashed, so a key
shortcut there restarted the run before you had read the score.

That is the DEFAULT run, not a restriction on authored challenges. Level blobs
may carry `rules: { time, goalIds, timeBonus, subtitle }`; `setRunRules` keeps
`P.timeLeft` and the UI clock synchronized, `restart()` reads the active time,
and `activeGoals()` is the single filtered list consumed by subscriptions,
polling and every HUD count. Missing rules restore the defaults. This is what
lets Dog Bowling be a real 30-second, zero-bonus, cans-only run rather than a
card that says one thing while the normal eight goals and 2:00 clock keep going.

The wipeout tumbles the rig about the PAW line, so `stepBail` floors it at
`surf.y + BAIL_CLEAR` (0.4, ~the fitted dog's half-height) rather than at the
surface — at surf.y exactly, half the dog rolls through the paving.

**The bowl is a hole with no side walls.** `resolveCollision` only ever pushes
in x/z, so anything that puts the body under the dish (a fast entry between
substeps, a graze, a landing sampled a frame late) leaves it under there with
nothing to eject it. `clampToBowl()` runs after every integration in
`step`/`stepAir`/`stepBail` and lifts the body back onto the same analytic
surface the mesh is drawn from. POSITION ONLY: zeroing `vel.y` there ate the
descent's momentum on any overshooting substep, and collision.check's
dt/divergence probe measured the bowl riding 32m differently at 1/30 than at
1/120. The callers' own snap/land branches reproject the velocity a line later.

**The challenge list is not HUD furniture.** Eight to-do rows sat over the park
for the whole session and nobody reads them while steering. They live in two
places now, both the same `GoalList`: a briefing card on the start overlay
(read them BEFORE the run) and a `☰ n/8` pill top-right that opens the list as
a sheet mid-run, top-right. On the start card the eight rows are COLLAPSED
behind a "View challenges" button — that panel shares the frame with the troika
title, and the `n / 8 completed` count is the only part of it that means
anything before your first run. The start card's panel and key legend are CREAM
on the park, not the HUD's translucent purple: the start frame is a pastel
sunset and a purple scrim over it reads as a dimmed screenshot. The legend is
ONE bar with hairline dividers rather than five floating pills, for the same
reason — five pills over a busy park is five silhouettes to parse.
There is no bones pill any more — the count was one
more permanent readout for something the bone pop, the chime and the scorecard
already tell you.

**The in-play HUD is deliberately quiet, and it is a ranked set, not three equal
widgets.** It read as a generic mobile-game chrome kit stuck over the park,
which is a contrast problem, not a layout one: `--rim` is a HAIRLINE
(u/14, was u/8 — the white outline was the loudest edge in the frame) and pill
shadows are CONTACT shadows (0.18u/0.45u at 0.26, was 0.5u/1.15u at 0.42, which
detached the pill and smeared a dark halo over the pastel sky). The rank is
SCORE > clock > menu: the score keeps the filled pill and grew to 2.1u/900, the
clock is a ROSE sticker with a stopwatch icon — hierarchy carried by COLOUR
against the score's purple, so two filled pills never read as one widget row.
Its rim is the one deliberate exception to the hairline (`--rim` x1.6 at 0.94):
it is a sticker on purpose. `is-urgent` is therefore a DEEPER rose plus the
pulse, not a hue change — the pill is already red, and switching hue there reads
as a different widget appearing. (A chrome-free clock with a wavy-underline
squiggle was tried and rejected: it had no anchor at all against the sky.)
The `☰ n/8` menu is NOT faded when idle — a dimmed interactive control
reads as DISABLED rather than quiet, and it is the only door into the challenge
list mid-run. The score's icon is a PAW, not a bone: the score is not a
bone count — bones are their own collectible with their own pop and chime — and
a bone there claimed otherwise. `BoneIcon` still runs the loading bar's chase
marker, which is what it was for. Esc TOGGLES the sheet (it is the only key that opens it, so
that handler cannot be gated on `open`). Opening the sheet
PAUSES: `P.paused` (not a store flag — the frame loop is its only reader) gates
the whole `g.started` branch in GameLoop, so clock, goals and sim all stop. The
`useEffect` that sets it must clear it on UNMOUNT as well as on close, or a run
that ends with the sheet open freezes the next one.
Completion still announces itself through the trick popup
(`complete()` calls `showTrick`), which is why nothing is lost by hiding the
list. The hints render on touch now too, since the list is only ever open while
you're actually reading it. The MUTE WAVE also lives in the sheet on touch (a
`SOUND` row) rather than in the bottom-right corner, where it had a thumb and a
JUMP button for company. On a phone the three top widgets are one row across
~390px and the score pill ran into the centred clock, so `.hud-pill`/`.hud-menu`
redefine `--u` at 0.74 of the root `--u0` under `(pointer: coarse)` — the row
shrinks, but `--edge` still comes off the full unit so nothing moves.

There is no `lives`. There used to be, and it did nothing: never displayed,
and `bail()` reset it to 3 the instant it hit zero. Time is the one resource.

**The personal best is local, per LEVEL, and written in exactly one place.**
`highScore.js` keys `skatedog.best` by level id — `'park'` for the shipped park,
the `?level=<id>` id for a saved one — so a huge score on a level you built out
of five ramps in a line doesn't overwrite the park's. `endRun()` is the only
writer, because it is the only place a run is finished (PLAY AGAIN goes through
`restart()`, which zeroes the score). The start card reads it ONCE per mount
(`useState(() => bestFor(levelId()))`): the card unmounts on PLAY and the write
happens long after, so there is nothing to keep live. A zero best renders
NOTHING on both the brief card and the MY LEVELS tiles — "Best 0" on a level you
have never finished a run on reads as a scoring bug. Every read is
try/catch'd and `localStorage` is reached lazily (`ls()`): node runs the checks
without it, private mode can throw on ACCESS and not just on write, and a
corrupt blob has to be a missing best rather than a crash on the home screen.
There is deliberately no shared leaderboard — one needs a backend, accounts and
score validation, and without validation it ranks whoever opened devtools first.
`levelEdits.check.js` asserts only a higher score writes and that ids don't
share.

**The clock lives on `P.timeLeft`, not in the store.** GameLoop mirrors it to
`useGame.timeLeft` only when the whole SECOND changes — a per-frame store write
is 120 HUD renders a second. `addTime()` writes through to both for the same
reason a bonus that only landed in the store would be erased on the next frame.
The clock does not run during the 1.5s intro swoop.

`goals.js` is the challenge table, and the design constraint is that **every
goal is detected from an event the controller already emits** — no goal owns a
timer, a collider or a probe of its own. A second measurement of "was that a
long grind" would drift from the one the scorer uses and the card would disagree
with the trick tape. So Rail Hound listens for the `'Long Grind'` name the
scorer already produces at 1.6s, Pool Party for `'Pool Gap'`, Off the Leash for
`'bigair'`. The two score tiers are the only pollers (4Hz). The three
collectible objectives own their own proximity tests and call `complete(id)`.

Three things that bite here:

- **`complete()` must be idempotent, and the guard belongs in `complete()`.**
  Every predicate is subscribed to an event that legitimately repeats — a second
  Pool Gap is still a Pool Gap — so without it one challenge is an infinite time
  machine. `goals.check.js` asserts a repeat call pays nothing.
- **Grind payout does not go through `award()`** (PlayerController says so
  explicitly at the exit-grind settle, because it would double-count), so a
  grind challenge listens for the `'trick'` emit, not for `award`.
- **`P.inBowl` is a SURFACE flag** and reads false the entire time you are
  airborne over the hole. Pool Party keys off the trick name.

Restarting is three resets, and all three are load-bearing: `resetPlayer()` for
the rig, `resetGoals()` for the module state the goals keep outside React, and
`restart()` for the store — whose `runId` bump is keyed onto the group holding
Bones/Letters/Cans. Their "already got" flags are `useRef`s with no
reset path, so **a remount IS the reset**.

PHOTO mode never enters any of this: the capture branch returns before the clock
ticks, GameUI hides the time pill and goal card, and Letters render
nothing (same rule as Intro.jsx — the plaza and bowl captures are compared
against the reference stills and must not grow gameplay furniture). Cans stay
visible; those are park furniture.

## The palette is a contract, not a suggestion

`palette.js` derives every value by decomposing the reference stills into
albedo x light. The load-bearing fact:

> A shadowed surface reads at (0.62, 0.62, 0.78) of its sunlit self. That solves
> to a **golden key** and a **cool violet ambient whose sum is neutral white**.
> The scene is warm-*painted*, not warm-*lit*.

Consequences worth internalising before touching any colour:

- Albedo in `C` is what the surface looks like under white light. Do not pre-warm
  it. **If a surface renders too orange, the light is wrong, not the paint.**
- Because key + ambient ~= white, a sunlit surface renders at roughly its own
  albedo. So an albedo has to BE the reference's sunlit reading — no exposure
  setting can fix a too-light albedo without crushing the occluded end.
- Shadow tints come from `SHADOW_TRANSFER`, never a grey multiply.
- Sample `RAMP.*` for per-instance variation. HSL jitter moves value and hue
  together and reads as noise; a ramp reads as a batch of real material.
- `LIGHT.target` holds measured sRGB acceptance values. Check against them.

Key-to-ambient ratio is the single easiest thing to get wrong. A key-dominant rig
puts occluded surfaces near black, which produces a bimodal image — flat hot
field, cliff into black — and reads to a viewer as *"there is no ambient
occlusion"* even when the AO pass is working perfectly.

## The level editor (`?edit` or `/edit`)

`?edit` (or the `/edit` route — same module-load const, and the start card's
LEVEL BUILDER button navigates there with a full page load on purpose, since
`loadLevel()` and the music duck only run at import; `vercel.json` rewrites
`/edit` to `index.html` in production) makes the editor AVAILABLE; `useEditor`'s `editing` flag says which half
you are in, and it is live state, not the URL const. While editing, the chase
rig is swapped for an orbit camera, the sim is paused entirely (GameLoop returns
before `sampleInput` — a live sim would steer the dog off the same W/E the gizmo
uses) and `Editor.jsx` (in-Canvas) + `EditorPanel.jsx` (DOM, left edge) mount in
place of `CameraController` + `GameUI`; `Intro` doesn't render.
`levelEdits.js` is the contract both sides share — its own module for the same
reason `foliageKnobs.js` and `dogFit.js` are. The panel is PLAYFUL BUT NOT
CHILDISH — cream card, colour-coded tool tiles, one loud PLAY — and its copy is
plain (Undo/Duplicate/Delete/Play, not "Oops"/"Twin it"). It is three questions
in the order you ask them: WHAT (the tool palette), WHERE (one hint line, then
you click the ground), IS IT RIGHT (a card of −/+, ↺/↻/⊹, ▲/▼ steppers).
A stepper is one click and unambiguous, where `w: 4.25` is two decisions (which
field, what number) before you learn anything. Emoji rather than typographic
glyphs for the same reason: `◣` is a shape you have to be TOLD means ramp.
Everything that is a number rather than a decision — raw fields, the outliner,
the JSON export, the key legend — is folded into native `<details>` drawers,
because a panel that opens on twenty labelled inputs teaches you this is a
spreadsheet with a park attached. The raw fields are still under "Fine tune".
The hint line always says the next ACTION, never the current state — a static
"Pick a tool" is a line you stop reading after a minute. Only the middle strip
scrolls, so PLAY never leaves the screen. Armed tools read as LIFTED and
outlined, not recoloured: the tint is how you recognise the tool, so painting
the armed one purple makes it the one you can no longer identify. Two CSS traps:
`.ed-panel button` sets a `font:` SHORTHAND, so a bare `.ed-play { font-family }`
loses to it on specificity and the display face silently reverts (it is
`.ed-panel .ed-play`); and `--e` is the panel's own unit, deliberately not the
HUD's `--u`, which scales with the viewport because it sits over the game.

**A TOOL IS NOT A TABLE.** `TOOLS` in `levelEdits.js` is the one palette both
halves read — the panel takes label/glyph/tint off it and `Editor.jsx` takes the
1..9 bindings and the cursor ghost's footprint (which used to be hand-copied
from DEFAULTS and went stale silently). A tool carries a `patch`, and that is
the whole point: SOLIDS is FOUR tools behind one `kind` field, and the old
"Ramps" button dropped a flat 0.4 ledge — placing a ramp was simply not possible
from the palette. So `DEFAULTS.SOLIDS` no longer carries `top`/`style` (heal()'s
KIND table fills whatever the row's kind requires, or a ramp arrives carrying a
box's fields too), `addRow` takes a tool id OR a bare table name, and it renames
the row after the TOOL — `DEFAULTS.SOLIDS` spells `box7`, and a quarterpipe
called box7 is a row you cannot find in the outliner. `levelEdits.check.js`
asserts each SOLIDS tool builds the collider SHAPE it claims.

**A tool can also be a GROUP, and a group is ONE object.** The halfpipe tool
carries `group`: five row specs (the shipped hpDeck/hpN/hpS/hpDeckN/hpDeckS
recipe, hardcoded like the swatch hexes) offset along local +Z (`dz`) and yawed
relative to the placement (`drot`). `addRow` places them all inside ONE
begin/commit and stamps every row with a shared `grp` id — and that stamp is
what makes the pipe one object afterwards: `moveGroup`/`rotateGroup` in
levelEdits.js apply the same translation to every member and swing the mates
rigidly about the row being handled (rotate uses the same local-+Z yaw matrix
as everything else). They live in levelEdits, not Editor.jsx, so the gizmo's
`writeBack`, the panel's fine-tune x/z/rot writes (`setField` routes them —
numbers only, since the raw inputs park draft strings and a NaN delta would
poison all five rows), and the node check share one implementation. Width is
also a group property: a `w` write assigns the requested span to all five rows,
so both transitions, both decks and the platform grow together and an old
split-width save repairs itself. The user-facing Length is the platform's full
deck-to-deck footprint, regardless of which member is selected; changing it
keeps the quarter runs and deck depths fixed, moves both sides symmetrically,
and gives the difference to the middle flat. `dimensionValue` makes both the
main stepper and Fine tune show that same overall value for every member, and
`applyBlob` normalizes old split-width/length groups as they load. Height coordinates both
transitions/decks and grows the base outward when a taller quarter needs more
run. Translate
write-back is a DELTA, not an absolute — the only form a group mate can
consume. `duplicateRow` copies the whole group under a fresh stamp (a lone copy
still carrying the old `grp` would drag the original around) and `deleteRow`
takes the whole group with it. `snapLines` skips a dragged row's group mates as
snap sources — they move with the drag. The tool's `patch` is only the
footprint `placementInfo` tests; the ghost previews every group row
(`ghostShapes` maps `group` to real quarter wedges plus boxes, hence the `ry`
slot on ghost children). It sits AFTER ledge in `TOOLS` on purpose: the panel
resolves a selected row to the first tool whose `patch.kind` matches, and ahead
of ledge every box row's card would read "Halfpipe". `levelEdits.check.js`
asserts the five rows, the facing quarters' colliders, group move/rotate,
shared width/height reaching the colliders, whole-group duplicate/delete, and
the single-undo placement.

**Materials are swatches, not dropdowns.** `LOOKS` in `levelEdits.js` maps each
table's material-ish field (`style`/`mural`/`color`/`plant`/`banner`) to swatch
options the card renders as one-tap colour chips; the same fields stay in the
Fine-tune ENUMS for completeness. It is a FUNCTION of the row because SOLIDS'
options hang off `kind` (stairs have no style). Swatch hexes are hardcoded
mirrors of palette.js `C.*`, same as TOOLS' tints — the module stays loadable by
the node checks. New looks that ride it: `railMint` (a fourth rail enamel in
Skatepark's `mats()` — the colour already existed for benches) and two murals
(`paws`, `sunshine`) as branches in Props.jsx's `drawMural`; the sunshine face
is MINT, not cream, because cream on the yellow disc vanishes at the mural's
0.78 alpha.

**The whole scene is editable too: ground look and time of day.**
`useSceneSettings` in `levelEdits.js` is the reactive source for
`{ time, ground, pattern }`, with preset tables `TIMES`/`GROUNDS` (hardcoded
hexes, node-check loadable) and `setScene(patch)` (one undo). It rides the
undo snapshot, the save blob and `SHIPPED`, and the panel renders it as a
"🎨 Scenery" card of swatches under the Pool button. The defaults ARE the
shipped art and that is load-bearing: `sunset` carries NO overrides — every
`??` and `×1` in Lighting.jsx falls through to the measured constants — and
`classic` tints white, so a plain visit (loadLevel only runs under `?edit`) and
the shoot harness render byte-identical. Ground: `groundOf().tint` multiplies
BOTH plaza materials' `color` (m.plaza too, or deck insets keep the old floor)
and each non-classic preset carries coordinated stone/masonry/bowl/halfpipe/
wood/grass multipliers plus a light atmospheric tint, so Colour reads as a park
palette rather than an isolated floor filter. This lives in a Plaza
`useLayoutEffect` — mats() is module-cached and Plaza subscribes directly to
ground/pattern, so a
settings click never rebuilds the park. Lighting subscribes directly to time for
the same reason. The floor's PATTERN is the third appearance axis (`PATTERNS`, a "Pattern" swatch
row whose chips are CSS GRADIENTS — a pattern chip has to look like its
pattern, not a colour): the same Plaza effect swaps `map`/`normalMap` on both
plaza materials via textures.js `plazaMapFor`/`plazaNormalFor` and applies each
pattern's own bump strength, roughness and environment response. `slabs`
returns the SAME cached shipped textures (identity, like sunset/classic);
tiles/checker/concrete/wood are drawn on demand off `PLAZA_PATTERNS` —
a bond walk whose odd rows start at i = −1 and colour by WRAPPED index, so a
bonded pattern tiles (ny must stay EVEN or the vertical wrap breaks row parity).
Time choices likewise replace the full rig as a family — key, hemisphere,
fill, environment cards, sky and fog — while sunset carries no overrides and
therefore remains the shipped identity look. Neon is deliberately restored as
one Time choice (the original magenta key/cyan fill rig), not as the removed
Neon City world preset: selecting it never changes Pattern or Colour.
The editor deliberately has no one-tap world presets and no brick-specific
axis: users mix the three direct rows (Pattern, Colour, Time), and saved values
for removed choices fall back through `timeOf`/`groundOf`/`patternOf`.
`concrete` is `flat` (no cells; extra cracks carry the read, near-flat normal)
and `wood` colours off RAMP.wood with along-board grain streaks — a 2.67×0.31m
half-bond boardwalk, not parquet. No
`needsUpdate` on the swap: both slots are always occupied, so no shader define
moves. All patterns share `plazaRough()`; pattern × tint compose since tint is
a `color` multiply. Time: Lighting
takes `useLevelVersion()` and scales key colour/intensity (`keyK`), the three
ambient terms (`amb`), sky, skyHigh and fog from the preset; the `Environment`
is keyed on the preset id because `frames={1}` bakes once per mount — without
the key a time change keeps the old sky dome. The sun DIRECTION deliberately
does not move: `SUN`/`LIGHT_BASIS` are module constants the shadow fit and the
shader cookie are built on, and colour+intensity already sells the hour.

**A quarter's rise can never outgrow its run.** Past h = d the arc circle
R = (d²+h²)/2h puts the DRAWN surface's top at d²/h — below y1 — while the
coping tube and the collider's lip stay at y1, so a tall quarter visibly came
apart. `heal()` grows `d` to match `y1 − y0` on every quarter-curve write
(steppers, fine-tune, the height-match below), so any height is reachable and
still draws whole; d = h is a perfect quarter circle, vertical at the lip.

**The ghost's red state is authoritative.** `placementInfo(toolId,
x, z, rot)` in `levelEdits.js` is a pure query returning
`{ warn, matchTop, block }`. Every `warn` also sets `block`, so the same result
that colours the preview red makes Editor.jsx's groundDown swallow the click;
the UI never says invalid and then places it anyway. A grounded row footed in
the pool is also blocked (`isInsideBowl` on the footprint's centre + four
corners, only while `BOWL.on`) because it would stand on air. Floaters (bones,
letters) sail over it: extents() has no case for them, so they never reach the
test — an air line over the bowl is a line, not a mistake. Invalid cases include
a bury (overlap that isn't the designed ramp-into-deck hole; `rampTopAt`'s rule,
so a flat no taller than the ramp's top is LEGAL and stays quiet, as does an
exactly-flush neighbour under the 0.05 margin), a blocked run-up (the bank1
mistake — a probe 2.2m off the ramp's LOW edge hits something taller than
STEP_UP), and `matchTop`, the vertical twin of the flush-face snap: the flat the
HIGH edge lands against offers its top, and `addRow` sets `y1` to it. Editor.jsx
tints the ghost red on `warn` and writes the message into the store's `hint`
slot ONLY when the string changes (groundMove fires at pointer rate); the panel
shows it in the coach line (`.ed-coach.warn`). Local +Z is a ramp's HIGH edge —
Skatepark draws the coping at +d/2 — and `rot` yaws it to world (sin, cos).
`levelEdits.check.js` covers all four behaviours.

**The ghost is a silhouette, and placement makes a sound.** `ghostShapes()` in
Editor.jsx gives ramps/quarters a real wedge (`buildRampGeometry`), stairs their
steps, rails/lamps/cans cylinders; boxes stay boxes where they are honest. One
shared ghost material (colour mutated at pointer rate — tool tint or invalid red), and
the geometry set is DISPOSED on tool switch or each armed tool leaks its
silhouette to the GPU. `sfxPlace`/`sfxDelete` in AudioManager are the editor's
two one-shots — they call `unlockAudio()` themselves (a placement IS a click,
and the editor never runs the game's start gesture) and are guarded for node
because the level checks import levelEdits, which imports AudioManager. Taller
object, deeper pop.

**The pool is editable and independent.** `BOWL` is not a table
row (an analytic field colliders' `sampleSurface`, `parkGeometry`'s plaza cutout
and Skatepark's `<Bowl/>` each read), so it gets `setBowl(patch)` and a store
selection slot of its own (`bowlSel` — unlike the spawn marker's local
`spawnSel`, the PANEL has to show a card for it). Editor.jsx puts a ring handle
on the rim so you drag it like anything else; the card carries `r0` and
`depthMid`, which a gizmo cannot express. **Pool is a real placement tool:**
when none exists its palette tile arms a rim ghost and the next ground click
places it; when one exists the same tile selects it. The selection card and
Delete key remove it. There is still at most one analytic pool. It owns no wall
or bench rows, so placing one feature never silently places several others.
`rebuildBowlDerived()` remains as compatibility cleanup only, stripping old
`bowl`-marked furniture from pre-change saves. The undo snapshot and save blob
carry the whole bowl, including whether it exists and where it was placed.

**Size steppers are per-AXIS, not one uniform scale.** "Make the ramp bigger" is
three different wishes — wider, longer, steeper — and a uniform scale grants
none of them: it grows run and rise together and the angle never changes. Each
axis reads whichever field that row happens to carry (a box's height is `top`, a
wall's is `h`, a ramp's is `y1`), and `y1` is floored against `y0` because it is
measured ABOVE it, not above the plaza.

**A rail has no fields to step, so it gets its own three.** RAILS carries `pts`
and nothing else a card can drive — no `w`/`d`/`h` for DIMS, no `rot`, no `y` —
so a selected rail used to offer material swatches and stop there, and the only
way to lengthen one was the raw `pts` array the fine-tune drawer hides.
`railLength`/`extendRail`/`turnRail`/`liftRail` (levelEdits.js, so
`levelEdits.check.js` can measure them) mutate the array in place: extend
pushes the LAST point along the FINAL segment, which is what "longer" means on
a curved rail too, and floors that segment at 0.5m because a zero-length one
has no direction left to grow along again (`rebuildPaths` drops it anyway).
Lift floors at 0.2. The check asserts the extension is GRINDABLE, not just
longer: these steppers are the editor's usual claim that a commit reaches the
paths. There is still no per-POINT handle — freeform kinks want one in
Editor.jsx; shaping from the card is what the four steppers cover.

**Bending is a fourth stepper, and walls and rails bend differently because
they ARE different.** A rail is a polyline, so `bendRail` bows the polyline:
resample to 5 points first (a 2-point rail has no interior point to move), yaw
each successive segment by an equal share of the total arc, rebuild end to end,
then recentre on the old centroid. Segment lengths are untouched, so Bend and
Length stay independent steppers and bending doesn't walk the rail across the
park. A wall is a BOX and the sim only understands boxes, so `bend` on a WALLS
row is expanded by `wallSegments()` (levelData.js) into a chain of chords —
`bend` 0 returns the row itself, which is why the shipped park renders
byte-identical and `rails.check.js` still reports 96 lips. All three consumers
read walls THROUGH it (Skatepark's `<Wall>`, `colliders.js`, `rails.js`'s
`lipEdges`), so a bent wall stays ONE editable row with one gizmo and one undo
rather than becoming a `grp`. Two things that bite: a chord takes NO end trim
in `lipEdges` (it has neighbours, not corners — at the usual 0.35 a 1.3m chord
falls under the 0.5 stub test and a bent wall silently stops being grindable),
and the chords overlap by 0.25 so the joints don't open at the outside face.
The pick proxy and `placementInfo`'s footprint still use the straight box —
approximate on a heavily bent wall, and the cheap price of not making it a
group.

**R turns what you are HOLDING.** `addRot` in the store is the armed ghost's
yaw, applied to the row on placement and sticky across placements (laying a row
of angled ledges should not mean re-rotating each one). It only lands on tables
whose renderer reads `rot`; RAILS has no `rot` field at all, so the yaw rotates
its `pts` about the placement point instead. With nothing armed, R falls through
to the gizmo's rotate mode, which is what it means everywhere else.

**Snapping is grid PLUS flush faces, and the object snap wins.** The grid alone
never sufficed: a 4m ledge butted against a 3m planter lands its face on a
coordinate no grid cell expresses, so "snapped" objects still left millimetre
gaps you found by riding into them. `snapLines`/`snapAxis` (Editor.jsx) offer
every other row's centre line and its faces ±the moving object's own half-width,
and an object snap in range BEATS the grid rather than competing on distance —
the grid is always within half a cell, so a distance contest means the flush
snap you actually want almost never wins. Three things it has to get right:
rotated rows are skipped as SOURCES (their faces aren't axis-aligned, so
"flush" is a lie and the AABB would snap you to a corner of empty air; 90° rows
are fine with w/d swapped); only the axes the handle ACTUALLY moved are snapped,
or a single-axis drag jogs the object sideways onto whatever line it was sitting
near; and `translationSnap` on TransformControls is now unset, because TC rounds
relative to the drag START and the two roundings disagree by whatever sub-cell
offset the object already had. Placement and the cursor ghost run the same
`placeAt`, so the ghost is never a preview of a different position than the
click produces. The snap lines are built ONCE per drag — the sources don't move
while you drag one of them.

**The saved level is the editor's workbench, not the game.** `loadLevel()` runs
at import only under `?edit` — a plain visit is always the SHIPPED park, so
somebody else's session can't hand you a level you never built. Going to PLAY
from inside the editor still carries the edits: `setEditing(false)` never
reloads.

**The plaza's baked AO is refreshed for play-test.** `parkAOMap` is the one map
in textures.js NOT cached forever: it bakes a contact shadow under every prop,
so a stale one leaves shadows on the plaza under rows you moved or deleted (and
`mats()` is module-cached). Editor commits refill `AO_FOOTPRINTS` but defer the
1024px blurred bake; entering play-test invalidates the old texture once, and
Skatepark swaps in the refreshed map without changing shader defines.

**The viewport clears while editing, and HELD SPACE is the hand.** Lighting.jsx
drops the `<fog>` when `useEditing()` is true — the far end of the park is
exactly where you place things from, and FOG_NEAR 22 hazes it. Space held swaps
OrbitControls' LEFT button to `THREE.MOUSE.PAN` (cursor `grab`) rather than
adding a second camera path, so damping and TransformControls' `makeDefault`
handover are untouched; `groundDown` returns early while it is held, or the
end of a pan drops a row. keyup is its own listener (the editor's `onKey` is
keydown-only) and `blur` clears it — alt-tabbing mid-hold never delivers the
keyup and the pan sticks on.

**The soundtrack ducks to 30% while editing** (`setMusicDuck` in AudioManager,
called from `setEditing` and once at import when `?edit` is in the URL — that
first entry never goes through `setEditing`). Duck, not pause: silence reads as
broken audio. It is a separate factor from `muted` for the obvious reason —
one variable for both means unmuting while editing comes back at full level.
A palette entry is one control, not two: it arms placement AND scopes the
outliner. `arm()` itself deliberately does not move `table` (Editor.jsx's 1..9
shares it and a hotkey should not yank the list you are reading), so the panel's
`pick` sets the scope alongside it — clicking the armed tool again disarms but
leaves you browsing that table.

**Build -> play -> build is one function, `setEditing(on)`.** Going to play is a
whole fresh run on the edited level — `bumpLevel()`, `resetPlayer()`,
`resetGoals()`, `restart()`, `started: true`, `P.paused = false`, and
`P.intro = 0` because you are testing a ramp you just placed, not being
introduced to the park. Spreading those six across the callers is how one of
them gets forgotten and a playtest starts on the previous level. `P` enters play
and Esc returns; the Esc listener is CAPTURE-phase with `stopPropagation`,
because GameUI has its own window-level Esc (the challenge sheet) that must not
also fire on the way out of a playtest.

**Edits survive a refresh.** `saveLevel()` runs from `bumpLevel()` — undebounced
on purpose, since a commit only fires on drag-end or a field blur, so it is a
handful of small JSON writes a minute. `loadLevel()` runs once at import, inside
a try/catch: a corrupt or stale blob falls back to the shipped park silently,
because a throw there takes the whole game down before the canvas mounts over a
debug feature. Restored rows carry no `__k` (`clean()` strips it) and must be
re-stamped by `keyOf()` or every React key in the panel and the proxy layer is
`undefined`. `SHIPPED` is a deep snapshot taken BEFORE the load is applied —
that is what `resetLevel()` restores to, and it is JSON round-tripped on each
restore rather than handed out by reference, or the next edit mutates it.

**Named user levels are a second store, separate from the workbench.**
`skatedog.levels` holds `{ id, name, at, thumb, data }` entries: `saveLevelAs`
(the panel's 💾 Save, next to PLAY — native `prompt()` for the name) appends
one, the start card's MY LEVELS strip lists them as FILE TILES (the Figma
grammar: full-bleed thumb over a caption with name + "Edited N ago" off `at`,
hairline border that highlights purple on hover, ✕ delete revealed on hover —
always visible under `pointer: coarse`, where there is no hover), and
`/?level=<id>` plays one — applied at module load via `applyBlob`
(the extracted body of `loadLevel`), AFTER `SHIPPED` is snapped, so reset
still restores the shipped park. Playing or building from the home screen is a
full navigation on purpose: `EDIT`, `loadLevel` and the music duck all run at
import. The thumbnail is `thumbCapture` (levelEdits.js), a shared slot
Editor.jsx fills with a gl/scene/camera grab — it renders a fresh frame first
(preserveDrawingBuffer is off, so the buffer must be repainted in the same
task) and downscales to a 320px jpeg data-URL; `saveLevelAs` retries without
the thumb on quota. `levelEdits.check.js` shims localStorage and asserts the
save → list → apply → delete round-trip.

The home library has two separate collections: MY LEVELS is only the user's
stored parks, while CHALLENGES contains protected shipped modes. Its first mode
is **Dog Bowling** (`id: dog-bowling`); it is not written into localStorage and
has no delete control. Its empty plaza carries 151 cans in tight 3x3 bundles on four serpentine
straights, with six 2.8x turn markers and one 3.2x finish marker; the spawn faces
down the first row. Its rules are 30 seconds, only `cans`, and zero completion
bonus. `activeGoals()` derives the hint from live `CANS.length`, so the card
says 151 rather than retaining the shipped park's five-can copy. Its dog is
2.4, the supported maximum, while the boy stays at the normal shipped 1.58;
the dog alone reads as the bowling ball without bypassing the size-aware
animation and steering code. In this can-only
mode the normal score pill is replaced by a live trash-can count, and the run
end card reports cans smashed instead of score; `cansSmashed` lives in the game
store so every hit updates React and every restart clears the count. Saved and
built-in level end cards also offer GO HOME beside PLAY AGAIN; the shipped park
omits it because `/` is already home. Hitting the last can in a cans-only run
ends the run immediately; a full clear gets the celebratory YOU WON / TOTAL
DESTRUCTION card, while a timeout keeps the quieter partial-progress result.
`highScore.js` persists can progress separately under `skatedog.canBest`, and
the CHALLENGES tile shows Not completed + best/total cans or a green Completed
+ total/total label instead of exposing the challenge's internal point score.
CHALLENGES and MY LEVELS open independently in the same top-right library panel
shell, each with its own heading, helper copy, close control and scrollable tile
well. The default current-run card and in-play menu say GOALS so they cannot be
confused with the built-in Challenges library.

`clearAll()` gives you a blank canvas. It is safe with respect to `derived` rows
because the handrail IIFE and `arcWall()` already ran at module load and pushed
plain rows — there is no generator left to disagree with an empty table. The
BOWL is the one park feature that isn't a table row (an analytic field three
systems read), so it gets `BOWL.on` instead of a delete, checked in exactly
three places: `colliders.js`'s `sampleSurface` (or you fall into a hole the
plaza no longer draws), `parkGeometry.js`'s plaza cutout, and Skatepark's
`<Bowl/>`. `BowlProbe` stays mounted either way — it bakes the reflection the
coping AND the three rail materials read, and `Warmup` blocks on the ready
signal it sets, so skipping it strands the loading screen. `SPAWN` is editable
via `setSpawn(x, z)`; `resetPlayer()` reads it fresh, so mutating in place is
enough. All three ride the undo snapshot and the save blob.

`Bones`/`Letters`/`Cans` remount together on mode/run changes so transient
collection state resets. Within one mode each component is keyed on its own
table snapshot; adding a can does not also rebuild every bone and text glyph.

The model is blunt on purpose: **the editor mutates `levelData`'s exported
arrays in place.** There is no document format to keep in sync — the level IS
the document. Everything downstream is one of two kinds:

- **A pure function of those arrays** (Skatepark/Props geometry). `Game.jsx`
  passes `levelV` as a render signal. Skatepark turns each mutable table into a
  primitive content key and remounts only that small reader: a wall commit
  rebuilds walls, a ramp commit rebuilds solids, and unchanged pool, furniture,
  foliage, and reflection resources survive. Do not key the whole Skatepark:
  that rebuilt every authored GPU object for one placement.
- **A module-load snapshot** (`colliders.js` builds `cols` + the broad-phase
  grid at import; `rails.js` builds `PATHS`). Those got `rebuildColliders()` /
  `rebuildPaths()`, which refill the **same arrays in place** — PlayerController
  holds `COLLIDERS` and `PATHS` by reference, and reassigning would leave the
  sim on the old geometry while the render showed the new. `bumpLevel()` calls
  both, then bumps the version. Without this the editor is visual-only: you
  move a ramp and ride through where it used to be. `levelEdits.check.js`
  asserts a moved `qp1` moves its collider and a new wall grows its two lip-edge
  grind paths.

Everything is a **proxy layer**, never a gizmo on the baked scene: one pickable
box per row in a group that is a *sibling* of Skatepark's root, so it gets
normal matrix updates. Idle proxies are `opacity 0`, not faint — a raycast
needs a hit, not a pixel, and ~90 overlapping boxes at 0.06 hazed the whole
frame white. The `<Grid>` sits at **y = −0.02, under the plaza**, for the same
reason: 4mm above the floor its lines converged at the grazing angle into a
200m white sheet over the park.

Things paid for already:

- **`derived: true`** marks a row recomputed from another (currently the
  handrails from their stair). `editable()` filters them out — offering one
  hands you an edit that vanishes on reload.
  `TREES`/`SHRUBS` aren't tables at all; they're seeded IIFEs over `PERIMETER`
  (that's what `FoliageControls` is for).
- **`__k`**, a stable per-row editor key assigned once. Several tables carry no
  `id`; array indices break proxy/outliner identity the first time you delete
  or duplicate.
- **Inspector inputs are keyed on the row's `__k` AND the version.** Keyed on
  the field name alone, React reuses the input instances across a selection
  change and the new row shows the previous row's drafts — a LETTER rendered as
  `id: pad2, x: 2, z: 26` the first time this was measured. Fields commit on
  blur/Enter, never per keystroke: a commit rebuilds colliders and refreshes the
  affected authored table.
- **Undo is whole-level snapshots**, not a command log — the level is a few kB
  of plain JSON. `restore()` replaces the row objects wholesale, so both the
  gizmo and the panel have to re-resolve the selection by `__k` afterwards.
- **`TransformControls` needs `makeDefault` on `OrbitControls`** — drei reads
  `useThree(s => s.controls)` and disables it mid-drag; without it they fight.
  Nothing writes to a row during a drag (`onObjectChange` is per-frame); the
  write-back happens once on `dragging-changed` false.
- **Rotate is gated per table** (only rows with a `rot`), and there is no scale
  gizmo: three's is local-space only, and `w`/`d`/`h` are numbers the panel
  edits directly. The Y translate handle is gated the same way (`SHOW_Y` =
  BONES/LETTERS/RAILS): everything else is placed on the ground by its own
  `base`, so `writeBack` discards Y — and a handle you can drag that does
  nothing reads as a broken gizmo, not as a constraint.
- **Adding is click-to-place, and while a table is armed nothing else
  raycasts.** `arm(table)` (1..9, or the panel palette) puts the editor in a
  placement mode; a ghost the size of that table's footprint follows the cursor
  (mutated directly — it fires at pointer rate, so a store write per move is a
  re-render per move), and the ground plane's click drops a snapped row at the
  hit point and STAYS armed, so a row of cans is one trip. Every proxy takes
  `raycast = () => null` while armed and the gizmo is unmounted entirely —
  ~90 invisible proxies and a set of gizmo handles otherwise sit between the
  cursor and the ground plane, and an opacity-0 box eating a placement click
  is indistinguishable from a bug. `select()` clears `add` by design (clicking
  an existing row means you are inspecting now), so the placement path selects
  the new row through `set()` instead.
- **SPAWN is gizmo-able but is not a row.** It is a bare object in levelData,
  not a table, so the panel's `editable(table)` would throw on it — the
  marker's selection lives in Editor.jsx's own `spawnSel`, not in the store's
  `row` slot, and it keeps the two in sync by SUBSCRIBING to the store rather
  than running an effect on `row` (setState in an effect body is a cascading
  render; the panel can select a row this component never sees as a prop).
  Drag-end writes `SPAWN.x/z` (or `.heading` in rotate) directly and calls
  `commit()` rather than `setSpawn()`, which opens with its own `begin()` —
  the drag start already pushed one, and two snapshots is two undos for one
  drag. `begin()`'s snapshot carries `spawn`, so it is undoable either way.
- **Export is the CLIPBOARD, not codegen.** `levelData.js` is ~60% load-bearing
  commentary and its rows carry derived expressions (`h: DECK + 0.7`,
  `rot: Math.PI`); a round-tripper flattens both and silently unlinks a row from
  the constant it was authored against. You paste a table and read the diff.

Nothing here touches `?shot=` or the node checks.

## Seeing your changes

**Do not eyeball it, and do not trust a diff.** The game has a deterministic
photo mode: `?shot=<pose>` freezes the sim, parks the camera on an authored pose,
pins the wind clock and flips `window.__shotReady`.

```bash
node tools/shoot.mjs --tag mywork plaza bowl   # -> shots/mywork-{plaza,bowl}.png
node tools/shoot.mjs --tag mywork              # all six poses, ~45s
node tools/px.mjs shots/mywork-bowl.png open,0.62,0.90,16   # measure a patch
node tools/compare.mjs ref/ref-plaza.png shots/mywork-plaza.png out/ key.json
```

Poses: `plaza bowl hero props grove deck pipe bench lamp`. `plaza` and `bowl` are framed to match
the two reference stills, so they can be compared directly.

`compare.mjs` builds a **blind** A/B sheet — reference and capture side by side,
labelled A/B in a randomised order, key written wherever you point it. Judging
your own work against a labelled pair is worth very little.

Notes:
- The harness runs its own dev server on **3210** so it never fights yours on 3000.
- `tools/chrome.mjs` picks the Chrome build. **148.x is excluded on purpose**: its
  headless shell never fires ResizeObserver, so react-use-measure reports no size,
  R3F's Canvas never builds its renderer, and the page sits there rendering
  nothing with no console error. A ten-line R3F scene reproduces it.
- `?ao=1` renders the AO buffer alone — worth checking before concluding AO is
  missing, since a crushed histogram looks identical to a dead AO pass.

## Self-checks

Plain `node`, no framework. Run them after touching what they cover.

```bash
node src/game/level/foliage.check.js       # crowns, branch coverage, colour space
node src/game/level/benches.check.js       # bench facing + footing vs walls/planters/decks
node src/game/level/rails.check.js         # rail/post clearance vs walls, props, solids, other rails; lip-edge grinds
                                           # samples the DRAWN catmull-rom curve, not the authored polyline
node src/game/level/bones.check.js         # bone + D-O-G float band/spacing, can clearance
node src/game/level/decals.check.js        # floor decals: on flat plaza only, in bounds, low contrast, inside the atlas gutter
node src/game/level/levelEdits.check.js    # ?edit: a commit reaches the colliders and the grind paths, undo unwinds it;
                                           # blank canvas is still rideable, save/load round-trips SPAWN + BOWL.on,
                                           # resetLevel restores the shipped park, and a rot-less wall can't NaN the sim
node src/game/goals.check.js               # each challenge pays once for +15s; predicates discriminate
node src/game/level/ramps.check.js         # every ramp + stair enterable, climbable, qp1 pops vert, early pop transfers to deck
node src/game/level/collision.check.js     # ~40s: broad-phase coverage, wall penetration, ramp seams, drops, dt consistency, perimeter
node src/game/input.check.js              # world-directional touch stick converges on the stick angle
node src/game/player/steering.check.js
node src/game/player/scoring.check.js      # live grind payout + combo multiplier chain
node src/game/player/boneRig.check.js      # rider joint angles, in world space
node src/game/components/shadowfit.check.js
node src/game/components/clearCoat.check.js   # standard -> physical material swap
node src/game/components/recolor.check.js     # rider shirt hue rotation
```

`boneRig.check.js` rebuilds boy.glb's skeleton straight out of the glTF node
tree (no loader, no DOM) and runs the same call sequence `Rider.jsx` runs, then
measures the result in world space. It is the only thing standing between a
sign error and a knee that bends sideways — a wrong axis still produces smooth,
finite, plausible numbers. It caught the A-pose bind below on its first run.

`foliage.check.js` earns its keep: it caught a floating crown and bare branch
shafts in the same session it was written, then a planter bed that was 26% bare
soil — which turned out to be the `prng` bug below, not the bed. When you add a
visual invariant, add the assertion — "leaf near the tip" passed while every
branch was bare along its shaft, and every row of a half-empty bed was finite,
in range and above the soil plane.

Two of its assertions are worth knowing about before you tune the plant tables:
a **grain** check (a clump must stay under 32% of the mass it sits in, and
`n * ratio^2` must clear 0.9 so shrinking clumps without raising the count does
not open the canopy into lace) and a **coverage** check that rasterises a bed's
plan and demands 82%+ closed — deliberately NOT solid any more, see the pushBed
notes above; the reference's own bed shows soil-dark gaps between rosettes and a
bed that rasterises solid is a bed you cannot count a plant in.

## Gotchas paid for in blood

- **The dog's fit is measured, not typed.** `Box3.setFromObject` on a
  SkinnedMesh returns the *skinned* rest bounds (three calls the mesh's own
  `computeBoundingBox`), which is what Dog.jsx scales by — the raw position
  attribute is quantized and pre-skinning, so reading it directly gives half
  the size and a mesh centred on the wrong y. The dog is authored nose at +X,
  so the wrapper yaws it -90 degrees; consequently a dog bone delta swings
  fore/aft about **Z**, an ear flaps about X and the tail wags about Y.
  `BACK_Y` (0.355) is where the rider's feet go: the fitted back tops out at
  0.375 and the feet sink 0.02 into the coat.
- **A ramp is not a box, and it is a hole in the deck it feeds.** Both halves of
  that shipped broken and between them nothing in the park could be ridden.
  `resolveCollision` tested a ramp by `max(y0, y1)`, so the entire footprint was
  a 1.6m wall at plaza height — rolling at bank1's low end ejected you **4.9m
  sideways**, and every ramp and stair in the park was impassable. Then, because
  qp1's coping sits 0.5m *inside* deckA's footprint and it is a quarter,
  deckA's face stopped you halfway up, and the moment `STEP_UP` could reach its
  1.6 top `sampleSurface` teleported you onto the deck and reprojected the
  climb away. Both are now the same rule, `rampTopAt()`: a ramp's footprint
  suppresses any FLAT no taller than the ramp's top, and the ramp itself is
  measured at the nearest point of its footprint rather than at its peak. Walls
  and the dividers flanking the transitions are taller, so they still block.
  (A "0.83m up where the deck starts" figure once quoted here was the
  arc-length bug below being measured, not level geometry.)
- **The ramp's arc length starts at the low edge the footprint kept.** The
  footprint grows by `RAMP_OVER` *uphill only* — centre shifted +RAMP_OVER/2,
  so the low edge stays at `lz = -hd` exactly and `s = lz + hd`. Subtracting
  `RAMP_OVER/2` again double-counted the shift and slid every transition's
  collision 0.5m uphill of its drawn mesh: qp1 read 0.825 where the coping
  tube is drawn at 1.6, and every ramp-to-deck seam hid a 0.1–0.78m trench
  that `STEP_UP` silently jumped (a 0.39m cliff at the halfpipe's "seamless"
  deck handoff). Nothing asserted mesh-vs-collider agreement, so it survived
  every ride-through test — the park was rideable, just 0.5m wrong.
- **The broad phase must be dilated by the query radius.** Colliders were
  bucketed by their raw AABB, and `bucket()` returns one cell — so a 0.5m
  circle standing just inside a cell boundary overlapped colliders only the
  NEXT cell knew about. 22 of 58 colliders were reachable from cells that
  never tested them; the pad2 skirt wall's face lands exactly ON a boundary
  (z=30, CELL 6) and let the full body embed 0.5m before the far cell ejected
  it in a one-frame snap-back. `GRID_PAD` (0.6 ≥ player RADIUS) on the
  bucketing bounds is the whole fix.
- **Ground adhesion must be geometric, or every deck edge is glue.** A real
  convex lip drops ~speed·dt per substep (0.11m at full speed); the old
  constant 1.5m tolerance also caught pad1 (1.2) and pad2 (0.9), so rolling
  off either snapped you to the plaza without one airborne frame and then
  side-ejected you 0.5m when the deck reclassified from floor to wall. The
  branch now uses `max(0.12, speed·dt·2)`. In the same family: air landing
  now samples with the same `feetY` the resolver used (a +0.4 offset opened a
  band where a planter's side was "not a wall" but its top was "a floor"),
  grind entry projects velocity onto the rail tangent (the 3D magnitude turned
  a 9 m/s fall into 9 m/s of rail speed), `doJump` zeroes the coyote window (a
  double-tap inside 0.13s stacked two jumps into a 5.2m ollie), and
  `slideAlongWall` only steers the heading on the ground (an air graze folded
  into the spin bookkeeping and failed clean landings you never mis-rode). Crossing a ramp's top, `gap` is ~0,
  so the ground-snap branch caught it and `reproject` deleted the entire
  vertical velocity — a quarter pipe returned you to the deck at walking pace.
  The test is the velocity's separation from the NEW normal (`sep`): on the ramp
  it is 0 (linear) or negative (concave), and only at the lip does it go
  positive. Past that, `launchOffLip()` rotates the exit toward vertical with
  the lip angle, conserving speed, and overshoots to a slightly NEGATIVE
  horizontal so a vert air re-enters the transition it left instead of clearing
  the flat overhang. Banks sit below `VERT_LO` and still launch you forward.
- **A wall cap is landable, never steppable.** The dividers flanking the
  stairs and the deck skirt caps top out at exactly deck + 0.55 = feetY +
  STEP_UP, so the plain limit test hoisted you up and OVER every wall beside
  a staircase (and an air whose feet were within 0.55 of the cap top passed
  straight through it). Caps now take `CAP_STEP` instead of STEP_UP, and it is
  split by where the body is: 0.3 when the centre is INSIDE the footprint
  (a landing frame sinks ~0.12m below the top before stepAir's land check
  fires — a solid cap side-ejects the clean landing) but ~0 when OUTSIDE
  (pressing into the FACE is always a wall; a flat band there let the body
  embed while "steppable" and ejected the accumulated depth in one 0.32m
  lurch when the feet crossed the threshold). Making the caps solid also
  created corner pockets (divider face + planter corner) that the resolver's
  4 passes couldn't walk out of — it runs 8 now, and breaks early the first
  pass nothing moves. collision.check.js `walls/cap-step` rides the deck into
  every stair-flanking cap and asserts it blocks; its bruteResolve reference
  mirrors the shipped eject cap or wedge escapes it can't do read as
  broad-phase misses.
- **Wall response is rate-based, or the camera lurches.** `slideAlongWall`
  once cut speed 55% and snapped the heading 35-80% toward the tangent *per
  substep* — a head-on hit lost ~96% of its speed and whipped the rendered dog
  (yaw = P.heading) inside one frame, and the camera's look-ahead point
  (pos + vel·k) lurched with it. Both are dt-scaled now (bleed ~0.25s, turn
  6-14 rad-eq/s). Two traps in slowing it down: a near-dead head-on hit leaves
  no tangential velocity to choose a tangent from, and in an inside corner
  (pad1 SW, measured pinned 3.3s under throttle) the two faces' pure tangents
  each point into the other wall, so the heading oscillates in place while
  eject/refill nets zero movement. The turn target therefore blends the
  OUTWARD normal by `headOn` (glance → tangent slide, head-on → back away at
  ~45°), with a facing-based fallback below 0.05 m/s. collision.check.js's
  graze/stuck assertion covers it. The into-wall velocity component still
  vanishes in one substep (it must), so CameraController aims its look-ahead
  and speed-zoom off a ~0.2s-smoothed copy of P.vel, never the raw value.
- **An ollie at the coping was being eaten, and the fix has to live in
  `doJump`.** The launch branch sets state to `air`, so the usual
  `if (jumpBuffer && state === 'ground') doJump()` at the bottom of the step
  never ran and popping at the lip did literally nothing. That branch spends the
  jump itself now. But the press almost always lands a frame or two BELOW the
  lip, on the ordinary jump path — so `doJump` calls `launchOffLip()` too, or a
  pop a hair early takes the untouched tangent and sails onto the deck, which is
  the one thing the whole change exists to stop. Do not apply the redirect in
  both places; the second pass flips the horizontal back forward. The coyote
  jump in `stepAir` zeroes `P.slope` first, because you are jumping off nothing
  and a stale lip angle would redirect it. Flatground ollie is 1.28m and
  unchanged (`slope 0` -> the redirect returns immediately); off qp1's coping it
  is 3.9-6.0m above the coping depending on entry speed, versus 1.0-2.4m just
  rolling. `JUMP_V` is the knob if that is too much.
- **Free thrust is what made ramps feel wrong, twice.** Full `ACCEL` up a
  65-degree wall returned more energy than the climb cost — a 1.6m quarter threw
  you 3m over the coping for holding W — so ground drive now scales by `n.y`.
  And 4.5 m/s² of air throttle over a one-second vert air is 4.8 m/s, which
  exactly cancelled the drift back into the transition and put you on the deck
  every time. It is deleted, for the same reason there is no air steering.
- **A downhill must pay gravity visibly.** The surface-tangent gravity term is
  scaled by `SLOPE_GRAVITY` while grounded (airtime still uses `G` unchanged),
  and rolling resistance scales with the surface normal's `n.y`. Applying full
  flatground `ROLL_DRAG` on a near-vertical halfpipe wall erased most of the
  descent's gain. `ramps.check.js` now coasts down hpN with no throttle and
  asserts that the low edge is faster than the entry.
- **bank1 was buried inside deckB** — a 0 -> 1.6 ramp sitting inside a slab
  already at 1.6. It drew nothing, and its only approach ran through 4m of solid
  deck. deckA is walled west and north with stairB + qp1 between two dividers on
  its south face, and deckB is a walled platform already fed by stairC and
  bank2, so there was nowhere to move it. Deleted. Before adding a transition,
  check it has a face AND a run-up.
- **An imported bone does not rest at identity.** The pose table was authored
  against groups whose rest orientation was identity, so `rotation.x = angle`
  meant something. boy.glb's `L_Thigh` rests near 180 degrees about Y. Writing
  the same Euler onto the bone rotates about a different axis and the leg swings
  out sideways. Every angle goes on as a world-space delta conjugated into the
  bone's rest frame instead (`setBone`).
- **The bind pose is not the pose the numbers mean.** Tripo shipped a relaxed
  A-pose: the right knee already flexed 0.31 rad, the right shin splayed 0.18
  rad out of the sagittal plane, and the two legs 17% different in length. So
  `knee = 0.30` meant two different things on the two legs, and the stance came
  out lopsided in a way that looks like a pose bug rather than a rig bug.
  `alignBone` bakes a fixed per-bone correction so a zero angle is straight
  down on both sides. The leg lengths cannot be corrected the same way — the
  pelvis-height math uses the mean, which floats one foot ~1.5cm and sinks the
  other by the same.
- **A prop's rot is a facing, not a normal.** `rot` yaws local +Z to world
  `(sin rot, cos rot)`, and a bench's local +Z is the *seat front*.
- **A bench slat is one board, so its grain runs along its LENGTH.** The slats
  wear the ramp ply maps (`woodMap`/`woodNormal` — cached, so no second wood
  canvas), whose planks run along canvas *v*; `slatGeo` therefore writes v from
  local x and u from the short axis. It rides ONE of the tile's seven planks and
  which one is measured, not picked: 6 is the darkest tone (RAMP.wood at 0.20),
  a slat is parked on its CENTRE with only ±0.04 canvas of span (or the black
  plank-edge line runs as a groove down the middle of every slat), and v starts
  clear of that plank's butt seam — the slat spans 0.83 canvas and leaves 0.17
  of slack, so a seam inside the span lands in the SAME place on all seven and
  reads as one straight crack across the whole bench. The material tint is NOT
  `C.benchWood`: it multiplies a map that already carries a mid-tan. It was
  SOLVED against a capture rather than derived — map average, grain passes and
  the tone curve all move it — and lands a sunlit seat at (191,153,116) against
  benchWood's (184,146,110). Re-measure it if the light rig moves. It has since
  been warmed a notch off that solve (#9f9aa3 -> #a89a90, same luma, hue to tan)
  and the material is MeshPhysicalMaterial for `sheen` — a varnished slat wants a
  soft grazing bloom, and clearcoat (rider-only, see clearCoat.js) reads as wet
  plastic on wood. Bench-only material, so the halfpipe ply captures are
  untouched. `woodRough` is
  a remap of the SAME height field `woodNormal` is sobelled from (`plyHeight`,
  now cached separately) — a ridge the normal bumps up is a ridge the varnish
  makes glossier, and a seam, black in the height, clamps back to the authored
  roughness. The ramp materials deliberately still go without it: they are what
  the halfpipe captures are compared against.
- **A handrail is generated, so it doesn't know what it's standing in.**
  `handrail()` offset the rail `w/2 + 0.5` from the stair's centreline — just
  outside the tread. stairB is wedged between deckA's retaining wall and a
  front-edge divider, and stairC's two "side walls" hug its cheeks exactly, so
  three of the five handrails ran their tube AND their ground posts through a
  wall. Nothing looks wrong from a distance: the tube is 5.5cm and the wall is
  opaque. Those three took an explicit inset `off`. Then the remaining two —
  stairA's, on a staircase with no walls near it at all — turned out to be
  buried in the STAIRCASE ITSELF: `Stairs` draws a masonry stringer down each
  cheek spanning `|lx| = w/2 .. w/2 + 0.5`, so `w/2 + 0.5` is that wall's outer
  FACE and half the tube lived inside it for the whole run. The stringer is
  drawn geometry, not a `WALLS` row, so the check had nothing to test against.
  The default is `w/2 - 0.7` now — every handrail in the park runs inside the
  treads, there is no outside — and `rails.check.js` carries the stringer's box
  and walks the DRAWN catmull-rom curve at 10cm.
- **A row built outside levelData's `box()`/`wall()` factories arrives without
  `rot`/`base`, and NOTHING downstream defaults them.** `rails.js` does
  `Math.cos(w.rot)` and `colliders.js` does `base + h`; `Math.cos(undefined)` is
  NaN, so every point of that wall's two lip-edge grind paths was NaN. That is
  not a wonky wall. `rebuildPaths` tested `l < 1e-4` to drop a degenerate
  segment and **NaN fails that test**, so the segment was KEPT with a NaN
  tangent; then in `closestOn`, `d2 < best.d2` is likewise false for NaN, so
  `best.tan` stayed null and `findGrind` dereferenced it. Rolling anywhere near
  a newly placed wall took the whole sim down —
  `Cannot read properties of null (reading 'x')` in `findGrind`. Three fixes,
  all needed: the editor's `DEFAULTS` carry every field their consumers read,
  `heal(table, row)` refills them on load and on a `kind`/`style` switch (a box
  row switched to `ramp` has no y0/y1/curve, and `steps` has no default at all),
  and both tests are NaN-safe now (`!(l > 1e-4)`, `if (!hit.tan) continue`) so a
  bad row degrades to "not grindable" instead of ending the run.
- **TiltShiftEffect carries two masks that disagree.** The blur material ramps
  its strength with a smoothstep across `[focusArea - feather, focusArea]`, but
  the composite that picks blurred-vs-sharp is `step(offset-b) - step(offset+b)`
  with `b = focusArea - feather` — it flips at the INNER end of that ramp, so a
  blurred pixel is never mixed with a sharp one anywhere on the frame. The
  result is a razor line, and on an inked frame it separates "has outlines"
  from "has none", which reads as a UI overlay clipping the render rather than
  as depth of field. ToonFX.jsx overwrites `fragmentShader` with the same ramp
  crossfaded, driven by an added `bandParams` vec4 — whose slots are NOT in
  ascending order (`inner-, outer-, OUTER+, inner+`), because the shader reads
  the upper edge as `smoothstep(w, z)`. Writing them ascending reverses that
  smoothstep: the top half stays permanently sharp and the bottom half goes to
  `mask = -1`, and a negative mask makes `mix()` extrapolate *past* the sharp
  frame, so the blurred half returns with bright fringes on every dark edge.
  The composite is also one-sided now: only the band's UPPER edge fades, so the
  frame below it is always sharp and slots x/y go unused (they stay in the
  uniform because the JS still mirrors the blur material's params).
  Also note the mask lives in
  NDC scaled by aspect on x, so `focusArea = 1` spans half the frame HEIGHT but
  only ~0.62 of half its width — a slider capped at 1 cannot reach the edge of
  a 90°-rotated band.
- **`MeshPhysicalMaterial.copy` cannot read a standard material.** It pulls
  clearcoat, sheen, iridescence and transmission straight off the source, so
  copying a MeshStandardMaterial in lands every physical parameter as
  `undefined` — NaN uniforms, and a rig that renders plausibly matte rather
  than erroring. `clearCoat.js` borrows `MeshStandardMaterial.prototype.copy`
  instead and puts the `PHYSICAL` define back, since that copy rewrites
  `defines` to STANDARD-only and the clearcoat chunks then never compile.
  `USE_CLEARCOAT` is likewise a define keyed on `clearcoat > 0`, and the
  renderer only re-picks a program when the material version moves — so 0 to
  0.4 renders identically without a `needsUpdate` on that crossing.
- **Instance colour space.** `bake()` reads row slots 9-11 as an *absolute
  linear* colour and divides the material base out to recover the multiplier.
  Emitting a multiplier there instead asks for `instanceColor` ~3.2 and renders
  white. This turned every trunk in the park into a pale stick.
- **Wind and non-uniform scale.** The wind shader inverts the instance basis
  per-column. An earlier version divided all three axes by column 0's length
  squared, which is only right for uniform scale — branches scale
  `(0.085, 0.9, 0.085)`, so they got 139x the displacement and flew off.
- **Tone-map operating point.** Khronos PBR Neutral is identity below linear 0.76
  then compresses hard. Sitting the plaza at 1.6 gives the curve a slope of 0.05,
  where *no* shading — occlusion, contact, texture variation — can move a sunlit
  pixel.
- **Cylindrical UVs converge.** The bowl's flat uses a planar mapping confined to
  a uniform strip of the texture. Carrying the cylindrical mapping across it puts
  a singularity at the centre, and since no tangent attribute is supplied three
  derives the frame from screen-space UV derivatives — producing a starburst even
  where the texture is a single colour.
- **`v=1` is the TOP of the canvas** under three's default `flipY`.
- **The shadow fit plane is latched, not live.** Lighting.jsx fits the shadow
  box where the camera frustum crosses the plane at player height — fed by
  live `P.pos.y`, a high ollie moved that plane every airborne frame and each
  QUANT crossing remapped the whole shadow map (shadows visibly redrew
  mid-jump). `planeY` only updates when `P.state !== 'air'`.
- **N8AO's `quality` prop** silently overwrites `aoSamples`, `denoiseSamples` and
  `denoiseRadius` in a second layout effect. Set them by hand.
- **The `prng` LCG needs `Math.imul`.** `seed * 1103515245` overflows 2^53 once
  the seed is near 2^31, so the low bits are noise and the sequence falls into a
  short orbit — 692 distinct values in 5000 draws. It went unnoticed for as long
  as every consumer drew a few dozen values; `pushBed` draws thousands and the
  bed came out as 94 columns of identical clumps. All four copies use `imul` now.
- **One stream per PLANT, never one per planter.** `Planters` used to make a
  single `rnd` and hand it to `pushTree` first and `pushBed`/`pushBlooms`
  second, so the bed's draw began at whatever offset the tree happened to leave
  the sequence at — and any tree edit changes how many values the tree consumes.
  Raising the crown clump counts therefore re-randomised every rosette, berry
  knot and daisy in every planted bed: a pixel diff measured the static planter
  frame at 1.5% changed and the bed interior at 50-69%, on bed tables that were
  byte-identical. It is `bedRnd` (7331) and `treeRnd` (8101) now, and the
  independence is provable — perturb `SPECIES.blossom.massClumps` and the
  `foliage`/`flowerYellow`/`flowerWhite` rows come out identical. (`flowerPink`
  is a SHARED bucket — tree blossom and bed accents both land in it — so its
  array order still moves; the bed's own rows in it do not.) Lawn trees and lawn
  shrubs were never exposed to this: they already take a per-instance stream.
- **Foliage colour is set by histogram, not by patch.** Two sampled patches
  cannot see a distribution that is the right shape at the wrong centre, which
  is exactly what shipped: crown and core both landed near target while the
  MODE of the canopy sat 20 lightness points above the reference. Bin every
  green pixel (`hue 40-140, sat > 0.14`) by lightness and compare the curves.
  Crop to the crowns first — a grove capture is mostly LAWN, and lawn passes
  the same green filter, so an uncropped histogram measures the field and
  reports that nothing is wrong. Cropped, the canopy read mode L42 / hue 67 /
  sat 24 against the reference's L22 / 77 / 38 long after that diagnosis was
  written: the note was right and the albedos were never actually moved. They
  are now (`leaf*` in palette.js, one third of a stop down, greener, and
  saturated PAST the reference because averaging ~100 differently-lit clumps
  per crown plus a violet ambient eats ~10 points before the frame is drawn).
  Then the SAME failure repeated one axis over. Against ref-foliage the crowns
  measured hue 78 / L0.43 / **sat 0.36** where the reference is 78 / 0.41 /
  **0.53** — hue and value dead on, chroma 17 points short, which is a shape a
  two-patch check cannot see for exactly the reason above. So histogram
  saturation and hue, not only lightness, and crop the TREE and the BED
  separately: the reference's bed is hue 90 and its crown is hue 78, a full ramp
  stop apart, so one `leaf*` trio measured over both averages the difference
  away. That split is why `shrub` is greener than `leaf` now, and why the leaf
  stops carry s74-86 to render at s48-50.
- **A canopy ramped by height alone reads as noise.** From a 40-degree camera
  every leaf mass presents its equator, so a height ramp resolves into
  concentric bands and the eye reads the leftover per-clump jitter instead.
  foliage.js ramps along the KEY'S BEARING too (`SUN_FACE`, from LIGHT.sunDir),
  which is what gives a mass a light side and a dark side; it costs nothing,
  the colour is per-instance and baked once. Keep it under ~0.25 or the sunlit
  clumps all clamp to the top stop and read as bright blobs stamped on a dark
  crown. The shaded end of the ramp is also LIFTED a third toward the mid
  (`SHADE_LIFT`): raw leafDark plus the interior `deep` term landed near L07 —
  near-black grit in every crown, and a leaf in shadow is still lit by the
  violet sky (SHADOW_TRANSFER bottoms out at 0.62, not 0).

## Conventions

- `P` (store.js) is mutable per-frame state read inside `useFrame`. Never put it
  in React state.
- The stable Skatepark parent bakes its world matrix once. Content-keyed table
  subtrees use normal child matrix updates when an editor commit replaces one.
- Zero allocation inside the frame loop. Particle pools are fixed-size with
  round-robin allocation; reuse the module-scope temporaries.
- Target 60fps at 1600x1000. Currently ~120. `useGame(s => s.quality) === 'low'`
  scales expensive work down.
- Comments explain **why**, with the measurement that forced the value. This
  codebase is dense with them on purpose — they are the record of what was
  already tried and why it failed.

## Licence

Source is PolyForm Noncommercial 1.0.0 (`LICENSE`), commercial use by separate
paid licence. So: no copyleft dependencies, and
`public/{boy,dog_compressed}.glb`,
`public/songs/*` and `ref/*` are carved OUT of the grant — they ship so the
project runs, they are not licensed for reuse. README.md is the public-facing
version of this file.
