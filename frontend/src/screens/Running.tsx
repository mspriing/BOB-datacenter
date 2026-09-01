import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { Brand, Card } from '../components/Primitives'
import { useReducedMotion } from '../lib/useReducedMotion'

export function Running({ done, pending, slow, retrying, error, retry, lifetimeYears }: {
  done: () => void
  pending: boolean
  slow: boolean
  retrying: boolean
  error: string | null
  retry: () => void
  lifetimeYears: number
}) {
  const [step, setStep] = useState(0)
  const reduced = useReducedMotion()
  const steps = [
    'Reading the regional figures for every candidate',
    'Validating any site-specific figures you supplied',
    'Pricing land, build, power, water, staff and tax',
    `Discounting ${lifetimeYears} years of running cost to today`,
    'Applying the ranking weights and testing where the order flips',
    'Writing the recommendation from the engine output',
  ]

  // The checklist paces itself, but it never runs ahead of the server. The last
  // step stays lit until the request settles, so the interface cannot claim to
  // have finished work the engine has not done.
  useEffect(() => {
    if (error) return
    if (step >= steps.length) {
      if (pending) return
      const t = setTimeout(done, 420)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setStep(s => s + 1), step === 0 ? 520 : 460)
    return () => clearTimeout(t)
  }, [step, done, pending, error, steps.length])

  return (
    <section className="flex min-h-[68vh] items-center justify-center py-14">
      <Card className="w-full max-w-[560px]" weave>
        <div className="p-7 sm:p-8">
          {/* A step counter belongs on the form. By the time a reader is here
              they have left it, and what they want is to know what is running. */}
          <p className="mb-3 text-[13.5px] font-medium text-mid">
            <Brand /> is pricing your candidates
          </p>
          <h1 className="mb-1.5 text-[26px] font-semibold text-ink">Working through the numbers</h1>
          <p className="mb-7 text-[15px] text-mid">
            Every figure below is calculated, not estimated by a language model.
          </p>
          <ol className="space-y-3.5">
            {steps.map((s, i) => {
              const state = i < step ? 'done' : i === step ? 'now' : 'next'
              return (
                <li key={s} className="flex items-start gap-3.5">
                  <span className={`mt-[1px] flex h-[22px] w-[22px] shrink-0 items-center justify-center
                    rounded-full border transition-colors duration-300
                    ${state === 'done' ? 'border-transparent bg-ok text-onaccent'
                      : state === 'now' ? 'border-blue bg-bluex text-blue'
                      : 'border-line bg-card text-dim'}`}>
                    {state === 'done' ? <Check size={13} strokeWidth={3} aria-hidden />
                      : state === 'now' ? <Loader2 size={13} strokeWidth={2.6} aria-hidden
                          className={reduced ? '' : 'animate-spin'} />
                      : <span className="num text-[11px] font-semibold">{i + 1}</span>}
                  </span>
                  <span className={`text-[15px] leading-[1.5] transition-colors duration-300
                    ${state === 'next' ? 'text-mid' : 'text-ink2'}`}>{s}</span>
                </li>
              )
            })}
          </ol>
          {error && (
            <div className="mt-7 flex items-start gap-3 rounded-[10px] border border-[var(--error-border)]
                            bg-[var(--error-surface)] p-4">
              <AlertTriangle size={17} strokeWidth={2.2} className="mt-[2px] shrink-0 text-bad" aria-hidden />
              <div>
                <p className="text-[14px] leading-[1.6] text-[var(--error-ink)]">{error}</p>
                <button onClick={retry} className="link-inline mt-2 text-[14px]">Try the run again</button>
              </div>
            </div>
          )}
          <AnimatePresence>
            {slow && !error && (
              <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mt-7 rounded-[10px] border border-line bg-card2 px-4 py-3 text-[13.5px] leading-[1.55] text-ink2">
                {retrying
                  ? 'Still waking the server, trying once more.'
                  : 'Waking the server up. It sleeps when nobody has used it for a while, so the first run after a quiet spell can take up to two minutes. Everything after that is quick.'}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </Card>
    </section>
  )
}
