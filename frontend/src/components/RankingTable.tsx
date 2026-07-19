import type { EstimateOutput, Scenario } from '../types/schema.ts'
import { formatUSD, formatPerKW } from '../utils/formatCurrency.ts'

interface RankingTableProps {
  output:   EstimateOutput
  scenario: Scenario
}

/**
 * Displays the ranked sites with key financial metrics.
 * Highlights the top-ranked site.
 */
export function RankingTable({ output, scenario }: RankingTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border border-gray-300">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Rank</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Site</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">$/kW</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">NPV</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Payback (yr)</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-700">Score</th>
          </tr>
        </thead>
        <tbody>
          {output.ranking.map((siteId) => {
            const site = output.sites[siteId]
            if (!site) return null
            const isTop = site.rank === 1
            const range = site.finance.ranges[scenario]
            return (
              <tr
                key={siteId}
                className={`${isTop ? 'bg-green-50 font-medium' : 'bg-white'} border-t`}
              >
                <td className="px-4 py-2 text-sm">{site.rank}</td>
                <td className="px-4 py-2 text-sm">
                  {output.sites[siteId] ? siteId : siteId}
                </td>
                <td className="px-4 py-2 text-sm">{formatPerKW(range.levelized_per_kw)}</td>
                <td className="px-4 py-2 text-sm">{formatUSD(range.npv_usd)}</td>
                <td className="px-4 py-2 text-sm">{site.finance.payback_years.toFixed(1)}</td>
                <td className="px-4 py-2 text-sm">{site.weighted_score.toFixed(3)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
