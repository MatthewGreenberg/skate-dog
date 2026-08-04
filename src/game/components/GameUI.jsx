import { useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { useGame, P } from '../store.js'
import { GOALS, resetGoals } from '../goals.js'
import { BONES } from '../level/levelData.js'
import { resetPlayer } from '../player/PlayerController.js'
import { touch, touchJumpDown, touchJumpUp, TOUCH } from '../input.js'
import { unlockAudio, setMuted, isMuted } from '../audio/AudioManager.js'
import { PHOTO } from '../photo.js'
import './ui.css'

const NUM = new Intl.NumberFormat('en-US')

function BoneIcon() {
  // two round lobes at each end joined by a thick bar
  return (
    <svg className="hud-bone" viewBox="0 0 44 26" aria-hidden="true">
      <g fill="#fff">
        <circle cx="8.4" cy="7.3" r="6.4" />
        <circle cx="8.4" cy="18.7" r="6.4" />
        <circle cx="35.6" cy="7.3" r="6.4" />
        <circle cx="35.6" cy="18.7" r="6.4" />
        <rect x="7" y="9.4" width="30" height="7.2" rx="3.6" />
      </g>
    </svg>
  )
}

// four toes + a pad. Rotated outward so it reads as a print, not a flower.
function PawIcon() {
  return (
    <svg className="hud-paw" viewBox="0 0 29 26" aria-hidden="true">
      <ellipse cx="5.5" cy="12" rx="3.1" ry="4.1" transform="rotate(-22 5.5 12)" />
      <ellipse cx="11" cy="7.2" rx="3.2" ry="4.3" transform="rotate(-8 11 7.2)" />
      <ellipse cx="18" cy="7.2" rx="3.2" ry="4.3" transform="rotate(8 18 7.2)" />
      <ellipse cx="23.5" cy="12" rx="3.1" ry="4.1" transform="rotate(22 23.5 12)" />
      <ellipse cx="14.5" cy="19.2" rx="7.4" ry="5.7" />
    </svg>
  )
}

// stopwatch: crown bar + stem, a side button, and hands at 12-and-3
function ClockIcon() {
  return (
    <svg className="hud-clock" viewBox="0 0 26 28" aria-hidden="true">
      <g fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 2.6h6" />
        <path d="M13 2.6v3.2" />
        <path d="M20.8 6.1l1.7 1.7" />
        <circle cx="13" cy="16.6" r="9.1" />
        <path d="M13 11.6v5h3.9" />
      </g>
    </svg>
  )
}

function ScorePill() {
  const score = useGame((s) => s.score)
  const pillRef = useRef(null)
  const numRef = useRef(null)
  const shown = useRef(0)

  useEffect(() => {
    const from = shown.current
    const to = score
    if (from === to) return
    if (to > from && pillRef.current) {
      const el = pillRef.current
      el.classList.remove('pop')
      void el.offsetWidth // restart the keyframes
      el.classList.add('pop')
    }
    const t0 = performance.now()
    let raf = requestAnimationFrame(function step(t) {
      const k = Math.min(1, (t - t0) / 350)
      const e = 1 - (1 - k) * (1 - k) * (1 - k)
      shown.current = from + (to - from) * e
      if (numRef.current) numRef.current.textContent = NUM.format(Math.round(shown.current))
      if (k < 1) raf = requestAnimationFrame(step)
      else shown.current = to
    })
    return () => cancelAnimationFrame(raf)
  }, [score])

  return (
    <div className="hud-pill hud-score" ref={pillRef}>
      <PawIcon />
      <span className="hud-score-value" ref={numRef}>
        0
      </span>
    </div>
  )
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

// The run clock. The store only holds whole seconds (GameLoop mirrors P.timeLeft
// when the displayed second changes), so this re-renders ~1Hz — and every
// re-render where the value went UP is a bonus, which is what `pop` marks.
function TimePill() {
  const timeLeft = useGame((s) => s.timeLeft)
  const ref = useRef(null)
  const prev = useRef(timeLeft)
  useEffect(() => {
    const up = timeLeft > prev.current
    prev.current = timeLeft
    if (!up || !ref.current) return
    const el = ref.current
    el.classList.remove('pop')
    void el.offsetWidth
    el.classList.add('pop')
  }, [timeLeft])
  return (
    <div className={timeLeft <= 20 ? 'hud-pill hud-time is-urgent' : 'hud-pill hud-time'} ref={ref}>
      <ClockIcon />
      <span className="hud-score-value">{mmss(timeLeft)}</span>
    </div>
  )
}

// The challenge list. NOT permanent HUD furniture any more — you read it on the
// start card before the run and behind the ☰ button during it. Eight rows of
// to-do sat over the park the whole session and nobody reads them while
// steering; the trick popup already announces each one as it lands.
function GoalList() {
  const goalsDone = useGame((s) => s.goalsDone)
  return (
    <div className="hud-goals">
      {GOALS.map((g) => {
        const got = goalsDone.includes(g.id)
        return (
          <div className={got ? 'hud-goal is-got' : 'hud-goal'} key={g.id}>
            <i />
            <b>{g.label}</b>
            <span>{g.hint}</span>
          </div>
        )
      })}
    </div>
  )
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
      />
    </svg>
  )
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  )
}

// The in-play menu: a pill that reads as progress until you tap it, then the
// same list. Opening it PAUSES — P.paused stops the clock and the sim in
// GameLoop. The unmount path has to clear it too, or ending the run with the
// sheet open freezes the next one.
function GoalMenu() {
  const goalsDone = useGame((s) => s.goalsDone)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    P.paused = open
    return () => {
      P.paused = false
    }
  }, [open])
  // Esc TOGGLES — it is the only key that opens the sheet, so it can't be
  // gated on `open` the way a close-only handler would be.
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && setOpen((v) => !v)
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  }, [])
  return (
    <>
      <button
        className={open ? 'hud-menu is-open' : 'hud-menu'}
        aria-label="Challenges"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="hud-menu-bars" aria-hidden="true" />
        {goalsDone.length}/{GOALS.length}
      </button>
      {open && (
        <div className="hud-sheet" onClick={() => setOpen(false)}>
          <div className="hud-sheet-card" onClick={(e) => e.stopPropagation()}>
            <div className="hud-credit">
              <div className="hud-credit-kicker">A WebGL experiment</div>
              <div className="hud-credit-by">
                Created by <strong>Matt Greenberg</strong>
              </div>
              <div className="hud-credit-links">
                <a
                  className="hud-credit-link"
                  href="https://x.com/McGreenBeats"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Matt Greenberg on X"
                >
                  <XIcon />
                </a>
                <a
                  className="hud-credit-link"
                  href="https://github.com/MatthewGreenberg"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Matt Greenberg on GitHub"
                >
                  <GitHubIcon />
                </a>
              </div>
            </div>
            <div className="hud-sheet-title">CHALLENGES</div>
            <GoalList />
            <div className="hud-sheet-foot">PAUSED — tap anywhere to resume</div>
          </div>
        </div>
      )}
    </>
  )
}

function TrickPopup() {
  const trickText = useGame((s) => s.trickText)
  const trickPoints = useGame((s) => s.trickPoints)
  const trickLive = useGame((s) => s.trickLive)
  const ref = useRef(null)
  const prevText = useRef('')

  useEffect(() => {
    if (!trickText) {
      prevText.current = ''
      return
    }
    // Restart the pop-in only when the NAME changes. A live grind flushes new
    // points every 0.15s under the same name — restarting on points made the
    // popup strobe instead of reading as a counter ticking up.
    const el = ref.current
    if (el) {
      el.classList.remove('out')
      if (trickText !== prevText.current) {
        el.style.animation = 'none'
        void el.offsetWidth
        el.style.animation = ''
      }
    }
    prevText.current = trickText
    // Mid-trick the tape never times out — you are still in the air or on the
    // rail, and the value is still climbing. Landing (or bailing) drops `live`
    // and starts the fly-out from there.
    if (trickLive) return
    // trickPoints is a dep so every flush pushes both timers back: the popup
    // holds while the counter moves, flies out 1.1s after it stops, and only
    // unmounts once the fly-out has played.
    const tOut = setTimeout(() => ref.current && ref.current.classList.add('out'), 1100)
    const tClear = setTimeout(() => useGame.getState().clearTrick(), 1520)
    return () => {
      clearTimeout(tOut)
      clearTimeout(tClear)
    }
  }, [trickText, trickPoints, trickLive])

  if (!trickText) return null
  return (
    <div className={trickLive ? 'hud-trick is-live' : 'hud-trick'} ref={ref}>
      <div className="hud-trick-name">{trickText}</div>
      {trickPoints > 0 && <div className="hud-trick-points">+{NUM.format(trickPoints)}</div>}
    </div>
  )
}

function Joystick() {
  const nubRef = useRef(null)
  const drag = useRef(false)

  const set = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    let dx = (e.clientX - r.left - r.width / 2) / (r.width / 2)
    let dy = (e.clientY - r.top - r.height / 2) / (r.height / 2)
    const len = Math.hypot(dx, dy)
    if (len > 1) {
      dx /= len
      dy /= len
    }
    // raw vector only — input.js resolves it against the live heading
    touch.x = dx
    touch.y = dy
    touch.active = true
    nubRef.current.style.transform = `translate(${dx * r.width * 0.3}px, ${dy * r.height * 0.3}px)`
  }
  const end = (e) => {
    drag.current = false
    touch.x = 0
    touch.y = 0
    touch.active = false
    if (nubRef.current) nubRef.current.style.transform = ''
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  return (
    <div
      className="hud-stick"
      onPointerDown={(e) => {
        drag.current = true
        e.currentTarget.setPointerCapture(e.pointerId)
        set(e)
      }}
      onPointerMove={(e) => drag.current && set(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="hud-stick-nub" ref={nubRef} />
    </div>
  )
}

function JumpButton() {
  return (
    <button
      className="hud-jump"
      onPointerDown={(e) => {
        e.preventDefault()
        touchJumpDown()
      }}
      onPointerUp={touchJumpUp}
      onPointerCancel={touchJumpUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      JUMP
    </button>
  )
}

function MuteWave() {
  const [muted, setMute] = useState(() => isMuted())
  const pathRef = useRef(null)

  useEffect(() => {
    let raf = 0
    const tick = (t) => {
      const el = pathRef.current
      if (el) {
        const amp = muted ? 1.2 : 7
        const phase = t * 0.004
        let d = 'M 0 12'
        for (let x = 1; x <= 48; x++) {
          const y = 12 + Math.sin(x * 0.42 + phase) * amp
          d += ` L ${x} ${y.toFixed(2)}`
        }
        el.setAttribute('d', d)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [muted])

  return (
    <button
      className={muted ? 'hud-mute is-muted' : 'hud-mute'}
      aria-label={muted ? 'Unmute' : 'Mute'}
      onClick={() => {
        const next = !isMuted()
        setMuted(next)
        setMute(next)
      }}
    >
      <svg viewBox="0 0 48 24" aria-hidden="true">
        <path ref={pathRef} d="M 0 12 L 48 12" />
      </svg>
    </button>
  )
}

const LEGEND = TOUCH
  ? [
      ['Stick', 'Move · Spin · Grab'],
      ['Button', 'Jump'],
    ]
  : [
      ['Space', 'Jump'],
      ['WASD', 'Move'],
      ['↑', 'Grab'],
      ['↓', 'Dogflip'],
      ['← →', 'Spin'],
    ]

function StarIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 1.6l3.2 6.5 7.2 1-5.2 5.1 1.2 7.2L12 18l-6.4 3.4 1.2-7.2L1.6 9.1l7.2-1z" />
    </svg>
  )
}

// ---------------------------------------------------------------- loading
// The two glb rigs are ~9MB compressed and every texture in the park is painted
// into a canvas at load, so there IS a wait to fill. Progress comes off three's
// DefaultLoadingManager via drei.
function LoadingScreen({ progress }) {
  const pct = Math.round(progress)
  const phase =
    pct >= 100
      ? 'Ready to roll!'
      : pct > 66
        ? 'Hiding the bonus bones…'
        : pct > 32
          ? 'Warming up the wheels…'
          : 'Waking up the skatepark…'

  return (
    <div
      className="hud-load hud-load-paw-screen"
      role="status"
      aria-live="polite"
      aria-label={`Loading Skate Dog, ${pct} percent`}
      style={{
        '--load': pct,
        '--load-ratio': Math.max(0.015, pct / 100),
        '--load-shine-offset': `${80 - pct * 2.1}px`,
      }}
    >
      <span className="hud-load-paw-kicker">SKATE DOG</span>
      <div className="hud-load-paw-meter" aria-hidden="true">
        <svg className="hud-load-paw" viewBox="0 0 220 210">
          <defs>
            <clipPath id="loading-paw-shape">
              <ellipse cx="41" cy="78" rx="18" ry="25" transform="rotate(-24 41 78)" />
              <ellipse cx="83" cy="46" rx="20" ry="27" transform="rotate(-8 83 46)" />
              <ellipse cx="137" cy="46" rx="20" ry="27" transform="rotate(8 137 46)" />
              <ellipse cx="179" cy="78" rx="18" ry="25" transform="rotate(24 179 78)" />
              <path d="M110 91c-17 0-29 10-40 24-10 13-17 28-15 42 3 22 25 34 55 34s52-12 55-34c2-14-5-29-15-42-11-14-23-24-40-24Z" />
            </clipPath>
          </defs>

          <g className="hud-load-paw-base">
            <ellipse cx="41" cy="78" rx="18" ry="25" transform="rotate(-24 41 78)" />
            <ellipse cx="83" cy="46" rx="20" ry="27" transform="rotate(-8 83 46)" />
            <ellipse cx="137" cy="46" rx="20" ry="27" transform="rotate(8 137 46)" />
            <ellipse cx="179" cy="78" rx="18" ry="25" transform="rotate(24 179 78)" />
            <path d="M110 91c-17 0-29 10-40 24-10 13-17 28-15 42 3 22 25 34 55 34s52-12 55-34c2-14-5-29-15-42-11-14-23-24-40-24Z" />
          </g>

          <g clipPath="url(#loading-paw-shape)">
            <rect className="hud-load-paw-fill" x="0" y="0" width="220" height="210" />
            <path className="hud-load-paw-shine" d="M18 118c49-20 113-22 184-3v25c-73-19-137-17-184 4Z" />
          </g>

          <g className="hud-load-paw-outline">
            <ellipse cx="41" cy="78" rx="18" ry="25" transform="rotate(-24 41 78)" />
            <ellipse cx="83" cy="46" rx="20" ry="27" transform="rotate(-8 83 46)" />
            <ellipse cx="137" cy="46" rx="20" ry="27" transform="rotate(8 137 46)" />
            <ellipse cx="179" cy="78" rx="18" ry="25" transform="rotate(24 179 78)" />
            <path d="M110 91c-17 0-29 10-40 24-10 13-17 28-15 42 3 22 25 34 55 34s52-12 55-34c2-14-5-29-15-42-11-14-23-24-40-24Z" />
          </g>
        </svg>
      </div>
      <strong className="hud-load-paw-percent">{pct}%</strong>
      <p className="hud-load-paw-status">{phase}</p>
    </div>
  )
}

function StartOverlay() {
  // The card exits on click while `started` is already flipping, so the DOM
  // fade and the 3D reveal are the same 0.26s. Unmount comes free: GameUI drops
  // the overlay the moment start() lands.
  const [out, setOut] = useState(false)
  // The eight rows are COLLAPSED by default: on the start card they compete with
  // the title for the same half of the frame, and the count is the only part you
  // read before you've played once.
  const [showGoals, setShowGoals] = useState(false)
  const goalsDone = useGame((s) => s.goalsDone)
  const onPlay = () => {
    if (out) return
    setOut(true)
    unlockAudio()
    setTimeout(() => useGame.getState().start(), 260)
  }
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onPlay()
      }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })
  return (
    <div className={out ? 'hud-start is-out' : 'hud-start'}>
      {/* the SKATE DOG title is troika text in the scene, upper LEFT — Intro.jsx
          places it in camera space, so this card owns the upper right */}
      <div className="hud-brief">
        <div className="hud-brief-head">CHALLENGES</div>
        <p className="hud-brief-sub">Complete tricks and explore the park</p>
        <div className="hud-brief-count">
          <StarIcon className="hud-brief-star" />
          <b>
            {goalsDone.length} / {GOALS.length}
          </b>
          completed
        </div>
        <button className="hud-brief-more" onClick={() => setShowGoals((v) => !v)}>
          {showGoals ? 'Hide challenges' : 'View challenges'}
          <span className={showGoals ? 'is-open' : undefined}>›</span>
        </button>
        {showGoals && <GoalList />}
      </div>
      <button className="hud-play" onClick={onPlay}>
        <StarIcon className="hud-play-star" />
        PLAY
        <StarIcon className="hud-play-star" />
      </button>
      <span className="hud-hint">or press Enter</span>
      <div className="hud-legend">
        {LEGEND.map(([key, what]) => (
          <div key={key}>
            <b>{key}</b>
            <i>=</i>
            {what}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- scorecard
function RunOver() {
  const score = useGame((s) => s.score)
  const bones = useGame((s) => s.bones)
  const goalsDone = useGame((s) => s.goalsDone)
  const [out, setOut] = useState(false)
  const again = () => {
    if (out) return
    setOut(true)
    // Three resets, and all three are load-bearing: the rig (P), the module
    // state the goals keep outside React, and the store — whose runId bump
    // remounts the collectibles.
    resetPlayer()
    resetGoals()
    setTimeout(() => useGame.getState().restart(), 200)
  }
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        again()
      }
    }
    addEventListener('keydown', key)
    return () => removeEventListener('keydown', key)
  })
  return (
    <div className={out ? 'hud-over is-out' : 'hud-over'}>
      <div className="hud-over-title">TIME</div>
      <div className="hud-over-score">{NUM.format(score)}</div>
      <div className="hud-over-rows">
        <div>
          <b>{bones}/{BONES.length}</b>bones
        </div>
        <div>
          <b>
            {goalsDone.length}/{GOALS.length}
          </b>
          challenges
        </div>
      </div>
      <button className="hud-play" onClick={again}>
        PLAY AGAIN
      </button>
      <span className="hud-hint">or press Enter</span>
    </div>
  )
}

export default function GameUI() {
  const started = useGame((s) => s.started)
  const warmedUp = useGame((s) => s.warmedUp)
  const { progress } = useProgress()
  // Latched, not live: the manager reports active=false between items, and a
  // loader that blinks off mid-load is worse than no loader. Once 100 lands it
  // never comes back — nothing in the park loads after the start card.
  const [loaded, setLoaded] = useState(false)
  // ponytail: hard 8s escape hatch. A manager that never reports 100 (nothing
  // left to load by the time this mounts, a failed fetch) would otherwise leave
  // the page on the loading screen with no way into the game. It bypasses only
  // the asset manager; the renderer warm-up must still finish before reveal.
  const [assetsTimedOut, setAssetsTimedOut] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setAssetsTimedOut(true), 8000)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if ((progress < 100 && !assetsTimedOut) || !warmedUp) return
    const t = setTimeout(() => setLoaded(true), 400) // let the bar finish filling
    return () => clearTimeout(t)
  }, [progress, assetsTimedOut, warmedUp])
  // photo mode shows the in-play HUD with a representative score, never the
  // start card — the capture has to match a mid-session frame
  useEffect(() => {
    if (PHOTO) useGame.setState({ score: 18720, bones: 3, started: true })
  }, [])
  const live = started || !!PHOTO
  const runOver = useGame((s) => s.runOver)
  return (
    <div className="hud">
      <div className={live ? 'hud-widgets' : 'hud-widgets is-idle'}>
        <ScorePill />
        {/* clock and goal card are session furniture — PHOTO fakes a session
            for the HUD, but the reference captures are framed against the old
            widget row and must not grow one */}
        {!PHOTO && <TimePill />}
        {live && <MuteWave />}
        {live && !PHOTO && !runOver && <GoalMenu />}
      </div>
      <TrickPopup />
      {live && TOUCH && !runOver && (
        <>
          <Joystick />
          <JumpButton />
        </>
      )}
      {!live && (loaded ? <StartOverlay /> : <LoadingScreen progress={progress} />)}
      {runOver && <RunOver />}
    </div>
  )
}
