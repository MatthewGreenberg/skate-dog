import { useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { useGame } from '../store.js'
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
      <BoneIcon />
      <span className="hud-score-value" ref={numRef}>
        0
      </span>
    </div>
  )
}

function BonesPill() {
  const bones = useGame((s) => s.bones)
  const ref = useRef(null)
  useEffect(() => {
    if (!bones || !ref.current) return
    const el = ref.current
    el.classList.remove('pop')
    void el.offsetWidth
    el.classList.add('pop')
  }, [bones])
  return (
    <div className="hud-pill hud-bones" ref={ref}>
      <BoneIcon />
      <span className="hud-score-value">{bones}/{BONES.length}</span>
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
      <span className="hud-score-value">{mmss(timeLeft)}</span>
    </div>
  )
}

// The goal card. Ten rows is a lot of screen on a phone, so touch gets the
// labels only once they're struck through — the list is a scoreboard there,
// not a to-do list you can read while steering.
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
      ['Stick', 'move · spin · grab · flip'],
      ['Button', 'jump'],
    ]
  : [
      ['Space', 'jump'],
      ['Arrows / WASD', 'move'],
      ['↑ in air', 'grab'],
      ['↓ in air', 'dogflip'],
      ['← → in air', 'spin'],
    ]

// ---------------------------------------------------------------- loading
// The two glb rigs are ~9MB compressed and every texture in the park is painted
// into a canvas at load, so there IS a wait to fill. Progress comes off three's
// DefaultLoadingManager via drei.
function LoadingScreen({ progress }) {
  const pct = Math.round(progress)
  return (
    <div className="hud-load">
      <div className="hud-load-label">loading</div>
      <div className="hud-load-bar">
        <div className="hud-load-fill" style={{ width: `${pct}%` }} />
        <div className="hud-load-marker" style={{ left: `${pct}%` }}>
          <BoneIcon />
        </div>
      </div>
    </div>
  )
}

function StartOverlay() {
  // The card exits on click while `started` is already flipping, so the DOM
  // fade and the 3D reveal are the same 0.26s. Unmount comes free: GameUI drops
  // the overlay the moment start() lands.
  const [out, setOut] = useState(false)
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
      {/* the SKATE DOG title is troika text in the scene — see Intro.jsx */}
      <div className="hud-legend">
        {LEGEND.map(([key, what]) => (
          <div key={key}>
            <b>{key}</b>
            {what}
          </div>
        ))}
      </div>
      <button className="hud-play" onClick={onPlay}>
        PLAY
      </button>
      <span className="hud-hint">or press Enter</span>
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
  const { progress } = useProgress()
  // Latched, not live: the manager reports active=false between items, and a
  // loader that blinks off mid-load is worse than no loader. Once 100 lands it
  // never comes back — nothing in the park loads after the start card.
  const [loaded, setLoaded] = useState(false)
  // ponytail: hard 8s escape hatch. A manager that never reports 100 (nothing
  // left to load by the time this mounts, a failed fetch) would otherwise leave
  // the page on the loading screen with no way into the game.
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 8000)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    if (progress < 100) return
    const t = setTimeout(() => setLoaded(true), 400) // let the bar finish filling
    return () => clearTimeout(t)
  }, [progress])
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
        <BonesPill />
        {live && <MuteWave />}
      </div>
      {live && !PHOTO && <GoalList />}
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
