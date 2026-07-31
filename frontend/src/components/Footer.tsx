import { Logo } from './Primitives'
import { FOOTER_GROUPS, type Route } from '../lib/routes'

export function Footer({ go }: { go: (r: Route) => void }) {
  return (
    <footer className="relative z-[1] mt-16 border-t border-line pt-10">
      <div className="grid gap-8 pb-9 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="mb-3 flex items-center gap-3">
            <Logo />
            <span className="text-[15px] font-semibold text-ink">Site Decision Copilot</span>
          </div>
          <p className="max-w-[34ch] text-[13.5px] leading-[1.6] text-mid">
            Whole life siting costs for data centers, built from public data. Every figure
            carries the source it came from or the derivation behind it.
          </p>
        </div>
        {FOOTER_GROUPS.map(g => (
          <div key={g.heading}>
            <p className="label-xs mb-3.5">{g.heading}</p>
            <ul className="space-y-2.5">
              {g.links.map(l => (
                <li key={l.to}>
                  <button onClick={() => go(l.to)}
                    className="inline-block py-1 text-left text-[14px] text-mid transition-colors hover:text-blued">
                    {l.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-6 text-[13px] text-mid">
        <span>Site Decision Copilot, 2026. All rights reserved.</span>
        <span className="max-w-[62ch]">
          Figures are estimates drawn from public sources and the assumptions you enter.
          They are not a valuation, a quote, or investment advice.
        </span>
      </div>
    </footer>
  )
}
