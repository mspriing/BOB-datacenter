import { useMemo, useState } from 'react'
import { ArrowLeft, Mail, ExternalLink, Check } from 'lucide-react'
import { Card, Chip } from '../components/Primitives'
import { US_REGIONS, US_METROS, US_STATES } from '../data/usRegions'
import { COVERAGE } from '../data/project'
import { ROUTE_TITLES, CONTACT_URL, FOOTER_GROUPS, type Route } from '../lib/routes'

/* ── shell ────────────────────────────────────────────────────────────────── */
function groupOf(route: Route): string | null {
  for (const g of FOOTER_GROUPS) {
    if (g.links.some(l => l.to === route)) return g.heading
  }
  return null
}

function Page({ title, lead, children, go, route, maxW = 'max-w-[820px]' }: {
  title: string; lead: string; children: React.ReactNode; go: (r: Route) => void
  route?: Route; maxW?: string
}) {
  const group = route ? groupOf(route) : null
  return (
    <section className="docs-surface pt-6 sm:pt-10">
      <button onClick={() => go('home')}
        className="mb-5 inline-flex items-center gap-1.5 text-[13.5px] text-mid transition-colors hover:text-blued">
        <ArrowLeft size={14} strokeWidth={2.2} aria-hidden />Back to the start
      </button>
      <div className="mb-8 max-w-[68ch]">
        <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 label-xs">
          <button onClick={() => go('home')}
            className="transition-colors hover:text-blued">Reference</button>
          {group && (
            <>
              <span aria-hidden>/</span>
              <span>{group}</span>
            </>
          )}
        </nav>
        <h1 className="mb-3 text-[clamp(1.875rem,1.5rem+1.6vw,2.75rem)] font-semibold text-ink">{title}</h1>
        <p className="text-[17px] leading-[1.65] text-mid">{lead}</p>
      </div>
      <div className={`${maxW} space-y-3.5`}>{children}</div>
    </section>
  )
}

function Prose({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 p-6 text-[15.5px] leading-[1.72] text-ink2">{children}</div>
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-2 text-[19px] font-semibold text-ink">{children}</h2>
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13.5px]">
        <thead>
          <tr>{head.map(h => (
            <th key={h} className="border-y border-[var(--line2)] bg-card2 px-5 py-2.5 text-left
              text-[11px] font-bold uppercase tracking-[.09em] text-dim">{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="transition-colors hover:bg-[rgba(228,238,255,.5)]">
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

/* ── contact form, opens a public issue rather than posting anywhere ─────── */
function ContactForm({ subject, fields, blurb }: {
  subject: string
  fields: Array<{ id: string; label: string; placeholder?: string; area?: boolean }>
  blurb: string
}) {
  const [vals, setVals] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)
  const body = fields.map(f => `${f.label}:\n${vals[f.id] ?? ''}`).join('\n\n')
  const href = `${CONTACT_URL}?title=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  return (
    <Card title={subject} note="Opens a public issue on the repository">
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
          <a className="btn btn-primary" href={href} target="_blank" rel="noreferrer">
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
const DRIVERS: Array<{ key: string; name: string; plain: string; unit: string }> = [
  { key: 'power_rate_usd_per_kwh', name: 'Power price', unit: '$ per kWh',
    plain: 'What you pay for a unit of electricity on an industrial tariff. The single largest running cost for most sites.' },
  { key: 'construction_cost_per_kw', name: 'Cost to build', unit: '$ per kW',
    plain: 'What one kilowatt of capacity costs to put in the ground, covering shell, structure and site works.' },
  { key: 'staff_cost_index', name: 'Staff cost', unit: 'index, 1.00 is median',
    plain: 'Local fully loaded operations pay against the national median. 1.20 means twenty percent above.' },
  { key: 'land_cost_per_acre_usd', name: 'Land price', unit: '$ per acre',
    plain: 'What an acre costs locally. A 10 MW campus is sized at 12 acres, and never below 5.' },
  { key: 'water_rate_usd_per_kgal', name: 'Water price', unit: '$ per thousand gallons',
    plain: 'The rate for the water cooling consumes. How much you use is a design choice rather than a property of the region.' },
  { key: 'tax_rate', name: 'Property tax rate', unit: 'share of assessed value',
    plain: 'The annual property tax applied to the built value of the site.' },
  { key: 'tax_abatement_years', name: 'Tax abatement', unit: 'years',
    plain: 'How many years of property tax a local incentive removes at the start of the life of the build.' },
  { key: 'incentive_usd_per_kw', name: 'Capital incentive', unit: '$ per kW',
    plain: 'One off capital support, netted off the build cost rather than spread across the years.' },
  { key: 'risk_score', name: 'Hazard risk', unit: '1 to 10',
    plain: 'Exposure to natural hazards such as flood, wind, quake and wildfire. Lower is calmer.' },
  { key: 'renewable_pct', name: 'Renewable share', unit: 'share of generation',
    plain: 'How much of the local grid runs on renewables. Drives the carbon position and exposure to fuel prices alike.' },
  { key: 'low_carbon_pct', name: 'Low carbon share', unit: 'share of generation',
    plain: 'Renewables plus nuclear. Always at least as large as the renewable share.' },
  { key: 'latency_ms_to_hub', name: 'Distance to your users', unit: 'ms round trip',
    plain: 'Round trip time to the nearest major interconnection hub. A proxy for how far the site sits from the people it serves.' },
  { key: 'grid_interconnection_years', name: 'Interconnection wait', unit: 'years',
    plain: 'How long the queue is to energize a large load on the local grid. In 2026 this binds harder than the tariff does.' },
]

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
export function DocPage({ route, go }: { route: Route; go: (r: Route) => void }) {
  const coverage = useMemo(() => DRIVERS.map(d => {
    const filled = US_REGIONS.filter(r => r.drivers[d.key])
    const sourced = filled.filter(r => r.drivers[d.key]!.basis === 'sourced').length
    const modeled = filled.filter(r => r.drivers[d.key]!.basis === 'modeled').length
    // Interconnection wait carries placeholders. Counting them as derived would
    // tell the reader a documented derivation exists, and none does.
    const placeholder = d.key === 'grid_interconnection_years'
    return {
      ...d, filled: filled.length, total: US_REGIONS.length, placeholder,
      sourced: placeholder ? 0 : sourced,
      modeled: placeholder ? 0 : modeled,
    }
  }), [])

  switch (route) {
    /* ── The tool ────────────────────────────────────────────────────────── */
    case 'how-ranking-works':
      return (
        <Page go={go} route={route} title={ROUTE_TITLES[route]}
          lead="The engine measures four things, puts them on the same scale, and combines them into one number. What follows is the arithmetic, what changed in it, and why.">
          <Card title="The short version"><Prose>
            <p>Every candidate is priced across the full fifteen years. That gives one cost figure per site. Three more things that cost alone will not tell you are measured alongside it: hazard risk, how clean the local grid is, and how far the site sits from your users.</p>
            <p>Each of the four is normalized across the sites in your set, so the best performer scores 1 and the worst scores 0. The four scores are combined and the highest total ranks first.</p>
            <p>When a site has no figure for one of the four, that dimension is dropped from its score and the remaining weights are renormalized. A missing figure never counts as a zero because a gap in the data is not the same as bad performance.</p>
          </Prose></Card>

          <Card title="Why the percentage sliders are gone"><Prose>
            <p>An earlier version asked how much you cared about clean power on a scale of nought to a hundred. That question has no honest answer. The number you pick is arbitrary, and because it feeds straight into the ranking, the output inherits that arbitrariness.</p>
            <p>The sliders now ask something you have a real view on, which is what you think the cost to build, the power price and the staff cost will do over the life of the build. Those are forecasts a person can defend in a meeting.</p>
            <p>Each slider also carries the point where the ranking changes hands, marked on the track itself. The sensitivity analysis and the control are now the same object, so you can see how much room you have before an assumption starts to matter.</p>
          </Prose></Card>

          <Card title="Normalising, in full"><Prose>
            <p>For a driver where lower is better, such as cost or hazard risk, a site scores <code className="num">1 - (v - min) / (max - min)</code>. For a driver where higher is better, such as renewable share, it scores <code className="num">(v - min) / (max - min)</code>.</p>
            <p>Each formula is computed across the sites you are comparing rather than against a national benchmark. A score of 1 means best in your set rather than best in the country. Comparing two different sets of sites is comparing two different scales.</p>
            <p>When every site shares the same value on a driver, that driver contributes 0.5 to all of them, which is neutral.</p>
          </Prose></Card>

          <Card title="What the ranking will not do"><Prose>
            <p>It prices what is measurable about a site and stays silent on everything else. The list of what it does not model sits on the known gaps page.</p>
            <p>It also will not rank a single site. With one candidate there is nothing to normalize against.</p>
          </Prose></Card>
        </Page>
      )

    case 'driver-meanings':
      return (
        <Page go={go} route={route} title={ROUTE_TITLES[route]}
          lead="Thirteen drivers, each in one sentence and carrying its unit.">
          <Card title="All thirteen">
            <Table head={['Driver', 'Unit', 'What it means']}
              rows={DRIVERS.map(d => [
                <span className="font-medium text-ink">{d.name}</span>,
                <span className="num text-mid">{d.unit}</span>,
                <span className="text-mid">{d.plain}</span>,
              ])} />
          </Card>
          <Card title="Three that get misread"><Prose>
            <p><b className="text-ink">Cost to build is not the whole cost.</b> It covers shell, structure and site works. Electrical plant, cooling plant and IT fit out are priced separately at fixed rates per kW, so two sites with the same build cost can still land in different places.</p>
            <p><b className="text-ink">Water use is yours. Water price is theirs.</b> The region sets the rate. How many liters per kWh your cooling design consumes is a decision you make, which is why it sits on the setup screen rather than in the regional data.</p>
            <p><b className="text-ink">Distance to your users is a proxy.</b> It measures the round trip to the nearest major interconnection hub rather than to your customers. If your users sit somewhere unusual, this driver will mislead you.</p>
          </Prose></Card>
        </Page>
      )

    case 'cost-method':
      return (
        <Page go={go} route={route} title={ROUTE_TITLES[route]}
          lead="Every formula the engine runs, and the constants written out. Nothing here is estimated by a language model.">
          <Card title="Capital cost"><Prose>
            <p className="num text-[14px] text-ink">acres = max(5, capacity_MW × 1.2)</p>
            <p className="num text-[14px] text-ink">land = acres × land_price_per_acre</p>
            <p className="num text-[14px] text-ink">construction = capacity_kW × cost_to_build_per_kW</p>
            <p className="num text-[14px] text-ink">electrical = capacity_kW × $550</p>
            <p className="num text-[14px] text-ink">cooling = capacity_kW × $400</p>
            <p className="num text-[14px] text-ink">IT fit out = capacity_kW × $200</p>
            <p className="num text-[14px] text-ink">capex = land + construction + electrical + cooling + fit out − incentive</p>
            <p className="text-mid">Electrical covers switchgear, uninterruptible supply, distribution units and transformers. Cooling is a baseline air cooled plant. Fit out is racks, trays and structured cabling. All three are held flat across regions, so any regional difference in build cost shows up in the construction line alone.</p>
          </Prose></Card>

          <Card title="Running cost, per year"><Prose>
            <p className="num text-[14px] text-ink">facility energy = capacity_kW × PUE × 8,760</p>
            <p className="num text-[14px] text-ink">power = facility energy × power_price_per_kWh</p>
            <p className="num text-[14px] text-ink">cooling energy = capacity_kW × (PUE − 1) × 8,760</p>
            <p className="num text-[14px] text-ink">water = cooling energy × WUE ÷ 3,785.4 × water_price_per_kgal</p>
            <p className="num text-[14px] text-ink">staff = capacity_kW × $280 × staff_cost_index</p>
            <p className="num text-[14px] text-ink">maintenance = capex × 1.5%</p>
            <p className="num text-[14px] text-ink">tax = capex × tax_rate, and zero during the abatement years</p>
            <p className="num text-[14px] text-ink">connectivity = capacity_kW × $60</p>
            <p className="text-mid">Tax is computed year by year rather than as an average, which is what lets a ten year abatement show up properly instead of being smeared across the whole life.</p>
          </Prose></Card>

          <Card title="Bringing it back to today"><Prose>
            <p className="num text-[14px] text-ink">running cost NPV = Σ over each year t of (running cost in year t) ÷ (1 + discount rate)^t</p>
            <p className="num text-[14px] text-ink">total = capex + running cost NPV</p>
            <p className="num text-[14px] text-ink">lifetime cost per kW = total ÷ capacity_kW</p>
            <p className="text-mid">Each year is priced separately and then discounted, rather than one year being repeated across the whole term. That matters where a site has a property tax abatement: a ten year abatement on a fifteen year build has to stop in year eleven. At fifteen years and an eight percent discount rate, a site whose running cost never changes carries about eight and a half years of it in today&rsquo;s money.</p>
          </Prose></Card>

          <Card title="The band around each figure"><Prose>
            <p>Each site carries a low and a high alongside the expected figure. The band comes from the low and high values published for each driver rather than from a confidence interval. Treat it as the range the inputs support rather than a statistical claim.</p>
          </Prose></Card>

          <Card title="Where the modeled build cost comes from" note="Applies to 56 of the 63 US regions"><Prose>
            <p>Seven US regions carry a published cost to build. The other 56 come from the state staff cost index, fitted by least squares against those seven sourced figures, since labor drives most of the regional variation in what it costs to put capacity in the ground. This is not a published construction index.</p>
            <p>Any figure produced this way is labeled <Chip tone="blue">modeled</Chip> wherever it appears, including on the map. It is a defensible estimate rather than a measurement, and it should not be quoted as one.</p>
          </Prose></Card>
        </Page>
      )

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
          <Card title="International, 14 regions"><Prose>
            <p>Fourteen international regions are priced and can be compared, though they are not drawn on the map. Nordic Hydro in Luleå and Boden is the one carried in the worked example, and it is the site that beats the cheapest option in that run.</p>
            <p>Drawing a world map means sourcing subnational power and labor data for every country in it. That work has not been done, so those regions stay in the comparison engine and out of the map rather than appearing with figures that are thinner than they look.</p>
          </Prose></Card>
        </Page>
      )

    case 'the-drivers':
      return (
        <Page go={go} route={route} title={ROUTE_TITLES[route]} maxW="max-w-[1100px]"
          lead="How well each of the thirteen drivers is filled across the 63 US regions, and how much of that is measured rather than derived. These counts are read from a snapshot of the dataset taken on 30 July 2026 that ships inside this page, not from the live engine, so they move only when the snapshot is regenerated. Water, land, tax and interconnection read low here because the hand-collected figures for the 25 real markets are committed to the repository but have not yet been merged into the regional dataset.">
          <Card title="Coverage by driver" note="Across the 63 US regions">
            <Table head={['Driver', 'Filled', 'Sourced', 'Derived', 'Coverage']}
              // interconnection wait shows its count as placeholder rather than derived
              rows={coverage.map(c => [
                <span className="font-medium text-ink">{c.name}</span>,
                <span className="num">{c.filled} of {c.total}</span>,
                <span className="num">{c.sourced}</span>,
                <span className="num">{c.placeholder ? `0, ${c.filled} placeholder` : c.modeled}</span>,
                <span className="flex items-center gap-2">
                  <span className="h-[7px] w-[90px] overflow-hidden rounded-full bg-card2">
                    <span className="block h-full rounded-full"
                      style={{ width: `${(c.filled / c.total) * 100}%`,
                               background: c.placeholder ? '#C8D0DA'
                                 : c.filled === c.total ? '#0B7A4B'
                                 : c.filled > c.total / 2 ? '#8A5200' : '#C22F2F' }} />
                  </span>
                  <span className="num text-mid">{Math.round((c.filled / c.total) * 100)}%</span>
                </span>,
              ])} />
          </Card>
          <Card title="How to read this"><Prose>
            <p>One driver is complete and measured for every US region, which is hazard risk. Power price and staff cost are complete and sourced for 57 of the 63, and six are derived. Renewable share and low carbon share are complete in the table above and almost entirely derived.</p>
            <p>Distance to a hub and cost to build are complete and mostly derived. They are good enough to shade a map and to sort a shortlist, and too rough for a board paper without checking the underlying region.</p>
            <p>Land price, property tax, water price, abatement and capital incentive exist for seven regions. Everywhere else they are blank. They are not estimated, since a wrong land price moves the answer more than a missing one does.</p>
          </Prose></Card>
        </Page>
      )

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

    default:
      return null
  }
}
