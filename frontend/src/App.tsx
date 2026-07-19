import { useState } from 'react'
import { SiteForm }           from './components/SiteForm.tsx'
import { RankedSiteCards }    from './components/RankedSiteCards.tsx'
import { ScenarioToggle }     from './components/ScenarioToggle.tsx'
import { RecommendationCard } from './components/RecommendationCard.tsx'
import { CostBreakdownChart } from './components/CostBreakdownChart.tsx'
import { SensitivityChart }   from './components/SensitivityChart.tsx'
import { useEstimate }        from './hooks/useEstimate.ts'
import type { SiteInput, Scenario } from './types/schema.ts'

function App() {
  const { data, loading, error, submit, reset } = useEstimate()
  const [scenario, setScenario] = useState<Scenario>('base')

  // Build a label map once we have results
  const siteLabels: Record<string, string> = {}
  if (data) {
    for (const sid of data.ranking) {
      // Try to get the label from provenance → fallback to site_id
      siteLabels[sid] = sid
    }
  }

  async function handleSubmit(
    sites: SiteInput[],
    projectName: string,
    capacityKW: number,
    designPUE: number,
    lifetimeYears: number,
    discountRate: number,
  ) {
    // Build siteLabels map from form state
    await submit({
      project: {
        name:           projectName,
        capacity_kw:    capacityKW,
        design_pue:     designPUE,
        lifetime_years: lifetimeYears,
        discount_rate:  discountRate,
      },
      sites,
    })
  }

  // Derive labels from ranking order for display
  const rankLabels: Record<string, string> = {}
  if (data) {
    // We don't store the form sites separately, so use provenance data_provenance
    // and the ranking list to reconstruct. Fallback: use site_id as label.
    for (const sid of data.ranking) {
      // The recommendation text contains the label — parse from sensitivity_callouts
      const callout = data.narrative.sensitivity_callouts.find(c => c.site_id === sid)
      rankLabels[sid] = callout?.label ?? sid
    }
  }

  return (
    <div className="min-h-screen bg-ibm-cool-10">

      {/* ── Top nav ───────────────────────────────────────────────────────── */}
      <header className="bg-ibm-cool-100 text-white">
        <div className="max-w-screen-xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* IBM-style logo mark */}
            <svg width="32" height="13" viewBox="0 0 32 13" fill="none" aria-hidden>
              <rect width="32" height="2"   y="0"  fill="#0f62fe"/>
              <rect width="32" height="2"   y="3.5" fill="#0f62fe"/>
              <rect width="32" height="2"   y="7"  fill="#0f62fe"/>
              <rect width="20" height="2"   y="10.5" x="6" fill="#0f62fe"/>
            </svg>
            <div>
              <div className="text-sm font-semibold tracking-wide">BOB · Data-Center Site Copilot</div>
              <div className="text-xs text-ibm-cool-40 font-mono">IBM AI Builders Challenge</div>
            </div>
          </div>
          {data && (
            <button onClick={reset} className="btn-ghost border-ibm-cool-60 text-ibm-cool-30 hover:bg-ibm-cool-90 text-xs">
              ← New analysis
            </button>
          )}
        </div>
      </header>

      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-8">

        {/* ── Input form ─────────────────────────────────────────────────── */}
        {!data && (
          <div className="max-w-3xl mx-auto">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold text-ibm-cool-90">Compare data-center sites</h1>
              <p className="text-ibm-cool-60 text-sm mt-1">
                Add 2–4 candidate sites. The engine prices CapEx, OpEx, NPV, and levelized cost;
                then generates a plain-English investment memo.
              </p>
            </div>

            <SiteForm onSubmit={handleSubmit} loading={loading} />

            {error && (
              <div className="mt-4 border-l-4 border-ibm-red bg-ibm-red/5 px-4 py-3">
                <p className="text-sm font-semibold text-ibm-red">Request failed</p>
                <p className="text-xs text-ibm-cool-70 mt-1 font-mono">{error}</p>
                <p className="text-xs text-ibm-cool-50 mt-1">Is the backend running on port 3001?</p>
              </div>
            )}
          </div>
        )}

        {/* ── Loading overlay ────────────────────────────────────────────── */}
        {loading && !data && (
          <div className="mt-8 flex flex-col items-center gap-4 text-ibm-cool-60">
            <div className="w-8 h-8 border-2 border-ibm-blue border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium">Running cost engine + generating narrative…</p>
            <p className="text-xs text-ibm-cool-40 font-mono">POST /estimate</p>
          </div>
        )}

        {/* ── Results ────────────────────────────────────────────────────── */}
        {data && (
          <div className="space-y-6">

            {/* Results header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-semibold text-ibm-cool-90">
                  Analysis complete — {data.ranking.length} sites ranked
                </h1>
                <p className="text-xs text-ibm-cool-50 font-mono mt-0.5">
                  engine {data.engine_version} · {new Date(data.generated_at).toLocaleTimeString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-ibm-cool-50 uppercase tracking-wide font-medium">Cost scenario</span>
                <ScenarioToggle scenario={scenario} onChange={setScenario} />
              </div>
            </div>

            {/* Ranked cards */}
            <RankedSiteCards output={data} scenario={scenario} siteLabels={rankLabels} />

            {/* Charts row */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <CostBreakdownChart output={data} scenario={scenario} siteLabels={rankLabels} />
              <SensitivityChart output={data} />
            </div>

            {/* Recommendation */}
            <RecommendationCard output={data} />

            {/* Provenance accordion */}
            <details className="card">
              <summary className="px-5 py-3 cursor-pointer text-xs font-semibold uppercase tracking-wide text-ibm-cool-60 hover:bg-ibm-cool-10 select-none">
                Data provenance ({data.data_provenance.length} sources)
              </summary>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-ibm-cool-10 border-y border-ibm-cool-20">
                    <tr>
                      {['Region', 'Driver', 'Value', 'Source', 'Verified'].map(h => (
                        <th key={h} className="px-4 py-2 text-left font-medium text-ibm-cool-60 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ibm-cool-10">
                    {data.data_provenance.map((p, i) => (
                      <tr key={i} className="hover:bg-ibm-cool-10/50">
                        <td className="px-4 py-2 font-mono text-ibm-cool-70">{p.region_key}</td>
                        <td className="px-4 py-2 text-ibm-cool-60">{p.driver}</td>
                        <td className="px-4 py-2 font-mono text-ibm-cool-80">{p.value}</td>
                        <td className="px-4 py-2">
                          <a href={p.source_url} target="_blank" rel="noreferrer"
                             className="text-ibm-blue hover:underline truncate max-w-[200px] block">
                            {p.source_url.replace(/^https?:\/\//, '').slice(0, 40)}…
                          </a>
                        </td>
                        <td className="px-4 py-2 text-ibm-cool-50 font-mono">{p.last_verified}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

          </div>
        )}

      </div>

      <footer className="mt-16 border-t border-ibm-cool-20 py-4">
        <p className="text-center text-xs text-ibm-cool-40 font-mono">
          BOB-datacenter · IBM AI Builders Challenge 2025 · All figures computed deterministically; LLM cites engine numbers only
        </p>
      </footer>
    </div>
  )
}

export default App
