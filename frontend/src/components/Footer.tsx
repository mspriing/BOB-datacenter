import { Logo } from './Primitives'
import { FOOTER_GROUPS, type Route } from '../lib/routes'

export function Footer({ go }: { go: (r: Route) => void }) {
  return (
    <footer className="relative z-[1] mt-16 border-t border-line pt-10">
      <div className="grid gap-8 pb-9 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <div className="mb-3 flex items-center gap-3">
            <Logo />
            <span className="text-[15px] font-semibold text-ink">leepr</span>
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
      <div className="border-t border-line py-6">
        <span className="block text-[13px] text-mid">leepr, 2026. Apache 2.0 licensed.</span>
        <div className="mt-4 space-y-2 text-[13px] leading-[1.6] text-mid">
          <p>Everything on this site is for informational purposes only.</p>
          <p>leepr is a cost model. The figures it shows are estimates built from public data and from the assumptions you enter. They carry error, they can be out of date, and they will not match what a site actually costs.</p>
          <p>Nothing here is investment, financial, legal, tax or engineering advice. Nothing here is a valuation, an appraisal, a quote, or an offer to buy or sell anything.</p>
          <p>Land values are modeled, not market prices. In non-disclosure states such as Texas, no sale prices are published, so land figures are derived from appraisal-district values rather than from what anyone paid.</p>
          <p>Take independent professional advice before committing money to a site.</p>
          <p>The tool is provided as is, without warranty of any kind. Its authors accept no liability for any decision made using it.</p>
        </div>
      </div>
    </footer>
  )
}
