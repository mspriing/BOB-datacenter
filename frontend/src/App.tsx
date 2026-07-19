import { useState } from 'react'
import { SiteForm } from './components/SiteForm.tsx'
import { RankingTable } from './components/RankingTable.tsx'
import { ScenarioToggle } from './components/ScenarioToggle.tsx'
import { RecommendationCard } from './components/RecommendationCard.tsx'
import { CostBreakdownChart } from './components/CostBreakdownChart.tsx'
import { SensitivityChart } from './components/SensitivityChart.tsx'
import { useEstimate } from './hooks/useEstimate.ts'
import type { SiteInput, Scenario } from './types/schema.ts'

function App() {
  const { data, loading, error, submit, reset } = useEstimate()
  const [scenario, setScenario] = useState<Scenario>('base')

  async function handleSubmit(sites: SiteInput[], projectName: string, capacityKW: number) {
    await submit({
      project: {
        name:           projectName,
        capacity_kw:    capacityKW,
        design_pue:     1.4,
        lifetime_years: 20,
        discount_rate:  0.08,
      },
      sites,
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-700 text-white py-4 px-6 shadow-md">
        <h1 className="text-2xl font-bold">BOB Data-Center Site Copilot</h1>
        <p className="text-sm text-blue-100 mt-1">IBM AI Builders Challenge — Prototype</p>
      </header>

      <main className="container mx-auto px-6 py-8">
        {!data ? (
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-4">
              Compare 2–4 candidate sites
            </h2>
            <SiteForm onSubmit={handleSubmit} />
            {loading && (
              <div className="mt-6 text-center text-gray-600">
                Analyzing candidates…
              </div>
            )}
            {error && (
              <div className="mt-6 p-4 bg-red-50 border border-red-300 rounded-md text-red-800">
                <strong>Error:</strong> {error}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">
                Results — {data.ranking.length} sites compared
              </h2>
              <button
                onClick={reset}
                className="px-4 py-2 text-sm font-medium bg-gray-200 hover:bg-gray-300 rounded-md transition"
              >
                ← New comparison
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">Scenario:</span>
              <ScenarioToggle scenario={scenario} onChange={setScenario} />
            </div>

            <RankingTable output={data} scenario={scenario} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CostBreakdownChart output={data} scenario={scenario} />
              <SensitivityChart output={data} />
            </div>

            <RecommendationCard output={data} />

            <details className="text-xs text-gray-600">
              <summary className="cursor-pointer font-medium">
                View raw JSON response
              </summary>
              <pre className="mt-2 p-3 bg-gray-100 border border-gray-300 rounded overflow-x-auto">
                {JSON.stringify(data, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
