import { AdaptiveDpr, AdaptiveEvents, PerformanceMonitor, Stats } from '@react-three/drei'
import { useGame } from '../store.js'
import { PHOTO } from '../photo.js'

const DEV = import.meta.env.DEV

// PerformanceMonitor flips the quality flag (effects + shadow samples read it);
// AdaptiveDpr drops resolution while the regression flag is set.
export default function PerformanceManager() {
  const setQuality = useGame((s) => s.setQuality)
  // a screenshot must never be taken at a degraded quality tier
  if (PHOTO) return null
  return (
    <>
      {/* flipflops: every quality change rebuilds the effect composer's render
          targets, so after 2 changes of mind we stop asking and stay low */}
      <PerformanceMonitor
        bounds={() => [48, 60]}
        flipflops={2}
        onDecline={() => setQuality('low')}
        onIncline={() => setQuality('high')}
        onFallback={() => setQuality('low')}
      />
      <AdaptiveDpr pixelated={false} />
      <AdaptiveEvents />
      {DEV && <Stats className="dev-stats" />}
    </>
  )
}
