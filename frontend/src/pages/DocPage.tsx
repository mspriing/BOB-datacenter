import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Mail, ExternalLink, Check } from 'lucide-react'
import { Card, Chip } from '../components/Primitives'
import { MoreInfoJump } from '../components/MoreInfoJump'
import { US_REGIONS, US_METROS, US_STATES } from '../data/usRegions'
import { COVERAGE, PROJECT } from '../data/project'
import { DEFAULT_SITES } from '../data/defaultSites'
import { INTL_REGIONS } from '../data/intlRegions'
import { ROUTE_TITLES, CONTACT_URL, FOOTER_GROUPS, type Route } from '../lib/routes'
import {
  priceSite, rank, flipMultiplier, applyProjections, PROJECTION_DRIVERS,
  type ProjectParams,
} from '../lib/engine'
import { usd } from '../lib/format'

const P: ProjectParams = {
  capacityKw: PROJECT.capacityMw * 1000, pue: PROJECT.pue,
  lifetimeYears: PROJECT.lifetimeYears, discountRate: PROJECT.discountRate, designWue: 0.4,
}

/* ── shell ────────────────────────────────────────────────────────────────── */
function groupOf(route: Route): string | null {
  for (const g of FOOTER_GROUPS) {
    if (g.links.some(l => l.to === route)) return g.heading
  }
  return null
}

function Page({ title, lead, children, go, route, maxW = 'max-w-[820px]', surface = 'docs' }: {
  title: string; lead: string; children: React.ReactNode; go: (r: Route) => void
  route?: Route; maxW?: string; surface?: 'docs' | 'app'
}) {
  const group = route ? groupOf(route) : null
  return (
    <section className={`${surface === 'docs' ? 'docs-surface' : 'app-surface'} pt-6 sm:pt-10`}>
      {/* The whole column is centred in the page. The text inside stays left
          aligned — centred prose is harder to read, and the reason these pages
          looked wrong was the column sitting hard against the left edge of a
          1380px shell, not the alignment of the words. */}
      <div className={`${maxW} mx-auto`}>
        <button onClick={() => go('home')}
          className="mb-5 inline-flex items-center gap-1.5 text-[13.5px] text-mid transition-colors hover:text-blued">
          <ArrowLeft size={14} strokeWidth={2.2} aria-hidden />Back to the start
        </button>
        <div className="mb-8 max-w-[68ch]">
          <p className="label-xs mb-3">{group ?? 'Reference'}</p>
          <h1 className="mb-3 text-[clamp(1.875rem,1.5rem+1.6vw,2.75rem)] font-semibold text-ink">{title}</h1>
          <p className="text-[17px] leading-[1.65] text-mid">{lead}</p>
        </div>
        <div className="space-y-3.5">{children}</div>
      </div>
    </section>
  )
}

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 p-6 text-[15.5px] leading-[1.72] text-ink2">{children}</div>
}

function H({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="scroll-mt-6 pt-2 text-[19px] font-semibold text-ink">
      <span aria-hidden className="mb-3 block h-px w-8 bg-blue" />
      {children}
    </h2>
  )
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="max-w-full overflow-x-auto overscroll-x-contain">
      <table className="min-w-[640px] w-full border-collapse text-[13.5px]">
        <thead>
          <tr>{head.map(h => (
            <th key={h} className="border-y border-[var(--line2)] bg-card2 px-5 py-2.5 text-left
              text-[11px] font-bold uppercase tracking-[.09em] text-dim">{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="transition-colors hover:bg-[var(--hover-wash)]">
              {r.map((c, j) => (
                <td key={j} className="border-b border-[var(--line2)] px-5 py-3 text-ink2">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── the formulas ─────────────────────────────────────────────────────────
   A formula is not a sentence, and setting it as one is why this section was
   hard to read. Each line is now its own card: the figure it produces on the
   left, the terms it is built from as separate tokens, and a plain sentence
   underneath. Every token is coloured by where its number comes from, which is
   the same claim the rest of the tool makes about every figure it shows. */
type Kind = 'in' | 'reg' | 'calc' | 'k' | 'op'

function Term({ kind, children }: { kind: Kind; children: React.ReactNode }) {
  if (kind === 'op') return <span className="mi-op">{children}</span>
  return <span className={`num mi-t ${kind}`}>{children}</span>
}

function Fml({ out, parts, gloss }: {
  out: string
  parts: Array<[Kind, string]>
  gloss?: string
}) {
  return (
    <div className="mi-fml">
      <div className="mi-row">
        <span className="num mi-t out">{out}</span>
        <span className="mi-op eq">=</span>
        {parts.map(([kind, text], i) => <Term key={i} kind={kind}>{text}</Term>)}
      </div>
      {gloss && <p className="mi-gloss">{gloss}</p>}
    </div>
  )
}

function Legend() {
  return (
    <div className="mi-legend">
      <p>Every term below is one of five things, and the colour says which. Nothing here is estimated by
        a language model: each line is arithmetic on a figure you gave or a figure the dataset carries.</p>
      <dl>
        <div><dt><span className="num mi-t out">capex</span></dt><dd>the figure this line works out</dd></div>
        <div><dt><span className="num mi-t in">capacity_kW</span></dt><dd>a number <b>you</b> type on the setup screen</dd></div>
        <div><dt><span className="num mi-t reg">power_price_per_kWh</span></dt><dd>a number the dataset carries for the region you picked, with a published source behind it</dd></div>
        <div><dt><span className="num mi-t calc">construction</span></dt><dd>worked out on a line further up</dd></div>
        <div><dt><span className="num mi-t k">8,760 h</span></dt><dd>a constant fixed in the model, identical for every site</dd></div>
      </dl>
    </div>
  )
}

/* ── the four moves ───────────────────────────────────────────────────────
   The short version of the whole page. Pressing a move, or any line under it,
   hands over to MoreInfoJump, which covers the page and lands you on the
   matching heading rather than scrolling you past everything in between. */
const MOVES: Array<{ n: string; title: string; note: string; to: string; chips: Array<[string, string]> }> = [
  { n: '1', title: 'Using the tool', note: 'setup screen', to: 'mi-1', chips: [
    ['Regions', 'mi-regions'], ['Parcels · beta', 'mi-parcels'], ['Your project', 'mi-project'] ] },
  { n: '2', title: 'How the ranking works', note: 'four scores', to: 'mi-2', chips: [
    ['How a score is made', 'mi-2'], ['Normalising, in full', 'mi-normalising'], ['Why the sliders changed', 'mi-sliders'] ] },
  { n: '3', title: 'Why each variable matters', note: 'the drivers', to: 'mi-3', chips: [
    ['Land', 'mi-land'], ['Energy', 'mi-energy'], ['Regulations and taxes', 'mi-tax'], ['Other costs', 'mi-other'] ] },
  { n: '4', title: 'How the cost is calculated', note: 'the engine', to: 'mi-4', chips: [
    ['What it costs to build', 'mi-capex'], ['What it costs to run', 'mi-opex'], ['Back to today\u2019s money', 'mi-npv'] ] },
]

function Moves() {
  return (
    <div className="mi-stations mb-4">
      {MOVES.map(m => (
        <div className="mi-station" key={m.n}>
          <button className="mi-head" data-jump={m.to}>
            <span className="num mi-n">{m.n}</span>
            <span className="mi-title">{m.title}</span>
            <span className="mi-s">{m.note}</span>
          </button>
          <div className="mi-chips">
            {m.chips.map(([label, to]) => (
              <button className="mi-chip" data-jump={to} key={label}>{label}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── contact form, opens a public issue rather than posting anywhere ─────── */
function ContactForm({ subject, fields, blurb }: {
  subject: string
  fields: Array<{ id: string; label: string; placeholder?: string; area?: boolean }>
  blurb: string
}) {
  const [vals, setVals] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)
  const body = fields.map(f => `${f.label}:\n${vals[f.id] ?? ''}`).join('\n\n')
  const href = `${CONTACT_URL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  return (
    <Card title={subject} note="Opens your email app">
      <div className="space-y-4 p-5">
        <p className="text-[14.5px] leading-[1.6] text-mid">{blurb}</p>
        {fields.map(f => (
          <label key={f.id} className="block">
            <span className="mb-1.5 block text-[15px] font-medium text-ink2">{f.label}</span>
            {f.area
              ? <textarea className="field font-normal" placeholder={f.placeholder}
                  value={vals[f.id] ?? ''} onChange={e => setVals(v => ({ ...v, [f.id]: e.target.value }))} />
              : <input className="field" placeholder={f.placeholder}
                  value={vals[f.id] ?? ''} onChange={e => setVals(v => ({ ...v, [f.id]: e.target.value }))} />}
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line2)] pt-4">
          <a className="btn btn-primary" href={href}>
            <Mail size={16} strokeWidth={2.2} aria-hidden />Send this
          </a>
          <button className="pill text-[13.5px]"
            onClick={() => {
              navigator.clipboard?.writeText(body)
              setCopied(true); setTimeout(() => setCopied(false), 2200)
            }}>
            {copied ? <><Check size={13} strokeWidth={2.4} aria-hidden />Copied</> : 'Copy the message'}
          </button>
        </div>
      </div>
    </Card>
  )
}

/* ── the thirteen drivers, in plain English ──────────────────────────────── */
const SOURCES = [
  { name: 'US Energy Information Administration', short: 'eia.gov', url: 'https://www.eia.gov/electricity/',
    covers: 'Industrial electricity rates and generation mix for all 50 states',
    licence: 'US Government work, public domain', attribution: false, checked: '2026-07' },
  { name: 'Bureau of Labor Statistics, OEWS', short: 'bls.gov', url: 'https://www.bls.gov/oes/',
    covers: 'Occupational wage data behind the staff cost index',
    licence: 'US Government work, public domain', attribution: false, checked: '2026-07' },
  { name: 'ThinkHazard, GFDRR', short: 'thinkhazard.org', url: 'https://thinkhazard.org/',
    covers: 'Natural hazard exposure scores',
    licence: 'CC BY 4.0', attribution: true, checked: '2024-12' },
  { name: 'Our World in Data', short: 'ourworldindata.org', url: 'https://ourworldindata.org/energy',
    covers: 'International generation mix and renewable share',
    licence: 'CC BY 4.0', attribution: true, checked: '2025-12' },
  { name: 'PeeringDB', short: 'peeringdb.com', url: 'https://www.peeringdb.com/',
    covers: 'Interconnection facility locations behind the distance model',
    licence: 'CC BY 4.0 under the PeeringDB terms of use', attribution: true, checked: '2026-07' },
  { name: 'Eurostat', short: 'ec.europa.eu/eurostat', url: 'https://ec.europa.eu/eurostat',
    covers: 'European electricity and water rates',
    licence: 'European Commission reuse policy, attribution required', attribution: true, checked: '2026-07' },
  { name: 'European Central Bank', short: 'ecb.europa.eu', url: 'https://www.ecb.europa.eu/stats/eurofxref/',
    covers: 'Daily euro reference rates for currency conversion',
    licence: 'ECB reuse policy, attribution required', attribution: true, checked: '2026-07' },
  { name: 'FEMA, via ArcGIS', short: 'fema.gov', url: 'https://www.fema.gov/',
    covers: 'US hazard layers cross checked against ThinkHazard',
    licence: 'US Government work, public domain', attribution: false, checked: '2026-07' },
  { name: 'Lawrence Berkeley National Laboratory', short: 'lbl.gov', url: 'https://emp.lbl.gov/queues',
    covers: 'Interconnection queue research. Named as the intended basis for the wait time driver, which currently carries placeholders rather than figures pulled from this work',
    licence: 'US Government work, public domain', attribution: false, checked: '2026-07' },
  { name: 'US Census Bureau, TIGER', short: 'census.gov', url: 'https://www.census.gov/geographies/mapping-files.html',
    covers: 'State boundaries drawn on the map',
    licence: 'US Government work, public domain', attribution: false, checked: '2026-07' },
  { name: 'Construction Analytics', short: 'construction-analytics.com', url: 'https://www.construction-analytics.com/',
    covers: 'Cost to build for the 7 regions where it is published',
    licence: 'Cited with attribution, no redistribution licence claimed', attribution: true, checked: '2025-05' },
  { name: 'LoopNet and Lantmäteriet', short: 'loopnet.com', url: 'https://www.loopnet.com/',
    covers: 'Land price per acre, from listing data in the US and the cadastral authority in Sweden',
    licence: 'Cited with attribution, no redistribution licence claimed', attribution: true, checked: '2026-06' },
  { name: 'Municipal water utilities', short: 'per region', url: 'https://www.saws.org/',
    covers: 'Water rates, taken from each utility tariff sheet: Loudoun Water, SAWS, Luleå, Phoenix, Portland, Columbus and Atlanta',
    licence: 'Public tariff filings', attribution: false, checked: '2026-06' },
  { name: 'State revenue departments', short: 'per state', url: 'https://comptroller.texas.gov/',
    covers: 'Property tax rates, from Virginia, Texas, Arizona, Oregon, Ohio, Georgia and Skatteverket',
    licence: 'Government works', attribution: false, checked: '2026-06' },
  { name: 'State economic development agencies', short: 'per state', url: 'https://gov.texas.gov/business/page/texas-enterprise-fund',
    covers: 'Tax abatement terms and capital incentives, from the published programme pages of each state agency',
    licence: 'Government works', attribution: false, checked: '2026-06' },
]

/* ── page bodies ─────────────────────────────────────────────────────────── */
export function DocPage({ route, go, openWorkedExample, openingWorkedExample = false }: {
  route: Route
  go: (r: Route) => void
  openWorkedExample: () => void
  openingWorkedExample?: boolean
}) {
  switch (route) {
    /* ── The tool ────────────────────────────────────────────────────────── */
    case 'how-ranking-works':
    case 'driver-meanings':
    case 'cost-method':
      return <HowToUsePage go={go} route={route}
        openWorkedExample={openWorkedExample}
        openingWorkedExample={openingWorkedExample} />

    case 'release-notes':
      return (
        <Page go={go} route={route} title={ROUTE_TITLES[route]}
          lead="What changed, when, and what it means for numbers you may have written down earlier.">
          {[
            { v: 'Current', d: 'July 2026', items: [
              'A United States map replaces the fixed three site picker. Every state is shaded on the driver you choose, and the twelve metros carrying the deepest driver coverage can be pinned and compared.',
              'The percentage weight sliders are gone. Sliders now sit on the published figure for cost to build, power price and staff cost, and move to whatever you project. The point where the ranking changes hands is marked on each track.',
              'The candidate set can no longer contain the same region twice. A free text description will not move a site onto a region already in the set.',
              'Distance to a hub and cost to build are now computed for every US state rather than left blank, and each carries a derived label.',
              'Every footer link now goes somewhere.',
            ]},
            { v: 'Data layer', d: 'July 2026', items: [
              'Coverage went from eight hand entered regions to 77, covering 50 states, one ERCOT zone, 12 metros and 14 international regions.',
              'Four faults in the ingest were found and fixed. A missing environment load left US power prices empty. A total row in the source spreadsheet was double counted, which halved every renewable share. Metro low carbon shares were being overwritten by their parent state. The euro conversion was hardcoded and undated.',
              'Every value now carries a basis of sourced, modeled or assumed, and modeled values carry the derivation.',
            ]},
            { v: 'Naming', d: 'July 2026', items: [
              'Levelized cost per kW was renamed lifetime cost per kW across the whole product. The old name suggested a construction figure to people who do not read energy papers.',
              'Ranking stability was renamed to how solid is this pick.',
            ]},
          ].map(r => (
            <Card key={r.v} title={r.v} note={r.d}>
              <div className="p-5">
                <ul className="space-y-2.5">
                  {r.items.map(i => (
                    <li key={i} className="flex items-start gap-3 text-[15px] leading-[1.65] text-ink2">
                      <span aria-hidden className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-blue" />
                      {i}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          ))}
        </Page>
      )

    /* ── Coverage ────────────────────────────────────────────────────────── */
    case 'all-regions':
      return (
        <Page go={go} route={route} title={ROUTE_TITLES[route]} maxW="max-w-[1100px]"
          lead={`${COVERAGE.regions} regions in the dataset. ${US_METROS.length} US metros and ${US_STATES.length} US state level regions appear on the map. One of those, the ERCOT zone, is a Texas county carried at state precision. The remaining 14 are international, priced but not drawn.`}>
          <Card title={`United States, ${US_REGIONS.length} regions`} note="Metros carry the deepest coverage">
            <Table head={['Region', 'Precision', 'Power price', 'Staff index', 'Hazard', 'To hub']}
              rows={[...US_REGIONS]
                .sort((a, b) => (a.precision === b.precision ? a.label.localeCompare(b.label) : a.precision === 'metro' ? -1 : 1))
                .map(r => [
                  <span className="font-medium text-ink">{r.label}</span>,
                  r.precision === 'metro' ? <Chip>metro</Chip> : <Chip tone="grey">state</Chip>,
                  <span className="num">{r.drivers.power_rate_usd_per_kwh ? '$' + r.drivers.power_rate_usd_per_kwh.v.toFixed(4) : 'no figure'}</span>,
                  <span className="num">{r.drivers.staff_cost_index?.v.toFixed(2) ?? 'no figure'}</span>,
                  <span className="num">{r.drivers.risk_score?.v.toFixed(1) ?? 'no figure'}</span>,
                  <span className="num">{r.drivers.latency_ms_to_hub ? (r.drivers.latency_ms_to_hub.v < 1 ? r.drivers.latency_ms_to_hub.v.toFixed(1) : Math.round(r.drivers.latency_ms_to_hub.v)) + ' ms' : 'no figure'}</span>,
                ])} />
          </Card>
          <Card title="International coverage"><Prose>
            <p>Fourteen international regions are priced and can be compared, though they are not drawn on the map. Nordic Hydro in Luleå and Boden is the one carried in the worked example, and it is the site that beats the cheapest option in that run.</p>
            <p>Drawing a world map means sourcing subnational power and labor data for every country in it. That work has not been done, so those regions stay in the comparison engine and out of the map rather than appearing with figures that are thinner than they look.</p>
          </Prose></Card>
        </Page>
      )

    case 'the-drivers':
      return <HowToUsePage go={go} route={route}
        openWorkedExample={openWorkedExample}
        openingWorkedExample={openingWorkedExample} />

    case 'sources':
      return (
        <Page go={go} route={route} title={ROUTE_TITLES[route]}
          lead="Every dataset behind the figures, what each covers, when it was last checked, and the licence it carries. The six drivers that exist for only seven regions are sourced per region rather than from one dataset, so those rows name the kind of filing instead.">
          <Card title="Datasets" note="Listed in full, including licence">
            <Table head={['Source', 'What it covers', 'Licence', 'Checked']}
              rows={SOURCES.map(s => [
                <a href={s.url} target="_blank" rel="noreferrer" className="link-inline inline-flex items-center gap-1">
                  {s.name}<ExternalLink size={11} strokeWidth={2.2} aria-hidden />
                </a>,
                <span className="text-mid">{s.covers}</span>,
                <span className="flex items-center gap-2">
                  <span className="text-mid">{s.licence}</span>
                  {s.attribution && <Chip tone="blue">attribution</Chip>}
                </span>,
                <span className="num text-mid">{s.checked}</span>,
              ])} />
          </Card>

          <Card title="Attribution" note="Required by the licences above"><Prose>
            <p>Five of the datasets above are published under terms that require the source to be named wherever the data is reused. This page is where that requirement is met.</p>
            <p>Hazard scores come from <a href="https://thinkhazard.org/" target="_blank" rel="noreferrer" className="link-inline">ThinkHazard</a>, published by the Global Facility for Disaster Reduction and Recovery under CC BY 4.0. International generation mix comes from <a href="https://ourworldindata.org/energy" target="_blank" rel="noreferrer" className="link-inline">Our World in Data</a> under CC BY 4.0. Interconnection facility locations come from <a href="https://www.peeringdb.com/" target="_blank" rel="noreferrer" className="link-inline">PeeringDB</a> under CC BY 4.0 and its terms of use. European rates come from <a href="https://ec.europa.eu/eurostat" target="_blank" rel="noreferrer" className="link-inline">Eurostat</a> and currency conversion from the <a href="https://www.ecb.europa.eu/stats/eurofxref/" target="_blank" rel="noreferrer" className="link-inline">European Central Bank</a>, both under reuse policies that require the source to be named.</p>
            <p>None of ThinkHazard, Our World in Data, PeeringDB, Eurostat or the European Central Bank endorses this tool or has reviewed what it does with their figures. The remaining sources are United States Government works and carry no attribution requirement, though they are listed for the same reason: a figure you cannot trace is a figure you cannot check.</p>
          </Prose></Card>

          <Card title="Conversion and dating"><Prose>
            <p>Figures published in euros are converted at the European Central Bank daily reference rate, and the rate and its date are recorded alongside the converted value rather than being applied silently. The conversion currently in the dataset used a rate of 1.138 dollars to the euro from 29 July 2026.</p>
            <p>Every value carries the month it was last checked. A figure checked in 2024 is not wrong. It is, however, older than one checked this July, and the checked column above is there so you can weigh that yourself.</p>
          </Prose></Card>
        </Page>
      )

    case 'known-gaps':
      return (
        <Page go={go} route={route} title={ROUTE_TITLES[route]}
          lead="What this tool does not know. Kept on a page of its own because a product that claims traceability has to be specific about where the traces run out.">
          <Card title="Gaps in the data"><Prose>
            <H>Land price and property tax exist for seven regions</H>
            <p>Each is published for the seven regions where a real figure was found. For the other 56 they are blank, and any site relying on them is scored without them. Land is the most locally variable driver in the whole set, which is exactly why it has not been modeled from a state average.</p>

            <H>Water price, abatement and capital incentives are equally thin</H>
            <p>Same seven regions, same reasoning. Incentives in particular are negotiated rather than published, so a state level figure would be closer to fiction than to an estimate.</p>

            <H>Interconnection wait is empty for the two regions that need it most</H>
            <p>The wait to energize a large load is argued on the home page as the driver that binds hardest in 2026. For Texas ERCOT and for the Nordic Hydro region it carries no figure, and on 2026-08-27 the operators were checked directly rather than the gap being left as a shrug.</p>
            <p>ERCOT runs large load interconnection through the Batch Zero process under PGRR145 and publishes the forms, the planning guide and a monthly status report, none of which states how long the process takes. Its status update to TAC on 2026-03-13 reports 137 new submissions totaling about 140,000 MW of new large load by 2036, 9,042 MW approved to energize, and an observed non-simultaneous peak of 3,883 MW in March 2025. Those describe the size of the queue rather than the wait. Its process Q&amp;A sets limits on single steps, ten business days for ERCOT to review a preliminary study report and 180 days for a customer to meet section 9.5, which do not add up to an end-to-end time.</p>
            <p>Svenska kraftnat is the same story from the other direction. The Natutvecklingsplan 2026-2035 says it is working to shorten lead times and states a goal of halving them without naming a baseline, and the government-commissioned review of the connection process dated 2026-04-29 calls lead times considerable and quantifies none. Year figures for Swedish grid connection circulate in trade press rather than in the operator's own material.</p>
            <p>A wait could be divided out of queue volume, and it is not, because that needs a throughput nobody publishes. The cell stays empty and says why.</p>

            <H>Distance to a hub is modeled for the states</H>
            <p>Twelve metros carry a measured figure. The 50 states and the ERCOT zone are computed as a great circle to the nearest major interconnection hub at 1.4 ms per 100 km plus 1 ms of overhead. That measures fiber distance rather than the route a packet takes.</p>

            <H>One region is a county carried at state precision</H>
            <p>The ERCOT zone in the dataset is Hays County, Texas, and it is stored at state precision alongside the state of Texas itself. It is shaded and priced correctly, and it makes the state count read as 51 where the map draws 50. Reclassifying it as a metro is the fix, and it has not been done yet.</p>

            <H>Cost to build is modeled for 56 of 63</H>
            <p>Derived from the staff cost index, calibrated against the seven published figures. Labor drives most of the regional variation in build cost, which makes it a defensible stand-in and still leaves it a stand-in.</p>
          </Prose></Card>

          <Card title="Gaps in what the tool does"><Prose>
            <H>It says nothing about whether a site is available</H>
            <p>Nothing in the model knows whether the land can be bought, whether the utility will serve the load, or how long the permit takes, and any one of those can end a site faster than a cost figure will.</p>

            <H>Carbon is measured as grid mix rather than as emissions</H>
            <p>Renewable and low carbon shares describe the local grid. They are not an emissions figure for your load, and they do not account for power purchase agreements, which is the usual route to changing a carbon position at this scale.</p>

            <H>The international regions are not on the map</H>
            <p>Fourteen regions can be priced and compared, though they are not drawn, since subnational data for them has not been sourced.</p>
          </Prose></Card>

          <Card title="Found something else?"><Prose>
            <p>A wrong figure is more useful to hear about than a missing one. There is a page for that.</p>
            <p><button onClick={() => go('report-figure')} className="link-inline">Report a wrong figure</button></p>
          </Prose></Card>
        </Page>
      )

    /* ── Get in touch ────────────────────────────────────────────────────── */
    case 'request-region':
      return (
        <Page go={go} route={route} title={ROUTE_TITLES[route]}
          lead="Adding a region means finding a published figure for each of the thirteen drivers. Tell us which one you need and what you already have.">
          <ContactForm subject="Region request, leepr"
            blurb="The more of the thirteen drivers you can point at a source for, the faster a region can be added. A region with only a power price is not much use, since the comparison would drop every other dimension."
            fields={[
              { id: 'region', label: 'Which region', placeholder: 'Metro, state or country' },
              { id: 'why', label: 'What you are trying to compare it against' },
              { id: 'sources', label: 'Any sources you already have', area: true,
                placeholder: 'Links to published power rates, wage data, hazard scores or build costs.' },
              { id: 'from', label: 'Your email so we can reply' },
            ]} />
          <Card title="What gets prioritised"><Prose>
            <p>Regions where the underlying data is published and current move fastest. A US metro is usually straightforward, since power and wage data are already being pulled at state level and the metro layer sits on top of it.</p>
            <p>International regions are slower. Every country publishes its energy statistics differently, and the conversion and dating have to be handled before the figure is worth anything.</p>
          </Prose></Card>
        </Page>
      )

    case 'report-figure':
      return (
        <Page go={go} route={route} title={ROUTE_TITLES[route]}
          lead="If a number here is wrong, this is the most useful thing you can send. Four faults in the ingest have already been found and fixed, and they are listed in the release notes."
        >
          <ContactForm subject="Wrong figure, leepr"
            blurb="Point at the region and the driver, say what the figure should be, and give a source if you have one. A report without a source is still worth sending, since it tells us where to look."
            fields={[
              { id: 'region', label: 'Region', placeholder: 'For example Northern Virginia' },
              { id: 'driver', label: 'Which driver', placeholder: 'For example power price, per kWh' },
              { id: 'shown', label: 'What it currently shows' },
              { id: 'should', label: 'What it should be' },
              { id: 'source', label: 'Source, if you have one', area: true },
              { id: 'from', label: 'Your email so we can reply' },
            ]} />
          <Card title="What happens next"><Prose>
            <p>A reported figure is checked against the source already on file before anything changes. When the two disagree, we read each of them rather than letting the newer one simply win, since a source that has quietly changed its methodology is itself worth knowing about.</p>
            <p>When a figure is corrected it appears in the release notes with the date, and the checked month on the sources page moves with it.</p>
          </Prose></Card>
        </Page>
      )

    case 'talk-to-team':
      return (
        <Page go={go} route={route} title={ROUTE_TITLES[route]}
          lead="A short message reaches the people who build this. There is no support desk.">
          <ContactForm subject="leepr"
            blurb="Questions about the method, the data, or using this on a real siting decision are all welcome. So is the argument that the whole approach is wrong."
            fields={[
              { id: 'about', label: 'What it is about' },
              { id: 'message', label: 'Your message', area: true },
              { id: 'from', label: 'Your email so we can reply' },
            ]} />
          <Card title="How this works"><Prose>
            <p>A small team builds this. One side is the engine, the data layer and this interface. The other is the domain work, which is the part that decides whether a driver is worth modeling at all.</p>
            <p>Nothing is for sale and this page collects no data about you. The forms open a message in whichever mail client you use rather than posting anywhere, so nothing you type here leaves your machine until you send it.</p>
          </Prose></Card>
          <Card title="The honest caveat"><Prose>
            <p>This prices what is measurable about a site. Real siting decisions also turn on things it leaves out, and those are listed on the known gaps page. Treat the output as a way to narrow a field and to see which assumption your answer rests on, rather than as a decision.</p>
          </Prose></Card>
        </Page>
      )

    /* ── How to use ────────────────────────────────────────────────────────── */
    case 'how-to-use':
      return <HowToUsePage go={go} route={route} surface="app"
        openWorkedExample={openWorkedExample}
        openingWorkedExample={openingWorkedExample} />

    default:
      return null
  }
}

/* ── how-to-use page — one place for everything ─────────────────────────── */
function HowToUsePage({
  go,
  route = 'how-to-use',
  surface = 'docs',
  openWorkedExample,
  openingWorkedExample,
}: {
  go: (r: Route) => void
  route?: Route
  surface?: 'docs' | 'app'
  openWorkedExample: () => void
  openingWorkedExample: boolean
}) {
  const [showExample, setShowExample] = useState(false)

  const eg = useMemo(() => {
    const build = (over?: { key: string; driver: any; mult: number }) =>
      rank(DEFAULT_SITES.map(s =>
        priceSite(s.key, s.label, s.place, P,
          applyProjections(s.base, over && over.key === s.key ? { [over.driver]: over.mult } : undefined))))
    const ranked = build()
    const leader = ranked[0]
    const cheapest = [...ranked].sort((a, b) => a.lifetimePerKw - b.lifetimePerKw)[0]
    const flip = (k: string) => {
      const d = PROJECTION_DRIVERS.find(x => x.key === k)!
      const m = flipMultiplier(mm => build({ key: leader.key, driver: k, mult: mm }), leader.key, 1, 4)
      return m === null ? null : { pct: (m - 1) * 100, at: d.fmt(leader.drivers[d.key] * m) }
    }
    return {
      leader, cheapest,
      premium: ((leader.lifetimePerKw - cheapest.lifetimePerKw) / cheapest.lifetimePerKw) * 100,
      renewable: leader.drivers.renewablePct === null ? null : Math.round(leader.drivers.renewablePct * 100),
      hazard: leader.drivers.riskScore,
      buildFlip: flip('constructionPerKw'),
      powerFlip: flip('powerRate'),
    }
  }, [])

  // Three interconnection examples from the dataset, each carrying a named source.
  const QUEUE_KEYS = ['ca-toronto', 'fr-paris', 'nl-amsterdam'] as const
  const queueRows = QUEUE_KEYS.flatMap(key => {
    const r = INTL_REGIONS.find(x => x.key === key)
    const cell = r?.drivers['grid_interconnection_years']
    if (!r || !cell) return []
    const [city, country] = r.label.split(/,\s*/)
    return [{ key, city, country: country ?? '', v: cell.v }]
  })

  const short = (x: string) => x.replace(/,.*$/, '')

  return (
    <Page go={go} route={route} surface={surface} title={ROUTE_TITLES['how-to-use']}
      lead="How to run a comparison, how the ranking is built, what each variable measures, how the cost is calculated, and a finished example."
      maxW="max-w-[860px]">

      <MoreInfoJump />
      <Moves />

      {/* ── 1. Using the tool ────────────────────────────────────────────── */}
      <div id="mi-1" className="scroll-mt-6"><Card title="Using the tool">
        <Prose>
          <H id="mi-regions">Step 1 — compare regions inputted on parcel projections</H>
          <p>Enter two to four candidate regions on the setup screen. For each one you can type a
            free-text description — the name of a county, a metro, an operator zone, or anything
            else that narrows the region down. The engine prices each candidate across the same
            fifteen-year horizon so the results sit on a common scale, and the narrative names
            the single driver that would put a different site first.</p>

          <H id="mi-parcels">Step 2 — find parcels in top data center markets (beta)</H>
          <p>Switch the zoom level to parcels on the setup screen and the tool searches the
            candidate parcel inventory for the markets you are considering. Each parcel carries
            a cost waterfall and a provenance table showing where every figure came from. The
            parcel layer is in beta: coverage is limited to a handful of high-activity US
            markets, and parcels without a land price or an interconnection estimate are shown
            but excluded from any ranked comparison.</p>

          <H id="mi-project">Step 3 — calculate the TCO for your data center</H>
          <p>Enter your project parameters — capacity in kW, design PUE, design WUE, lifetime
            in years, and discount rate — on the setup screen, then run. The engine returns a
            ranked list with an itemized CapEx and OpEx breakdown per site, a lifetime cost per
            kW, a build cost per kW, a low/base/high scenario band, and the sentence that says
            which assumption the ranking rests on. Nothing here is estimated by a language
            model: the numbers come from the engine and the figures in the dataset.</p>
        </Prose>
      </Card></div>

      {/* ── 2. How the ranking works ─────────────────────────────────────── */}
      <div id="mi-2" className="scroll-mt-6"><Card title="How the ranking works">
        <Prose>
          <p>Every candidate is priced across the full fifteen years. That gives one cost figure
            per site. Three more things that cost alone will not tell you are measured alongside
            it: hazard risk, how clean the local grid is, and how far the site sits from your
            users.</p>
          <p>Each of the four is normalized across the sites in your set, so the best performer
            scores 1 and the worst scores 0. The four scores are combined and the highest total
            ranks first.</p>
          <p>When a site has no figure for one of the four, that dimension is dropped from its
            score and the remaining weights are renormalized. A missing figure never counts as a
            zero because a gap in the data is not the same as bad performance.</p>

          <H id="mi-sliders">Why the percentage sliders are gone</H>
          <p>An earlier version asked how much you cared about clean power on a scale of nought
            to a hundred. That question has no honest answer. The number you pick is arbitrary,
            and because it feeds straight into the ranking, the output inherits that
            arbitrariness.</p>
          <p>The sliders now ask something you have a real view on, which is what you think the
            cost to build, the power price and the staff cost will do over the life of the build.
            Those are forecasts a person can defend in a meeting.</p>
          <p>Each slider also carries the point where the ranking changes hands, marked on the
            track itself. The sensitivity analysis and the control are now the same object, so
            you can see how much room you have before an assumption starts to matter.</p>

          <H id="mi-normalising">Normalising, in full</H>
          <p>For a driver where lower is better, such as cost or hazard risk, a site scores{' '}
            <code className="num">1 - (v - min) / (max - min)</code>. For a driver where higher
            is better, such as renewable share, it scores{' '}
            <code className="num">(v - min) / (max - min)</code>.</p>
          <p>Each formula is computed across the sites you are comparing rather than against a
            national benchmark. A score of 1 means best in your set rather than best in the
            country. Comparing two different sets of sites is comparing two different scales.</p>
          <p>When every site shares the same value on a driver, that driver contributes 0.5 to
            all of them, which is neutral.</p>

          <H>What the ranking will not do</H>
          <p>It prices what is measurable about a site and stays silent on everything else. The
            list of what it does not model sits on the known gaps page.</p>
          <p>It also will not rank a single site. With one candidate there is nothing to
            normalize against.</p>
        </Prose>
      </Card></div>

      {/* ── 3. Why each variable matters ─────────────────────────────────── */}
      <div id="mi-3" className="scroll-mt-6"><Card title="Why each variable matters">
        <Prose>
          <p>Location dominates whole-life cost, and these four categories are why. Each one
            is present across every site from the first day, and each compounds differently
            over fifteen years.</p>

          <H id="mi-land">Land</H>
          <p>The one cost paid before anything is built, and the acreage sets a ceiling on how
            much can ever go there. A 10 MW campus is sized at 12 acres and never below 5,
            so a high land price in a constrained market hits the build budget before a single
            kilowatt goes online. Land is not modeled for regions without a published figure,
            because a wrong land price moves the answer more than a missing one does.</p>

          <H id="mi-energy">Energy</H>
          <p>Priced across the whole fifteen years, and the wait to connect can hold a build
            back longer than the price does. The power tariff is the single largest running
            cost for most sites, computed as facility energy at the design PUE times the
            annual hours times the rate. That is the straightforward part.</p>
          <p>The binding question in 2026 is whether you can get power at all. The queue to
            connect a large load to the grid runs years long in many markets, and it varies
            more between regions than the tariff does. A site that is two cents cheaper per
            kWh and four years slower to energize may not be the better site. The wait is
            surfaced with its source so it can inform that judgment, but it is deliberately
            excluded from both the cost model and the ranking because a published queue time
            is not the same thing as a committed energization date for a specific project.</p>
          {queueRows.length > 0 && (
            <Table
              head={['Region', 'Country', 'Years to connect', 'Source']}
              rows={queueRows.map(r => [
                <span className="font-medium text-ink">{r.city}</span>,
                <span className="text-mid">{r.country}</span>,
                <span className="num">{r.v}</span>,
                <span className="text-mid">IESO, RTE, TenneT</span>,
              ])}
            />
          )}

          <H id="mi-tax">Regulations and taxes</H>
          <p>A rate that repeats every year of the life, and an abatement that moves the total
            more than most single line items. Property tax is computed year by year — not as
            an average — which is what lets a ten-year abatement show up properly instead of
            being smeared across the whole term. A capital incentive is netted off the build
            cost rather than spread across the years. A state with a high tax rate and a
            ten-year abatement can outperform one with a low rate and no abatement, depending
            on the discount rate and the life of the build.</p>

          <H id="mi-other">Other costs</H>
          <p>Construction, staff, water, hazard exposure and distance to users: the lines that
            separate two otherwise similar sites. Construction is the largest single CapEx
            item. Staff cost is the largest variable OpEx item after power. Water consumption
            depends on the cooling design rather than the region, so the rate is a regional
            figure and the liters per kWh is a project parameter. Hazard exposure and distance
            to users do not appear in the cost formula but feed the normalized scoring, so a
            site that wins on cost can still lose on the composite if it sits in a high-hazard
            zone or a long way from the users it will serve.</p>
        </Prose>
      </Card></div>

      {/* ── 4. How the cost is calculated ─────────────────────────────────── */}
      <div id="mi-4" className="scroll-mt-6"><Card title="How the cost is calculated">
        <Prose>
          <Legend />

          <H id="mi-capex">Capital cost</H>
          <Fml out="acres" parts={[['k','max(5,'],['in','capacity_MW'],['op','×'],['k','1.2)']]}
            gloss="A 10 MW campus is sized at 12 acres and never below 5. Acreage sets the ceiling on what can ever go there." />
          <Fml out="land" parts={[['calc','acres'],['op','×'],['reg','land_price_per_acre']]}
            gloss="The one cost paid before anything is built. Regions with no published land price are not modelled, because a wrong land price moves the answer further than a missing one." />
          <Fml out="construction" parts={[['in','capacity_kW'],['op','×'],['reg','cost_to_build_per_kW']]}
            gloss="The largest single CapEx item, and the one the flip figure most often lands on." />
          <Fml out="capex" parts={[['k','max(0,'],['calc','land'],['op','+'],['calc','construction'],['op','−'],['in','incentive'],['k',')']]}
            gloss="A capital incentive is netted off the build rather than spread across the years." />
          <p>Electrical and cooling are not added again: the construction index already includes
            mechanical and electrical fit-out and equipment. IT fit-out is not priced by this
            model.</p>

          <H id="mi-opex">Running cost, per year</H>
          <Fml out="facility energy" parts={[['in','capacity_kW'],['op','×'],['in','PUE'],['op','×'],['k','8,760 h']]}
            gloss="Design PUE, not fleet-average PUE." />
          <Fml out="power" parts={[['calc','facility energy'],['op','×'],['reg','power_price_per_kWh']]}
            gloss="The largest running cost for most sites. The wait to connect is priced separately, because a site two cents cheaper and four years slower is not the cheaper site." />
          <Fml out="cooling energy" parts={[['in','capacity_kW'],['op','×'],['k','('],['in','PUE'],['op','−'],['k','1)'],['op','×'],['k','8,760 h']]} />
          <Fml out="water" parts={[['calc','cooling energy'],['op','×'],['in','WUE'],['op','÷'],['k','3,785.4'],['op','×'],['reg','water_price_per_kgal']]}
            gloss="Consumption follows the cooling design, so WUE is yours and the price is the region’s." />
          <Fml out="staff" parts={[['in','capacity_kW'],['op','×'],['k','$280'],['op','×'],['reg','staff_cost_index']]}
            gloss="The largest variable OpEx item after power." />
          <Fml out="maintenance" parts={[['calc','capex'],['op','×'],['k','1.0%']]} />
          <Fml out="tax" parts={[['calc','capex'],['op','×'],['reg','tax_rate']]}
            gloss="Zero during the abatement years, and computed year by year — which is the whole point. A ten-year abatement against a high rate can beat a low rate with none." />
          <Fml out="connectivity" parts={[['in','capacity_kW'],['op','×'],['k','$60']]} />
          <p>Tax is computed year by year rather than as an average, which is what lets a ten
            year abatement show up properly instead of being smeared across the whole life.</p>

          <H id="mi-npv">Bringing it back to today</H>
          <Fml out="running cost NPV" parts={[['k','Σ'],['calc','running cost in year t'],['op','÷'],['k','(1 +'],['in','discount rate'],['k',')^t']]}
            gloss="Summed over each year of the life, each year priced on its own before it is discounted." />
          <Fml out="cost NPV" parts={[['op','−('],['calc','capex'],['op','+'],['calc','running cost NPV'],['op',')']]} />
          <Fml out="lifetime cost per kW" parts={[['k','|'],['calc','cost NPV'],['k','|'],['op','÷'],['in','capacity_kW']]}
            gloss="The headline figure the ranking is built on." />
          <Fml out="build cost per kW" parts={[['calc','capex'],['op','÷'],['in','capacity_kW']]} />
          <p>Each year is priced separately and then discounted, rather than one year being
            repeated across the whole term. That matters where a site has a property tax
            abatement. At {PROJECT.lifetimeYears} years and a{' '}
            {(PROJECT.discountRate * 100).toFixed(0)}% discount rate, a site whose running
            cost never changes carries about eight and a half years of it in today&rsquo;s
            money.</p>
          <p>When you enter expected monthly revenue per kW, the engine applies the occupancy
            assumption to calculate annual revenue, subtracts the first year&rsquo;s operating
            cost, and divides capital cost by that positive annual balance to derive payback.
            If no revenue is entered or operating cost consumes it, payback is not reached.</p>

          <H>The band around each figure</H>
          <p>Each site carries low, base and high scenarios. The engine recomputes the full
            CapEx, annual OpEx and discounted lifetime cost using the dataset&rsquo;s low/high
            power-rate and construction-cost bounds. It is an input-supported scenario band,
            not a statistical confidence interval.</p>
        </Prose>
      </Card></div>

      {/* ── 5. A worked example — live figures ────────────────────────────── */}
      <Card title="A worked example" note={`${PROJECT.capacityMw} MW, ${PROJECT.lifetimeYears} years`}>
        {!showExample && (
          <div className="p-6 text-center sm:p-8">
            <p className="mx-auto mb-5 max-w-[52ch] text-[15.5px] leading-[1.65] text-mid">
              A three-site comparison already run. It ends on the sentence that says which input is
              worth checking before anyone commits money.
            </p>
            <button className="btn btn-primary" onClick={() => setShowExample(true)}>
              See a finished comparison
              <ArrowRight size={17} strokeWidth={2.4} aria-hidden />
            </button>
          </div>
        )}
        {showExample && (
          <div className="p-5 sm:p-6">
            <p className="mb-4 max-w-[70ch] text-[15.5px] leading-[1.7] text-ink2">
              In the run below, the cheapest site loses. {short(eg.cheapest.label)} prices at{' '}
              <b className="num font-semibold text-ink">{usd(eg.cheapest.lifetimePerKw)}</b> per kW
              against {short(eg.leader.label)}&rsquo;s{' '}
              <b className="num font-semibold text-ink">{usd(eg.leader.lifetimePerKw)}</b> and
              still finishes second. A {eg.hazard?.toFixed(1)} hazard score and a{' '}
              {eg.renewable}% renewable grid outweigh a {eg.premium.toFixed(1)}% cost premium.
            </p>
            <div className="rounded-[11px] border border-line bg-card2 p-4">
              <p className="text-[12px] font-bold uppercase tracking-[.09em] text-dim mb-2">The number worth remembering</p>
              <p className="max-w-[70ch] text-[15px] leading-[1.6] text-ink2">
                {eg.buildFlip ? (
                  <>
                    {short(eg.leader.label)} stops winning the moment its build cost rises{' '}
                    <b className="num font-semibold text-ink">{eg.buildFlip.pct.toFixed(1)}%</b>.{' '}
                    {eg.powerFlip
                      ? <>Its power price would have to rise{' '}
                          <b className="num font-semibold text-ink">{eg.powerFlip.pct.toFixed(1)}%</b>{' '}
                          to do the same damage. The build estimate is more fragile than the
                          energy contract.</>
                      : <>Its power price never moves the order at all. The build estimate is
                          the fragile figure here.</>}
                  </>
                ) : (
                  <>{short(eg.leader.label)} holds first place across the whole range these
                    sliders cover.</>
                )}
              </p>
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <button className="btn btn-primary" onClick={openWorkedExample}
                disabled={openingWorkedExample}>
                {openingWorkedExample ? 'Loading the comparison…' : 'Open the full comparison'}
                <ArrowRight size={17} strokeWidth={2.4} aria-hidden />
              </button>
              <button className="btn btn-quiet" onClick={() => setShowExample(false)}>
                Hide this
              </button>
            </div>
          </div>
        )}
      </Card>
    </Page>
  )
}
