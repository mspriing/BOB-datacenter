import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'

/**
 * The hero is the film, and nothing behind it.
 *
 * The flight is a video because no amount of DOM will fly a camera out of a
 * server rack. It used to hand over to the live results component a beat before
 * the end; it no longer does. The board the film assembles in its last second
 * and a half is the only part that shows what the tool produces, so HOLD_MS
 * keeps that frame on screen just long enough to land as a destination — the
 * three market names and the four headline figures read in that window, the
 * eight-pixel labels do not — and a cross-fade covers the jump back so the loop
 * reads as a decision rather than a stutter.
 *
 * There is no frame around the picture. Its edge is a rounded rectangle blurred
 * to nothing, with the page's carbon weave drawn back across the dissolve, so
 * the shot surfaces out of the background instead of sitting in a card on top
 * of it. That work is in .hero-film in styles.css.
 *
 * Reduced motion gets the last frame, parked. No flight, no loop, and still the
 * part of the film worth seeing. Everyone else gets a pause control, because a
 * sixteen-second loop that cannot be stopped fails WCAG 2.2.2.
 */

const HOLD_MS = 800 // rest on the assembled board before starting over
const DIP_MS = 320 // cross-fade that covers the jump back to frame one

export function HeroPullback() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [reduced, setReduced] = useState(false)
  const [dim, setDim] = useState(false)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Reduced motion: park on the final frame rather than play toward it.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !reduced) return
    const park = () => {
      if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.05)
    }
    if (video.readyState >= 1) park()
    else video.addEventListener('loadedmetadata', park, { once: true })
    return () => video.removeEventListener('loadedmetadata', park)
  }, [reduced])

  // The loop. `loop` is deliberately not set on the element: the attribute
  // suppresses `ended`, and `ended` is what the hold hangs off.
  useEffect(() => {
    const video = videoRef.current
    if (!video || reduced) return
    const timers: number[] = []
    const start = () => {
      const playback = video.play()
      if (playback && typeof playback.catch === 'function') playback.catch(() => {})
    }
    const onEnded = () => {
      timers.push(
        window.setTimeout(() => {
          setDim(true)
          timers.push(
            window.setTimeout(() => {
              video.currentTime = 0
              start()
              setDim(false)
            }, DIP_MS),
          )
        }, HOLD_MS),
      )
    }
    const onPlay = () => setPaused(false)
    const onPause = () => setPaused(true)
    video.addEventListener('ended', onEnded)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    start()
    return () => {
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      timers.forEach(timer => clearTimeout(timer))
    }
  }, [reduced])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      const playback = video.play()
      if (playback && typeof playback.catch === 'function') playback.catch(() => {})
    } else {
      video.pause()
    }
  }

  return (
    <div className="hero-film">
      <video
        ref={videoRef}
        poster="/hero-poster.webp"
        muted
        playsInline
        preload="auto"
        aria-hidden
        style={{ opacity: dim ? 0 : 1, transition: `opacity ${DIP_MS}ms linear` }}>
        <source src="/hero.mp4" type="video/mp4" />
      </video>

      {!reduced && (
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={paused ? 'Play the walkthrough' : 'Pause the walkthrough'}
          className="hero-film-control">
          {paused
            ? <Play size={14} strokeWidth={2.4} aria-hidden />
            : <Pause size={14} strokeWidth={2.4} aria-hidden />}
        </button>
      )}
    </div>
  )
}
