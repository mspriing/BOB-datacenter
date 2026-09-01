import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * The jump on the More info page.
 *
 * Pressing one of the four moves, or any line under it, does not scroll — it
 * covers the page and then puts you where you asked to be. What plays over the
 * top is the campus with the three parts it is built from orbiting it: they
 * enter at the east point of the ellipse, and on the second time round each one
 * breaks orbit at the north point, directly above the campus, and leaves
 * through the top. The three exits are a third of a lap apart because that is
 * how far apart the parts are; nothing about their spacing is chosen. Then the
 * campus rises and the whole plane splits down the middle.
 *
 * Three things are deliberate and easy to undo by accident.
 *
 * The veil is portalled to <body>. The page shell animates route changes with a
 * transform, and a transformed ancestor becomes the containing block for
 * position:fixed — which quietly turns a full-screen overlay into one that
 * stops at the edges of the article and leaves the header showing.
 *
 * The veil has no entrance. It is opaque on the first frame, because anything
 * that fades or wipes in shows the page through itself while it does so.
 *
 * The ellipse is flattened to sit on the isometric ground plane the art is
 * drawn on, and depth is carried by scale and z-order rather than by opacity.
 * Dimming the far side would be cheaper and would make the parts see-through.
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

const PERIOD = 1150            // ms for one full turn
const RX = 0.32                // orbit radii, as fractions of the viewport
const RY = 0.20
const TAU = Math.PI * 2

/** piece i starts at the east point and trails the one before it by a third */
const angle = (i: number, t: number) => Math.PI / 2 + (t / PERIOD) * TAU - i * (TAU / 3)

/**
 * Every part completes two orbits and then leaves at the north point — its
 * SECOND crossing of it, which for a part starting at east is three quarters of
 * a lap in and one full lap after that. They go in order, a third of a lap
 * apart, because that is how far apart they are on the ellipse.
 */
const releaseAt = (i: number) => PERIOD * (1.75 + i / 3)

export function MoreInfoJump() {
  const veilRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const veil = veilRef.current
    if (!veil) return

    const pieces = Array.from(veil.querySelectorAll<HTMLImageElement>('.p1,.p2,.p3'))
    const campus = veil.querySelector<HTMLImageElement>('.p4')
    if (pieces.length !== 3 || !campus) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let busy = false
    let raf = 0
    const released = [false, false, false]

    const radii = (): [number, number] => [
      RX * Math.min(window.innerWidth * 1.35, window.innerHeight * 2.1),
      RY * window.innerHeight,
    ]

    const place = (x: number, y: number, sc: number) =>
      `translate(calc(-50% + var(--ox) + ${x.toFixed(1)}px), calc(-50% + var(--oy) + ${y.toFixed(1)}px)) scale(${sc.toFixed(3)})`

    const orbit = (t: number) => {
      const [rx, ry] = radii()
      pieces.forEach((el, i) => {
        if (released[i]) return
        const a = angle(i, t)
        const near = (1 - Math.cos(a)) / 2          // 0 at the north point, 1 at the south
        el.style.transform = place(Math.sin(a) * rx, -Math.cos(a) * ry, 0.66 + 0.42 * near)
        el.style.opacity = (0.9 + 0.1 * near).toFixed(3)
        el.style.zIndex = near > 0.5 ? '4' : '1'
      })
    }

    /**
     * At the north point a part is travelling sideways: its vertical velocity
     * there is exactly zero. Sending it straight up from that instant reads as
     * a stall, so the exit keeps going the way the orbit was already going,
     * curves, and only then climbs.
     */
    const shootUp = (i: number) => {
      released[i] = true
      const el = pieces[i]
      const [rx, ry] = radii()
      const out = window.innerHeight * 0.95 + 260
      el.style.zIndex = '4'
      el.animate([
        { transform: place(0, -ry, 0.66), opacity: 0.9, offset: 0,
          easing: 'cubic-bezier(.24,.52,.58,.94)' },
        { transform: place(rx * 0.30, -ry - out * 0.16, 0.78), opacity: 1, offset: 0.26,
          easing: 'cubic-bezier(.36,0,.74,.52)' },
        { transform: place(rx * 0.34, -out, 0.72), opacity: 0, offset: 1 },
      ], { duration: 470, fill: 'forwards' })
    }

    const jump = (id: string) => {
      const target = document.getElementById(id)
      if (!target || busy) return
      /**
       * Reduce Motion does not mean no transition — it means no large-scale
       * movement. So the page is still covered and still handed over rather
       * than yanked, but nothing orbits, nothing flies and nothing splits: the
       * campus is simply there, and the cover cross-fades away.
       */
      if (RESPECT_REDUCED_MOTION && reduced.matches) {
        busy = true
        veil.classList.add('run')
        pieces.forEach(el => { el.style.opacity = '0' })
        campus.style.zIndex = '2'
        campus.animate([{ opacity: 0 }, { opacity: 1 }],
          { duration: 220, easing: 'ease-out', fill: 'both' })
        window.setTimeout(() => target.scrollIntoView({ behavior: 'auto', block: 'start' }), 420)
        const out = veil.animate([{ opacity: 1 }, { opacity: 0 }],
          { duration: 320, delay: 460, easing: 'ease-in', fill: 'forwards' })
        out.onfinish = () => {
          veil.classList.remove('run')
          veil.getAnimations().forEach(a => a.cancel())
          ;[...pieces, campus].forEach(el => {
            el.getAnimations().forEach(a => a.cancel())
            el.style.opacity = ''
            el.style.zIndex = ''
          })
          busy = false
        }
        return
      }

      busy = true
      released[0] = released[1] = released[2] = false
      veil.classList.add('run')          // opaque immediately; nothing shows behind it

      const riseAt = releaseAt(2) + 80
      const wipeAt = riseAt + 240
      const wipe = 900

      campus.style.zIndex = '2'
      campus.animate([
        { transform: 'translate(calc(-50% + var(--ox)),calc(-50% + var(--oy))) scale(.9)', opacity: 0 },
        { transform: 'translate(calc(-50% + var(--ox)),calc(-50% + var(--oy))) scale(1)', opacity: 1 },
      ], { duration: 300, easing: 'cubic-bezier(.16,.9,.28,1)', fill: 'both' })

      pieces.forEach((el, i) => {
        el.animate([{ opacity: 0 }, { opacity: 1 }],
          { duration: 240, delay: i * 70, easing: 'ease-out', fill: 'backwards' })
      })

      campus.animate([
        { transform: 'translate(calc(-50% + var(--ox)),calc(-50% + var(--oy))) scale(1)' },
        { transform: 'translate(calc(-50% + var(--ox)),calc(-50% + var(--oy) - 78px)) scale(1.035)' },
      ], { duration: 420, delay: riseAt, easing: 'cubic-bezier(.22,.7,.3,1)', fill: 'forwards' })

      const t0 = performance.now()
      const tick = (now: number) => {
        const t = now - t0
        for (let i = 0; i < 3; i++) if (!released[i] && t >= releaseAt(i)) shootUp(i)
        orbit(t)
        // keep going until every part has left. Stopping at any one of them
        // freezes the others mid-orbit, which is what happened when this
        // watched released[2] and released[2] happened to be the first to go.
        if (released.some(done => !done)) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)

      const split = veil.animate([
        { maskSize: '100% 100%, 100% 100%', webkitMaskSize: '100% 100%, 100% 100%', offset: 0, easing: 'linear' },
        { maskSize: '86% 100%, 86% 100%', webkitMaskSize: '86% 100%, 86% 100%', offset: 0.05 },
        { maskSize: '0% 100%, 0% 100%', webkitMaskSize: '0% 100%, 0% 100%', offset: 1 },
      ] as Keyframe[], { duration: wipe, delay: wipeAt, easing: 'cubic-bezier(.3,.05,.5,1)', fill: 'forwards' })

      const land = window.setTimeout(() => {
        target.scrollIntoView({ behavior: 'auto', block: 'start' })
      }, wipeAt - 40)

      split.onfinish = () => {
        window.clearTimeout(land)
        cancelAnimationFrame(raf)
        veil.classList.remove('run')
        veil.getAnimations().forEach(a => a.cancel())
        ;[...pieces, campus].forEach(el => {
          el.getAnimations().forEach(a => a.cancel())
          el.style.transform = ''
          el.style.opacity = ''
          el.style.zIndex = ''
        })
        busy = false
      }
    }

    const onClick = (e: MouseEvent) => {
      const hit = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-jump]')
      if (hit?.dataset.jump) jump(hit.dataset.jump)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !busy) return
      veil.getAnimations().forEach(a => a.finish())
      ;[...pieces, campus].forEach(el => el.getAnimations().forEach(a => a.finish()))
    }

    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
      cancelAnimationFrame(raf)
    }
  }, [])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="mi-veil" ref={veilRef} aria-hidden>
      <div className="weave" />
      <div className="wash" />
      <img className="p1" src="/flow3/substation.webp" alt="" />
      <img className="p2" src="/flow3/data-hall.webp" alt="" />
      <img className="p3" src="/flow3/plant.webp" alt="" />
      <img className="p4" src="/flow3/campus.webp" alt="" />
    </div>,
    document.body,
  )
}
