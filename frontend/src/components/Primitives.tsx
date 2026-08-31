import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { motion, useInView } from 'framer-motion'
import * as Tooltip from '@radix-ui/react-tooltip'
import * as Collapsible from '@radix-ui/react-collapsible'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { ChevronDown, HelpCircle } from 'lucide-react'
import { useReducedMotion } from '../lib/useReducedMotion'

/* ── Card ─────────────────────────────────────────────────────────────────── */
export function Card({ title, note, children, className = '', weave = false, solid = false }: {
  title?: ReactNode; note?: ReactNode; children: ReactNode
  className?: string; weave?: boolean; solid?: boolean
}) {
  return (
    <section className={`g ${solid ? 'g-solid' : ''} ${weave ? 'weave-inset' : ''} ${className}`}>
      {title && (
        <header className="panel-head">
          <h3>{title}</h3>
          {note && <span className="panel-note">{note}</span>}
        </header>
      )}
      <div className="relative z-[2]">{children}</div>
    </section>
  )
}

/* ── Collapsible card ─────────────────────────────────────────────────────── */
export function FoldCard({ title, note, children, defaultOpen = false }: {
  title: ReactNode; note?: ReactNode; children: ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="g">
      <Collapsible.Trigger asChild>
        <button className="panel-head w-full cursor-pointer text-left transition-colors hover:bg-[rgba(228,238,255,.42)]">
          <span className="flex items-center gap-2.5">
            <ChevronDown size={16} strokeWidth={2.4} aria-hidden
              className="text-mid transition-transform duration-200"
              style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
            <span className="text-[12px] font-bold uppercase tracking-[.1em] text-ink2">{title}</span>
          </span>
          {note && <span className="panel-note hidden sm:block">{note}</span>}
        </button>
      </Collapsible.Trigger>
      <Collapsible.Content className="fold-panel relative z-[2]">{children}</Collapsible.Content>
    </Collapsible.Root>
  )
}

/* ── Explain: the ? affordance on every technical term ────────────────────── */
export function Explain({ children, text }: { children: ReactNode; text: string }) {
  return (
    <Tooltip.Root delayDuration={120}>
      <Tooltip.Trigger asChild>
        <button type="button" className="group inline-flex items-baseline gap-1 text-left"
          aria-label={`${typeof children === 'string' ? children : 'Term'}. ${text}`}>
          <span className="transition-colors group-hover:text-blued">{children}</span>
          <HelpCircle size={13} strokeWidth={2} aria-hidden
            className="shrink-0 translate-y-[1px] text-dim transition-colors group-hover:text-blued" />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={8} collisionPadding={14}
          className="z-50 max-w-[270px] rounded-[10px] border border-line bg-white px-3.5 py-2.5
                     text-[13.5px] leading-[1.5] text-ink2 shadow-[0_8px_26px_-10px_rgba(15,23,32,.3)]">
          {text}
          <Tooltip.Arrow className="fill-white" width={11} height={5} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

/* ── Chip ─────────────────────────────────────────────────────────────────── */
export function Chip({ tone = 'blue', children }: {
  tone?: 'blue' | 'green' | 'grey' | 'ok' | 'warn' | 'bad'
  children: ReactNode
}) {
  const tones = {
    blue: 'bg-bluex text-blued',
    green: 'bg-[#D7F0E2] text-ink',
    grey: 'bg-card2 text-mid',
    ok: 'bg-[var(--ok)] text-white',
    warn: 'bg-[var(--warn)] text-white',
    bad: 'bg-[var(--bad)] text-white',
  }
  return (
    <span className={`inline-block rounded-full px-2.5 py-[3px] text-[12px] font-bold
                      uppercase tracking-[.07em] ${tones[tone]}`}>{children}</span>
  )
}

/* ── Rule: the separator that replaces every middot and dash ──────────────── */
export function Rule() {
  return <span className="mx-2.5 inline-block h-[11px] w-px translate-y-[1px] bg-line" aria-hidden />
}

/* ── Reveal: scroll reveal with a timer backstop so nothing strands hidden ── */
export function Reveal({ children, delay = 0, className = '' }: {
  children: ReactNode; delay?: number; className?: string
}) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.12, margin: '0px 0px -40px' })
  const [forced, setForced] = useState(false)
  useEffect(() => { const t = setTimeout(() => setForced(true), 2000); return () => clearTimeout(t) }, [])
  if (reduced) return <div className={className}>{children}</div>
  const show = inView || forced
  return (
    <motion.div ref={ref} className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={show ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      transition={{ duration: 0.55, ease: [0.2, 0.8, 0.3, 1], delay }}>
      {children}
    </motion.div>
  )
}

/* ── Counter: re-animates on every target change, not just on first sight ─── */
export function Counter({ to, prefix = '', suffix = '', decimals = 0, className = '' }: {
  to: number; prefix?: string; suffix?: string; decimals?: number; className?: string
}) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const seen = useInView(ref, { once: true, amount: 0.3 })
  const [shown, setShown] = useState(reduced ? to : 0)
  const from = useRef(0)
  const [armed, setArmed] = useState(false)

  useEffect(() => { const t = setTimeout(() => setArmed(true), 1200); return () => clearTimeout(t) }, [])

  useEffect(() => {
    const live = seen || armed
    if (!live) return
    if (reduced) { setShown(to); from.current = to; return }
    const start = from.current
    const delta = to - start
    if (delta === 0) { setShown(to); return }
    const dur = start === 0 ? 1100 : 480
    const t0 = performance.now()
    let raf = 0
    const step = (now: number) => {
      const k = Math.min((now - t0) / dur, 1)
      setShown(start + delta * (1 - Math.pow(1 - k, 3)))
      if (k < 1) raf = requestAnimationFrame(step)
      else from.current = to
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [to, seen, armed, reduced])

  const txt = shown.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return <span ref={ref} className={`num ${className}`}>{prefix}{txt}{suffix}</span>
}

/* ── Field ────────────────────────────────────────────────────────────────── */
export function Field({ label, defaultValue, value, onChange, hint, explain }: {
  label: string; defaultValue?: string; value?: string
  onChange?: (v: string) => void; hint?: string; explain?: string
}) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[15px] font-medium text-ink2">
        {explain ? <Explain text={explain}>{label}</Explain> : label}
      </label>
      <input id={id} className="field num"
        {...(onChange ? { value, onChange: e => onChange(e.target.value) } : { defaultValue })} />
      {hint && <p className="mt-1.5 text-[13px] leading-[1.5] text-mid">{hint}</p>}
    </div>
  )
}

/* ── Stat tile ────────────────────────────────────────────────────────────── */
export function StatTile({ label, value, foot, explain, bare = false }: {
  label: string; value: ReactNode; foot?: ReactNode; explain?: string; bare?: boolean
}) {
  return (
    <div className={bare ? 'px-[17px] py-[15px]' : 'stat-tile'}>
      <div className="label-xs mb-2">{explain ? <Explain text={explain}>{label}</Explain> : label}</div>
      <div className="text-[clamp(1.375rem,1.15rem+.8vw,1.75rem)] font-semibold leading-none tracking-[-.03em] text-ink">
        {value}
      </div>
      {foot && <div className="mt-2 text-[13px] leading-[1.45] text-mid">{foot}</div>}
    </div>
  )
}

/* ── Cost case toggle ─────────────────────────────────────────────────────── */
export function CostCaseToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <ToggleGroup.Root type="single" value={value} onValueChange={v => v && onChange(v)}
      aria-label="Cost scenario"
      className="inline-flex flex-wrap rounded-full border border-line bg-white p-1 shadow-[var(--shadow-sm)]">
      {[{ v: 'low', label: 'Optimistic' }, { v: 'base', label: 'Expected' }, { v: 'high', label: 'Cautious' }].map(o => (
        <ToggleGroup.Item key={o.v} value={o.v}
          className="min-h-[34px] rounded-full px-3 text-[13.5px] font-medium text-mid transition-colors
                     hover:text-ink2 data-[state=on]:bg-bluex data-[state=on]:font-semibold data-[state=on]:text-blued">
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

/* ── Logo ─────────────────────────────────────────────────────────────────── */
export function Logo({ size = 42 }: { size?: number }) {
  return (
    <span className="carbon relative block shrink-0 overflow-hidden" aria-hidden
      style={{ width: size, height: size, borderRadius: size * 0.26,
               boxShadow: '0 3px 12px -3px rgba(15,98,254,.45), inset 0 1px 0 rgba(255,255,255,.4)' }}>
      <span className="absolute inset-0 bg-[linear-gradient(140deg,#0F62FE,#00A3B8)] opacity-95" />
      <span className="absolute inset-0 opacity-[.34]" style={{
        backgroundImage: 'linear-gradient(45deg,rgba(255,255,255,.7) 25%,transparent 25%,transparent 75%,rgba(255,255,255,.7) 75%),linear-gradient(135deg,rgba(0,0,0,.35) 25%,transparent 25%,transparent 75%,rgba(0,0,0,.35) 75%)',
        backgroundSize: '5px 5px', backgroundPosition: '0 0,2.5px 2.5px' }} />
      <span className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,.42)_18%,transparent_46%)]" />
    </span>
  )
}
