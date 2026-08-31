import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { HeroResults } from './HeroResults'
import type { Route } from '../lib/routes'

/**
 * The generated flight hands off before its stale dashboard frame to live
 * components backed by the checked example engine output.
 */
export function HeroPullback({ go }: { go: (r: Route) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const [landed, setLanded] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [ready, setReady] = useState(false)
  const [paused, setPaused] = useState(false)
  const [boxH, setBoxH] = useState<number | null>(null)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    const measure = () => setBoxH(el.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!landed) return
    const timer = setTimeout(() => setSettled(true), 700)
    return () => clearTimeout(timer)
  }, [landed])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = (matches: boolean) => {
      setReduced(matches)
      if (matches) setLanded(true)
    }
    apply(query.matches)
    const onChange = (event: MediaQueryListEvent) => apply(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || reduced) return
    const handoff = () => {
      if (video.duration && video.duration - video.currentTime <= 2.5) setLanded(true)
    }
    const onPlay = () => setPaused(false)
    const onPause = () => setPaused(true)
    video.addEventListener('timeupdate', handoff)
    video.addEventListener('ended', handoff)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    const playback = video.play()
    if (playback && typeof playback.catch === 'function') playback.catch(() => setLanded(true))
    return () => {
      video.removeEventListener('timeupdate', handoff)
      video.removeEventListener('ended', handoff)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [reduced])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      const playback = video.play()
      if (playback && typeof playback.catch === 'function') playback.catch(() => setLanded(true))
    } else {
      video.pause()
    }
  }

  return (
    <div
      className="relative isolate overflow-hidden rounded-[14px] border border-line bg-bg shadow-[var(--shadow-lg)]"
      style={settled || reduced
        ? undefined
        : {
            height: landed && boxH ? boxH : undefined,
            aspectRatio: landed ? undefined : '16 / 9',
            transition: 'height .6s cubic-bezier(.16,1,.3,1)',
          }}>
      {!reduced && (
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            opacity: landed ? 0 : 1,
            transition: 'opacity .55s cubic-bezier(.16,1,.3,1)',
            pointerEvents: 'none',
          }}
          poster="/hero-poster.webp"
          muted
          playsInline
          preload="auto"
          aria-hidden
          onCanPlay={() => setReady(true)}
          onError={() => setLanded(true)}>
          <source src="/hero.mp4" type="video/mp4" />
        </video>
      )}

      <div
        ref={pageRef}
        className={settled || reduced ? '' : 'absolute inset-x-0 top-0'}
        style={{
          opacity: landed ? 1 : 0,
          transition: 'opacity .55s cubic-bezier(.16,1,.3,1)',
          pointerEvents: landed ? 'auto' : 'none',
        }}>
        <HeroResults go={go} active={landed} />
      </div>

      {!reduced && !landed && ready && (
        <div className="absolute bottom-3 right-3 z-10 flex items-center gap-2">
          <button type="button" onClick={togglePlayback}
            aria-label={paused ? 'Play the walkthrough' : 'Pause the walkthrough'}
            className="flex h-[36px] w-[36px] items-center justify-center rounded-full border border-line
                       bg-[var(--raised-surface)] text-mid shadow-[var(--shadow-sm)] backdrop-blur
                       transition-colors hover:text-ink">
            {paused
              ? <Play size={14} strokeWidth={2.4} aria-hidden />
              : <Pause size={14} strokeWidth={2.4} aria-hidden />}
          </button>
          <button type="button" onClick={() => setLanded(true)}
            className="min-h-[36px] rounded-full border border-line bg-[var(--raised-surface)] px-3
                       text-[12px] font-medium text-mid shadow-[var(--shadow-sm)] backdrop-blur
                       transition-colors hover:text-ink">
            Skip
          </button>
        </div>
      )}
    </div>
  )
}
