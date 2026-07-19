import type { EstimateOutput, Scenario } from '../types/schema.ts'
import { formatUSD, formatPerKW } from '../utils/formatCurrency.ts'

interface RankedSiteCardsProps {
  output:       EstimateOutput
  scenario:     Scenario
  siteLabels:   Record<string, string>
}

const MEDAL = ['🥇', '🥈', '🥉', '4']
const RANK_COLOR = [
  'border-ibm-blue shadow-winner',
  'border-ibm-cool-30',
  'border-ibm-cool-30',
  'border-ibm-cool-30',
]
const RANK_HEADER = [
  'bg-ibm-blue text-white',
  'bg-ibm-cool-90 text-ibm-cool-30',
  'bg-ibm-cool-80 text-ibm-cool-40',
  'bg-ibm-cool-70 text-ibm-cool-40',
]

export function RankedSiteCards({ output, scenario, siteLabels }: RankedSiteCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {output.ranking.map((siteId) => {
        const site   = output.sites[siteId]
        if (!site) return null
        const rank   = site.rank - 1    // 0-indexed
        const range  = site.finance.ranges[scenario]
        const label  = siteLabels[siteId] ?? siteId
        const isWinner = rank === 0

        return (
          <div key={siteId} className={`card border-2 flex flex-col overflow-hidden ${RANK_COLOR[rank] ?? 'border-ibm-cool-30'}`}>
            {/* Card header */}
            <div className={`px-4 py-3 flex items-center justify-between ${RANK_HEADER[rank] ?? RANK_HEADER[3]}`}>
              <div className="flex items-center gap-2">
                <span className="text-xl leading-none">{MEDAL[rank]}</span>
                <span className="font-semibold text-sm tracking-wide">{label}</span>
              </div>
              <div className="text-right">
                <div className="text-xs opacity-70 font-mono">score</div>
                <div className="font-mono text-sm font-bold">{site.weighted_score.toFixed(3)}</div>
              </div>
            </div>

            {/* Primary metrics */}
            <div className="px-4 py-4 grid grid-cols-2 gap-x-4 gap-y-3 flex-1">
              <Metric label="Levelized $/kW" value={formatPerKW(range.levelized_per_kw)} highlight={isWinner} />
              <Metric label="NPV (total cost)" value={formatUSD(Math.abs(range.npv_usd))} />
              <Metric label="CapEx" value={formatUSD(site.capex.total_usd)} />
              <Metric label="Annual OpEx" value={formatUSD(site.opex_annual.total_usd)} />
              <Metric label="Payback" value={`${site.finance.payback_years.toFixed(1)} yr`} />
              <Metric label="Renewable" value={`${(site.non_cost_scores.renewable_pct * 100).toFixed(0)}%`} />
            </div>

            {/* Scores strip */}
            <div className="border-t border-ibm-cool-20 px-4 py-2 grid grid-cols-3 gap-2 text-center">
              <ScorePill label="Risk" value={`${site.non_cost_scores.risk_score.toFixed(1)}/10`}
                warn={site.non_cost_scores.risk_score > 5} />
              <ScorePill label="Latency" value={`${site.non_cost_scores.latency_ms} ms`} />
              <ScorePill label="Power cost"
                value={formatUSD(site.opex_annual.power_usd) + '/yr'} />
            </div>

            {/* Winner flip alert */}
            {isWinner && output.flip_sentence && (
              <div className="border-t-2 border-ibm-yellow bg-ibm-yellow/10 px-4 py-2">
                <p className="text-xs text-ibm-cool-80 leading-snug">
                  <span className="font-semibold text-ibm-cool-90">Flip condition:</span>{' '}
                  {output.flip_sentence}
                </p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs text-ibm-cool-50 uppercase tracking-wide font-medium">{label}</div>
      <div className={`font-mono text-sm font-semibold mt-0.5 ${highlight ? 'text-ibm-blue' : 'text-ibm-cool-90'}`}>
        {value}
      </div>
    </div>
  )
}

function ScorePill({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded px-1 py-1 ${warn ? 'bg-ibm-orange/10' : 'bg-ibm-cool-10'}`}>
      <div className="text-xs text-ibm-cool-50 uppercase tracking-wide">{label}</div>
      <div className={`font-mono text-xs font-semibold ${warn ? 'text-ibm-orange' : 'text-ibm-cool-80'}`}>{value}</div>
    </div>
  )
}
