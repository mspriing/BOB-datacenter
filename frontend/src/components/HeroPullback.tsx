import { useCallback, useEffect, useRef, useState } from 'react'
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
 * ── when it does not play ────────────────────────────────────────────────
 * The poster is the film's LAST frame, which is the right still to show but a
 * dangerous default: if the video never starts, a visitor is looking at the
 * assembled board and has no way to know a film exists. That is what happened
 * on a shared link — it read as a paused ending.
 *
 * Three things can stop it. The browser can refuse a scripted play (iOS Low
 * Power Mode and Safari's per-site autoplay setting both do, and the refusal
 * arrives as a rejected promise that is easy to swallow). The visitor can have
 * Reduce Motion on, which is a request we honour rather than override. Or the
 * tab can have been in the background when the effect ran.
 *
 * So: `autoplay` is on the element as well as scripted, because the native path
 * is permitted in cases a scripted call is not; a refusal is caught and
 * recorded rather than discarded; the first gesture of any kind retries; and
 * whenever the film is not running the play control is made visible instead of
 * waiting for a hover that never comes on a phone. Reduce Motion still gets no
 * flight and no loop — but it gets a button, so the film is offered rather than
 * hidden.
 */

/**
 * Michael's call, made twice: the site has to look the same for everyone who
 * opens the link, not only for people whose machine has not asked for less
 * motion. So Reduce Motion is read but not acted on.
 *
 * The honest cost, recorded here rather than argued again: that setting is
 * usually on because animation makes someone ill, and a 16-second loop and a
 * four-second transition are the kind of thing it exists to stop. What is kept
 * on both sides of this is the pause control, which is what WCAG 2.2.2 actually
 * requires of anything that plays for more than five seconds.
 *
 * Setting this to true restores the reduced paths; both are still written.
 */
const RESPECT_REDUCED_MOTION = false

const HOLD_MS = 800 // rest on the assembled board before starting over
const DIP_MS = 320 // cross-fade that covers the jump back to frame one

export function HeroPullback() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [reduced, setReduced] = useState(false)
  const [dim, setDim] = useState(false)
  const [paused, setPaused] = useState(true)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const honour = (m: boolean) => setReduced(RESPECT_REDUCED_MOTION && m)
    honour(query.matches)
    const onChange = (event: MediaQueryListEvent) => honour(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  /** Ask for playback. Safari wants muted set on the element, not just in JSX. */
  const attempt = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = true
    const playback = video.play()
    if (playback && typeof playback.catch === 'function') playback.catch(() => {})
  }, [])

  // Reduced motion: park on the final frame rather than play toward it. The
  // `autoplay` attribute is on the element for everyone else, so this has to
  // stop it as well as seek — otherwise a slow load lets the film start before
  // the seek lands, which is the one thing the setting asks us not to do.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !reduced) return
    const park = () => {
      video.pause()
      if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.05)
    }
    video.pause()
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
    const onEnded = () => {
      timers.push(
        window.setTimeout(() => {
          setDim(true)
          timers.push(
            window.setTimeout(() => {
              video.currentTime = 0
              attempt()
              setDim(false)
            }, DIP_MS),
          )
        }, HOLD_MS),
      )
    }
    const onPlay = () => { setPaused(false); setStarted(true) }
    const onPause = () => setPaused(true)
    video.addEventListener('ended', onEnded)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    attempt()
    return () => {
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      timers.forEach(timer => clearTimeout(timer))
    }
  }, [reduced, attempt])

  /**
   * A refused autoplay usually stops being refused once the visitor has done
   * anything at all, and a tab that was in the background when the page loaded
   * will play the moment it is looked at. Both are one-shot retries that unhook
   * themselves as soon as the film is running.
   */
  useEffect(() => {
    if (reduced || started) return
    const retry = () => attempt()
    const events: Array<keyof DocumentEventMap> = ['pointerdown', 'touchstart', 'keydown', 'scroll']
    events.forEach(e => document.addEventListener(e, retry, { passive: true }))
    document.addEventListener('visibilitychange', retry)
    return () => {
      events.forEach(e => document.removeEventListener(e, retry))
      document.removeEventListener('visibilitychange', retry)
    }
  }, [reduced, started, attempt])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      // Under reduced motion the film is parked on its last frame, so the first
      // press should show the film rather than the two frames left of it.
      if (reduced && Number.isFinite(video.duration) && video.currentTime > video.duration - 0.5) {
        video.currentTime = 0
      }
      attempt()
    } else {
      video.pause()
    }
  }

  // Visible whenever the film is not running: a still with no control is what
  // made this look broken.
  const showControl = reduced || paused || !started

  return (
    <div className="hero-film">
      <video
        ref={videoRef}
        poster="/hero-poster.webp"
        autoPlay
        muted
        playsInline
        preload="auto"
        aria-hidden
        style={{ opacity: dim ? 0 : 1, transition: `opacity ${DIP_MS}ms linear` }}>
        <source src="/hero.mp4" type="video/mp4" />
      </video>

      <button
        type="button"
        onClick={togglePlayback}
        aria-label={paused ? 'Play the walkthrough' : 'Pause the walkthrough'}
        className={`hero-film-control${showControl ? ' is-shown' : ''}`}>
        {paused
          ? <Play size={14} strokeWidth={2.4} aria-hidden />
          : <Pause size={14} strokeWidth={2.4} aria-hidden />}
      </button>
    </div>
  )
}
