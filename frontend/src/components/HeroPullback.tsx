import { useEffect, useRef, useState } from 'react'
import { HeroResults } from './HeroResults'
import type { Route } from '../lib/routes'

/**
 * The hero is two layers with one hand-off between them.
 *
 * The flight is a video because no amount of DOM will fly a camera out of a
 * server rack. The place it lands is not a video: it is HeroResults, the real
 * components running the real engine, so the type is spelled correctly, the
 * figures are the ones the results screen would print, and the rows can be
 * clicked. The generated last frame of the film says "Lauddnn County, Viiginis";
 * the layer that replaces it says Loudoun County, Virginia, because it is asking
 * the dataset rather than remembering a shape.
 *
 * The swap happens a beat before the file ends, under a short cross-fade, so
 * the picture never sits on a frozen frame waiting to be replaced.
 *
 * Anyone with reduced motion set never sees the flight at all. They get the live
 * page immediately, which is the better outcome anyway.
 */
export function HeroPullback({ go }: { go: (r: Route) => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const [landed, setLanded] = useState(false)
  const [reduced, setReduced] = useState(false)
  const [ready, setReady] = useState(false)
  // The film is 16:9. The live page is taller than that. Holding the box at 16:9
  // for the flight and then growing it to the page's own height keeps the video
  // from being crop-filled into a tall frame, and keeps the page from being
  // squashed into a short one.
  const [boxH, setBoxH] = useState<number | null>(null)
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    const el = pageRef.current
    if (!el) return
    const measure = () => setBoxH(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!landed) return
    const t = setTimeout(() => setSettled(true), 700)
    return () => clearTimeout(t)
  }, [landed])

  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = (m: boolean) => { setReduced(m); if (m) setLanded(true) }
    apply(q.matches)
    const on = (e: MediaQueryListEvent) => apply(e.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])

  // The hand-off is driven by time remaining rather than the ended event, so the
  // cross-fade overlaps the tail of the shot instead of following it.
  useEffect(() => {
    const el = ref.current
    if (!el || reduced) return
    const HANDOFF_AT = 0.45 // seconds before the end
    const tick = () => {
      if (el.duration && el.duration - el.currentTime <= HANDOFF_AT) setLanded(true)
    }
    el.addEventListener('timeupdate', tick)
    el.addEventListener('ended', () => setLanded(true))
    const go = el.play()
    if (go && typeof go.catch === 'function') go.catch(() => setLanded(true))
    return () => el.removeEventListener('timeupdate', tick)
  }, [reduced])

  return (
    <div
      className="relative isolate overflow-hidden rounded-[14px] border border-line bg-bg
        shadow-[0_18px_40px_-24px_rgba(15,32,64,.38)]"
      style={
        settled || reduced
          ? undefined
          : {
              height: landed && boxH ? boxH : undefined,
              aspectRatio: landed ? undefined : '16 / 9',
              transition: 'height .6s cubic-bezier(.16,1,.3,1)',
            }
      }>
      {/* the flight */}
      {!reduced && (
        <video
          ref={ref}
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
          onError={() => setLanded(true)}
        >
          <source src="/hero.mp4" type="video/mp4" />
        </video>
      )}

      {/* the product, holding the box open at the right height from the first paint */}
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
        <button
          onClick={() => setLanded(true)}
          className="absolute bottom-3 right-3 rounded-full border border-line bg-white/90 px-3 py-1.5
            text-[12px] font-medium text-mid backdrop-blur transition-colors hover:text-ink">
          Skip
        </button>
      )}
    </div>
  )
}
