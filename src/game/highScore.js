/**
 * Personal best per level, in localStorage. One entry per level id: the shipped
 * park is 'park', a saved user level (`?level=<id>`) keeps its own — the same
 * split MY LEVELS already renders, so a big score on a level you built with
 * five ramps in a line doesn't overwrite the park's.
 *
 * ponytail: local only, and deliberately. A shared leaderboard needs a backend,
 * accounts and score validation — without validation it ranks whoever opened
 * devtools first. Add one when players ask, not before.
 */
const KEY = 'skatedog.best'
const CAN_KEY = 'skatedog.canBest'

// Lazy, like levelEdits' own store(): node runs the checks with no localStorage
// and no `location`, and this module is reached through store.js.
const ls = () => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // private mode can throw on ACCESS, not just on write
  }
}

export const levelId = () =>
  (typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('level')) || 'park'

const all = (key = KEY) => {
  try {
    return JSON.parse(ls()?.getItem(key) || '{}') || {}
  } catch {
    return {} // a corrupt blob is a missing best, never a crash on the home screen
  }
}

export const bestFor = (id) => all(KEY)[id] || 0
export const canBestFor = (id) => all(CAN_KEY)[id] || 0

/** Returns true when this run beat the stored best. */
export function recordScore(score, id = levelId()) {
  if (!(score > bestFor(id))) return false
  try {
    ls()?.setItem(KEY, JSON.stringify({ ...all(KEY), [id]: score }))
  } catch { /* quota */ }
  return true
}

/** Objective progress for cans-only levels. Kept separate from scores so a
 *  tile can never accidentally label 18,450 points as "18,450 cans". */
export function recordCanCount(count, id = levelId()) {
  const safeCount = Math.max(0, Math.floor(Number(count) || 0))
  if (!(safeCount > canBestFor(id))) return false
  try {
    ls()?.setItem(CAN_KEY, JSON.stringify({ ...all(CAN_KEY), [id]: safeCount }))
  } catch { /* quota */ }
  return true
}
