import type { EstimateOutput, Scenario } from '../types/schema.ts'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { formatUSD } from '../utils/formatCurrency.ts'

interface CostBreakdownChartProps {
  output:   EstimateOutput
  scenario: Scenario
}

/**
 * Stacked bar chart showing CapEx + OpEx breakdown per site.
 * Uses Recharts.
 */
export function CostBreakdownChart({ output, scenario }: CostBreakdownChartProps) {
  // Build data array for Recharts
  const data = output.ranking.map((siteId) => {
    const site = output.sites[siteId]
    if (!site) return null
    return {
      name: siteId,
      Land:         site.capex.land_usd / 1e6,
      Construction: site.capex.construction_usd / 1e6,
      Electrical:   site.capex.electrical_usd / 1e6,
      Cooling:      site.capex.cooling_usd / 1e6,
      'IT Fitout':  site.capex.it_fitout_usd / 1e6,
      'OpEx (20y)': Math.abs(site.finance.ranges[scenario].npv_usd - site.capex.total_usd) / 1e6,
    }
  }).filter(Boolean)

  return (
    <div className="border border-gray-300 rounded-md p-4 bg-white">
      <h3 className="text-base font-semibold text-gray-800 mb-4">Cost Breakdown ($ millions)</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis tickFormatter={(v) => `$${v}M`} />
          <Tooltip formatter={(v) => formatUSD(Number(v) * 1e6)} />
          <Legend />
          <Bar dataKey="Land"         stackId="a" fill="#3b82f6" />
          <Bar dataKey="Construction" stackId="a" fill="#60a5fa" />
          <Bar dataKey="Electrical"   stackId="a" fill="#93c5fd" />
          <Bar dataKey="Cooling"      stackId="a" fill="#bfdbfe" />
          <Bar dataKey="IT Fitout"    stackId="a" fill="#dbeafe" />
          <Bar dataKey="OpEx (20y)"   stackId="a" fill="#fbbf24" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
