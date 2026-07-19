import type { EstimateOutput, Scenario } from '../types/schema.ts'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import { formatUSD } from '../utils/formatCurrency.ts'

interface CostBreakdownChartProps {
  output:     EstimateOutput
  scenario:   Scenario
  siteLabels: Record<string, string>
}

// IBM-palette segment colors
const CAPEX_COLORS: Record<string, string> = {
  Land:         '#1192e8',
  Construction: '#0f62fe',
  Electrical:   '#4589ff',
  Cooling:      '#78a9ff',
  'IT Fitout':  '#a6c8ff',
}
const OPEX_COLOR = '#ff832b'

export function CostBreakdownChart({ output, scenario, siteLabels }: CostBreakdownChartProps) {
  const data = output.ranking.map(siteId => {
    const site = output.sites[siteId]
    if (!site) return null
    const opexNPV = Math.abs(site.finance.ranges[scenario].npv_usd) - site.capex.total_usd
    return {
      name:         siteLabels[siteId] ?? siteId,
      Land:         +(site.capex.land_usd         / 1e6).toFixed(2),
      Construction: +(site.capex.construction_usd / 1e6).toFixed(2),
      Electrical:   +(site.capex.electrical_usd   / 1e6).toFixed(2),
      Cooling:      +(site.capex.cooling_usd       / 1e6).toFixed(2),
      'IT Fitout':  +(site.capex.it_fitout_usd     / 1e6).toFixed(2),
      'OpEx (NPV)': +(Math.max(0, opexNPV)         / 1e6).toFixed(2),
    }
  }).filter(Boolean)

  const capexKeys = ['Land', 'Construction', 'Electrical', 'Cooling', 'IT Fitout'] as const

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-ibm-cool-90 uppercase tracking-wide">
          Total cost breakdown
        </h3>
        <span className="section-label">$M</span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="2 2" stroke="#dde1e7" vertical={false} />
          <XAxis
            dataKey="name" tick={{ fontSize: 11, fill: '#697077', fontFamily: 'IBM Plex Sans' }}
            axisLine={false} tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#697077', fontFamily: 'IBM Plex Mono' }}
            tickFormatter={v => `$${v}M`}
            axisLine={false} tickLine={false} width={52}
          />
          <Tooltip
            formatter={(v: number, name: string) => [formatUSD(v * 1e6), name]}
            contentStyle={{
              background: '#21272a', border: 'none', borderRadius: 0,
              color: '#f2f4f8', fontSize: 12, fontFamily: 'IBM Plex Sans',
            }}
            itemStyle={{ color: '#f2f4f8' }}
            labelStyle={{ color: '#a2a9b0', fontWeight: 600, marginBottom: 4 }}
          />
          <Legend
            iconSize={10}
            wrapperStyle={{ fontSize: 11, fontFamily: 'IBM Plex Sans', color: '#697077' }}
          />
          {capexKeys.map(k => (
            <Bar key={k} dataKey={k} stackId="total" fill={CAPEX_COLORS[k]} maxBarSize={56} />
          ))}
          <Bar dataKey="OpEx (NPV)" stackId="total" fill={OPEX_COLOR} maxBarSize={56} />
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-2 text-xs text-ibm-cool-50">
        CapEx segments + NPV of {output.sites[output.ranking[0]]?.finance.payback_years.toFixed(0)}-year OpEx stream at selected scenario
      </p>
    </div>
  )
}
