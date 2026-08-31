import { ArrowRight } from 'lucide-react'
import { HeroPullback } from '../components/HeroPullback'
import type { Route } from '../lib/routes'

export function Home({ go }: { go: (r: Route) => void }) {
  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="pt-6 pb-2 sm:pt-12">
        <h1 className="mb-6 max-w-[27ch] text-[clamp(2.25rem,1.4rem+3.6vw,4.25rem)]
          font-semibold leading-[1.06] tracking-[-.02em] text-ink">
          Leepr — build your next data center
        </h1>
        <HeroPullback go={go} />
      </section>

      {/* ── Meet leepr ─────────────────────────────────────────────────────── */}
      <section className="mt-14">
        <h2 className="mb-3 text-[clamp(1.5rem,1.25rem+1.1vw,2.125rem)] font-semibold text-ink">
          Meet leepr
        </h2>
        <p className="max-w-[62ch] text-[clamp(1.0625rem,1rem+.3vw,1.3125rem)] leading-[1.6] text-mid">
          Leepr automates the site selection process for data centers by weighing common
          constraints against the user preferences.
        </p>
      </section>

      {/* ── Variables ──────────────────────────────────────────────────────── */}
      <section className="mt-14">
        <h2 className="mb-6 text-[clamp(1.5rem,1.25rem+1.1vw,2.125rem)] font-semibold text-ink">
          leepr takes into account these variables
        </h2>
        <div className="space-y-5 max-w-[66ch]">
          <div>
            <p className="text-[15.5px] font-semibold text-ink">Land</p>
            <p className="mt-0.5 text-[15px] leading-[1.65] text-mid">
              The one cost paid before anything is built, and the acreage sets a ceiling on
              how much can ever go there.
            </p>
          </div>
          <div>
            <p className="text-[15.5px] font-semibold text-ink">Energy</p>
            <p className="mt-0.5 text-[15px] leading-[1.65] text-mid">
              Priced across the whole fifteen years, and the wait to connect can hold a build
              back longer than the price does.
            </p>
          </div>
          <div>
            <p className="text-[15.5px] font-semibold text-ink">Regulations and taxes</p>
            <p className="mt-0.5 text-[15px] leading-[1.65] text-mid">
              A rate that repeats every year of the life, and an abatement that moves the
              total more than most single line items.
            </p>
          </div>
          <div>
            <p className="text-[15.5px] font-semibold text-ink">Other costs</p>
            <p className="mt-0.5 text-[15px] leading-[1.65] text-mid">
              Construction, staff, water, hazard exposure and distance to users: the lines
              that separate two otherwise similar sites.
            </p>
          </div>
        </div>
      </section>

      {/* ── How to use ─────────────────────────────────────────────────────── */}
      <section className="mt-14">
        <ol className="space-y-3 max-w-[62ch]">
          <li className="flex items-start gap-3 text-[15px] leading-[1.65] text-ink2">
            <span className="num mt-[2px] min-w-[1.4ch] text-[13px] font-bold text-dim">1</span>
            Compare regions inputted on parcel projections
          </li>
          <li className="flex items-start gap-3 text-[15px] leading-[1.65] text-ink2">
            <span className="num mt-[2px] min-w-[1.4ch] text-[13px] font-bold text-dim">2</span>
            Find parcels in top data center markets (beta)
          </li>
          <li className="flex items-start gap-3 text-[15px] leading-[1.65] text-ink2">
            <span className="num mt-[2px] min-w-[1.4ch] text-[13px] font-bold text-dim">3</span>
            Calculate the TCO for your data center
          </li>
        </ol>
        <p className="mt-4 text-[13.5px] text-mid">
          Takes about a minute. You do not need an account.
        </p>
      </section>

      {/* ── Primary action ─────────────────────────────────────────────────── */}
      <section className="mt-14 mb-2">
        <button className="btn btn-primary" onClick={() => go('setup')}>
          Start the comparison
          <ArrowRight size={17} strokeWidth={2.4} aria-hidden />
        </button>
      </section>
    </>
  )
}
