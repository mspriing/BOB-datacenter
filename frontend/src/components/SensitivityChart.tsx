import type { EstimateOutput } from '../types/schema.ts'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell, LabelList,
} from 'recharts'

interface SensitivityChartProps {
  output: EstimateOutput
}

// Map raw driver names → readable labels
function driverLabel(d: string): string {
  const MAP: Record<string, string> = {
    power_rate_usd_per_kwh:              'Power rate (rank-1 ↑)',
    'power_rate_usd_per_kwh (rank-2 drop)': 'Power rate (rank-2 ↓)',
    construction_cost_per_kw:            'Construction cost (rank-1 ↑)',
    land_cost_per_acre_usd:              'Land cost',
    water_rate_usd_per_kgal:             'Water rate',
    staff_cost_index:                    'Staffing index',
    tax_rate:                            'Property tax',
  }
  return MAP[d] ?? d.replace(/_/g, ' ')
}

function pctColor(pct: number): string {
  if (pct < 15) return '#da1e28'  // red — very fragile
  if (pct < 35) return '#ff832b'  // orange — watch
  return '#198038'                // green — stable
}

// Custom tooltip
function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { driver: string; pct: number; current_value: number; flip_value: number } }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-ibm-cool-90 text-ibm-cool-10 px-3 py-2 text-xs font-mono shadow-lg">
      <div className="font-semibold text-white mb-1">{driverLabel(d.driver)}</div>
      <div>current: {d.current_value.toFixed(4)}</div>
      <div>flip at: {d.flip_value.toFixed(4)}</div>
      <div>Δ needed: <span className={d.pct < 15 ? 'text-ibm-red' : d.pct < 35 ? 'text-ibm-orange' : 'text-ibm-teal'}>{d.pct.toFixed(1)}%</span></div>
    </div>
  )
}

export function SensitivityChart({ output }: SensitivityChartProps) {
  if (!output.sensitivity.length) return null

  const data = [...output.sensitivity]
    .sort((a, b) => a.pct_change - b.pct_change)   // most fragile at top
    .map(s => ({
      driver:        s.driver,
      label:         driverLabel(s.driver),
      pct:           +s.pct_change.toFixed(1),
      current_value: s.current_value,
      flip_value:    s.flip_value,
    }))

  const maxPct = Math.max(...data.map(d => d.pct), 50)

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-ibm-cool-90 uppercase tracking-wide">
          Sensitivity — % change to flip #1
        </h3>
        <span className="section-label">tornado</span>
      </div>
      <p className="text-xs text-ibm-cool-50 mb-4">
        How far each driver must move before the #1 and #2 ranked sites swap
      </p>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 52)}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 56, left: 8, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="2 2" stroke="#dde1e7" horizontal={false} />
          <XAxis
            type="number" domain={[0, maxPct]}
            tick={{ fontSize: 11, fill: '#697077', fontFamily: 'IBM Plex Mono' }}
            tickFormatter={v => `${v}%`}
            axisLine={false} tickLine={false}
          />
          <YAxis
            type="category" dataKey="label" width={200}
            tick={{ fontSize: 11, fill: '#697077', fontFamily: 'IBM Plex Sans' }}
            axisLine={false} tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          {/* "fragile" threshold line at 20% */}
          <ReferenceLine x={20} stroke="#f1c21b" strokeDasharray="4 2"
            label={{ value: '20% threshold', position: 'top', fontSize: 10, fill: '#878d96' }} />
          <Bar dataKey="pct" maxBarSize={24} radius={[0, 2, 2, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={pctColor(d.pct)} />
            ))}
            <LabelList
              dataKey="pct"
              position="right"
              formatter={(v: number) => `${v}%`}
              style={{ fontSize: 11, fontFamily: 'IBM Plex Mono', fill: '#697077' }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-3 text-xs text-ibm-cool-50">
        <ColorDot color="#da1e28" label="< 15% — fragile" />
        <ColorDot color="#ff832b" label="15–35% — watch" />
        <ColorDot color="#198038" label="> 35% — stable" />
      </div>
    </div>
  )
}

function ColorDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      {label}
    </span>
  )
}
