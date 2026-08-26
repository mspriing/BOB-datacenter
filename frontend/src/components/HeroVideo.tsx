import { useEffect, useRef, useState } from 'react'

/**
 * The landing page opens on one continuous shot: a rack of servers, pulling back
 * through the building, the parcel and the county, ending on the results screen.
 *
 * Three rules govern it.
 *
 *  1. It plays once. There is no loop. The last frame IS the results screen, so
 *     when the video finishes it simply holds there and reads as a screenshot.
 *     That is why `loop` is absent and why the poster is the final frame rather
 *     than the first: a slow connection shows the answer, not a dark server room.
 *
 *  2. Anyone who has turned motion off never sees it move. `prefers-reduced-motion`
 *     is checked before the element is even given a source.
 *
 *  3. If the file is missing or the codec is refused, the still takes over. The
 *     hero degrades to exactly what was there before rather than to a black box.
 */
export function HeroVideo({ poster, still, alt }: {
  poster: string
  still: string
  alt: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(q.matches)
    const on = (e: MediaQueryListEvent) => setReduced(e.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])

  // Some browsers refuse an autoplay promise even when the video is muted.
  // A refusal is not an error worth degrading for: the poster is the final
  // frame, so a video that never starts still shows the right picture.
  useEffect(() => {
    const el = ref.current
    if (!el || reduced || failed) return
    const go = el.play()
    if (go && typeof go.catch === 'function') go.catch(() => {})
  }, [reduced, failed])

  if (reduced || failed) {
    return (
      <img
        src={still}
        width={1440}
        height={1069}
        alt={alt}
        className="block w-full"
      />
    )
  }

  return (
    <video
      ref={ref}
      className="block w-full"
      poster={poster}
      width={1600}
      height={900}
      autoPlay
      muted
      playsInline
      preload="auto"
      aria-label={alt}
      onError={() => setFailed(true)}
    >
      <source src="/hero.mp4" type="video/mp4" />
    </video>
  )
}
