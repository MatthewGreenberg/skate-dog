import { useEffect, useRef } from 'react'
import { useGame } from '../store.js'
import { unlockAudio } from '../audio/AudioManager.js'
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

function DogIcon() {
  // dachshund head, three-quarter: floppy ear behind, long muzzle, big nose
  return (
    <svg className="hud-dog" viewBox="0 0 40 40" aria-hidden="true">
      {/* floppy ear behind, round head, long muzzle to the left, big nose */}
      <ellipse cx="29.5" cy="24" rx="7.6" ry="12.4" fill="#9c5f2c" transform="rotate(10 29.5 24)" />
      <circle cx="20.5" cy="17.5" r="13.4" fill="#e9b26c" />
      <ellipse cx="11.5" cy="25" rx="10.2" ry="7.4" fill="#f7dcae" />
      <ellipse cx="4.6" cy="24.2" rx="4.2" ry="3.5" fill="#33241d" />
      <circle cx="20.6" cy="14.2" r="2.9" fill="#33241d" />
      <circle cx="21.7" cy="13.2" r="0.95" fill="#fff" opacity="0.85" />
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

function LivesPill() {
  const lives = useGame((s) => s.lives)
  return (
    <div className="hud-pill hud-lives">
      <span className="hud-chip">
        <DogIcon />
      </span>
      <span className="hud-lives-value">x{lives}</span>
    </div>
  )
}

function TrickPopup() {
  const trickText = useGame((s) => s.trickText)
  const trickPoints = useGame((s) => s.trickPoints)
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
    // trickPoints is a dep so every flush pushes both timers back: the popup
    // holds while the counter moves, flies out 1.1s after it stops, and only
    // unmounts once the fly-out has played.
    const tOut = setTimeout(() => ref.current && ref.current.classList.add('out'), 1100)
    const tClear = setTimeout(() => useGame.getState().clearTrick(), 1520)
    return () => {
      clearTimeout(tOut)
      clearTimeout(tClear)
    }
  }, [trickText, trickPoints])

  if (!trickText) return null
  return (
    <div className="hud-trick" ref={ref}>
      <div className="hud-trick-name">{trickText}</div>
      {trickPoints > 0 && <div className="hud-trick-points">+{NUM.format(trickPoints)}</div>}
    </div>
  )
}

const LEGEND = [
  ['WASD / Arrows', 'steer'],
  ['Space', 'jump'],
  ['← → in air', 'spin'],
  ['↓ in air', 'kickflip'],
  ['K', 'grab'],
  ['Shift', 'brake'],
]

function StartOverlay() {
  const onPlay = () => {
    unlockAudio()
    useGame.getState().start()
  }
  return (
    <div className="hud-start">
      <h1 className="hud-title">SKATE DOG</h1>
      <p className="hud-sub">Ride the pup, bomb the plaza, grind every rail.</p>
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
    </div>
  )
}

export default function GameUI() {
  const started = useGame((s) => s.started)
  // photo mode shows the in-play HUD with a representative score, never the
  // start card — the capture has to match a mid-session frame
  useEffect(() => {
    if (PHOTO) useGame.setState({ score: 18720, started: true })
  }, [])
  const live = started || !!PHOTO
  return (
    <div className="hud">
      <div className={live ? 'hud-widgets' : 'hud-widgets is-idle'}>
        <ScorePill />
        <LivesPill />
        <div className="hud-hint">
          <span className="hud-key">Y</span>
          <span>Dismount</span>
        </div>
      </div>
      <TrickPopup />
      {!live && <StartOverlay />}
    </div>
  )
}
