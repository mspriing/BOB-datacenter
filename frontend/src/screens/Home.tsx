import { ArrowRight, TreePine, Zap, Landmark, Layers } from 'lucide-react'
import { HeroPullback } from '../components/HeroPullback'
import type { Route } from '../lib/routes'

export function Home({ go }: { go: (r: Route) => void }) {
  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="pt-6 pb-2 sm:pt-12">
        <h1 className="mb-5 max-w-[27ch] text-[clamp(2.25rem,1.4rem+3.6vw,4.25rem)]
          font-semibold leading-[1.06] tracking-[-.02em] text-ink">
          Find, price and build your next data center
        </h1>
        <p className="mb-8 max-w-[70ch] text-[clamp(1.0625rem,1rem+.3vw,1.3125rem)]
          leading-[1.6] text-mid">
          Leepr is a cost model and a search tool in one: it prices the whole life of a data
          center, then ranks every place you could put it.
        </p>
        <HeroPullback go={go} />
      </section>

      {/* ── Meet leepr ─────────────────────────────────────────────────────── */}
      <section className="mt-14">
        <h2 className="mb-3 text-[clamp(1.5rem,1.25rem+1.1vw,2.125rem)] font-semibold text-ink">
          Meet leepr
        </h2>
        <p className="max-w-[68ch] text-[clamp(1.0625rem,1rem+.3vw,1.3125rem)] leading-[1.6] text-mid">
          Leepr automates the site selection process for data centers by weighing common
          constraints against the user preferences. It prices the whole life of a build, not
          only what the ground costs: reaching power and fiber, getting through permitting,
          and fifteen years of running the place all land in the same total. Every figure it
          shows carries the source it came from, or the formula it was derived with, so a
          number you disagree with is one you can go and check.
        </p>
      </section>

      {/* ── Variables ──────────────────────────────────────────────────────── */}
      <section className="mt-14">
        <h2 className="mb-6 text-[clamp(1.5rem,1.25rem+1.1vw,2.125rem)] font-semibold text-ink">
          leepr takes into account these variables
        </h2>
        {/* Four boxes rather than a list. Each of these is a group of drivers the
            engine prices, so they read as four things of equal weight; stacked
            paragraphs made the first one look like the important one. */}
        <div className="grid gap-3.5 sm:grid-cols-2">
          {([
            {
              icon: <TreePine size={20} strokeWidth={2} aria-hidden />,
              head: 'Land',
              body: 'The one cost paid before anything is built, and the acreage sets a ceiling on how much can ever go there.',
            },
            {
              icon: <Zap size={20} strokeWidth={2} aria-hidden />,
              head: 'Energy',
              body: 'Priced across the whole fifteen years, and the wait to connect can hold a build back longer than the price does.',
            },
            {
              icon: <Landmark size={20} strokeWidth={2} aria-hidden />,
              head: 'Regulations and taxes',
              body: 'A rate that repeats every year of the life, and an abatement that moves the total more than most single line items.',
            },
            {
              icon: <Layers size={20} strokeWidth={2} aria-hidden />,
              head: 'Other costs',
              body: 'Construction, staff, water, hazard exposure and distance to users: the lines that separate two otherwise similar sites.',
            },
          ]).map(v => (
            <div key={v.head}
              className="flex items-start gap-3.5 rounded-[13px] border border-line bg-white/70 p-5
                         shadow-[var(--shadow-sm)] transition-colors hover:bg-white">
              <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center
                               rounded-[11px] bg-bluex text-blued">
                {v.icon}
              </span>
              <div className="min-w-0">
                <p className="mb-1 text-[16px] font-semibold text-ink">{v.head}</p>
                <p className="text-[14.5px] leading-[1.65] text-mid">{v.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How to use ─────────────────────────────────────────────────────── */}
      <section className="mt-14">
        <h2 className="mb-6 text-[clamp(1.5rem,1.25rem+1.1vw,2.125rem)] font-semibold text-ink">
          How to use
        </h2>
        {/* Three boxes, each carrying what the step actually asks of a reader.
            The bare titles said what the step was called, not what to do. */}
        <ol className="grid gap-3.5 md:grid-cols-3">
          {([
            {
              n: '1',
              head: 'Compare regions inputted on parcel projections',
              body: 'Name two to four markets, on the map or from the list. Change the build if you know it, leave the defaults if you do not, and run. Each one comes back priced, with the figure that would put a different market first.',
            },
            {
              n: '2',
              head: 'Find parcels in top data center markets (beta)',
              body: 'Narrow thousands of candidate plots by acreage, land price, distance to transmission and flood exposure, or describe what you want in a sentence. Open any parcel to see what reaching it would cost.',
            },
            {
              n: '3',
              head: 'Calculate the TCO for your data center',
              body: 'Every run ends on a whole-life total: land, build, power, staff, water and tax, discounted back to today, with a band around it and a source behind each input.',
            },
          ]).map(s => (
            <li key={s.n}
              className="flex items-start gap-3.5 rounded-[13px] border border-line bg-white/70 p-5
                         shadow-[var(--shadow-sm)] transition-colors hover:bg-white">
              <span className="num flex h-[30px] w-[30px] shrink-0 items-center justify-center
                               rounded-[9px] bg-[linear-gradient(135deg,var(--blue),var(--blue-d))]
                               text-[14px] font-bold text-white
                               shadow-[0_3px_9px_-3px_rgba(15,98,254,.55)]">
                {s.n}
              </span>
              <div className="min-w-0">
                <p className="mb-1.5 text-[15.5px] font-semibold leading-[1.35] text-ink">{s.head}</p>
                <p className="text-[14.5px] leading-[1.65] text-mid">{s.body}</p>
              </div>
            </li>
          ))}
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
