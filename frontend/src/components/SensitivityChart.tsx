import type { EstimateOutput } from '../types/schema.ts'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface SensitivityChartProps {
  output: EstimateOutput
}

/**
 * Horizontal bar (tornado) chart showing flip-point sensitivities.
 * Displays the % change required to flip ranking.
 */
export function SensitivityChart({ output }: SensitivityChartProps) {
  const data = output.sensitivity.map((item) => ({
    name: item.driver.replace(/_/g, ' '),
    pct:  item.pct_change,
  }))

  return (
    <div className="border border-gray-300 rounded-md p-4 bg-white">
      <h3 className="text-base font-semibold text-gray-800 mb-4">
        Sensitivity Analysis (% change to flip ranking)
      </h3>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" tickFormatter={(v) => `${v}%`} />
          <YAxis type="category" dataKey="name" width={180} />
          <Tooltip formatter={(v) => `${v}%`} />
          <Bar dataKey="pct" fill="#f59e0b" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
