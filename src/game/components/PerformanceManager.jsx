import { AdaptiveDpr, AdaptiveEvents, PerformanceMonitor, Stats } from '@react-three/drei'
import { useGame } from '../store.js'
import { TOUCH } from '../input.js'
import { PHOTO } from '../photo.js'

const DEV = import.meta.env.DEV

// PerformanceMonitor flips the quality flag (effects + shadow samples read it);
// AdaptiveDpr drops resolution while the regression flag is set.
export default function PerformanceManager() {
  const setQuality = useGame((s) => s.setQuality)
  const warmedUp = useGame((s) => s.warmedUp)
  // a screenshot must never be taken at a degraded quality tier
  // Warm-up frames are intentionally expensive and must not poison the live
  // performance sample or trigger a quality flip while targets are allocating.
  if (PHOTO || !warmedUp) return null
  return (
    <>
      {/* flipflops: every quality change rebuilds the effect composer's render
          targets, so after 2 changes of mind we stop asking and stay low */}
      <PerformanceMonitor
        bounds={() => [48, 60]}
        flipflops={2}
        onDecline={() => setQuality('low')}
        // phones are pinned low: a brief 60fps stretch flipping quality high
        // rebuilds the composer's render targets mid-play, and the drop that
        // caused is exactly what flips it straight back
        onIncline={() => setQuality(TOUCH ? 'low' : 'high')}
        onFallback={() => setQuality('low')}
      />
      <AdaptiveDpr pixelated={false} />
      <AdaptiveEvents />
      {DEV && <Stats className="dev-stats" />}
    </>
  )
}
