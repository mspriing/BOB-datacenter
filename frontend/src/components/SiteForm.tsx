import { useState } from 'react'
import type { SiteInput } from '../types/schema.ts'
import { REGION_OPTIONS } from '../types/schema.ts'

interface SiteFormProps {
  onSubmit: (
    sites: SiteInput[],
    projectName: string,
    capacityKW: number,
    designPUE: number,
    lifetimeYears: number,
    discountRate: number,
  ) => Promise<void>
  loading: boolean
}

const HERO_SITES: SiteInput[] = [
  { site_id: 'nova',   label: 'Northern Virginia', region_key: 'us-va-northern'  },
  { site_id: 'ercot',  label: 'Texas ERCOT',        region_key: 'us-tx-ercot'     },
  { site_id: 'nordic', label: 'Nordic Hydro',        region_key: 'eu-nordic-hydro' },
]

const DEFAULT_SITE = (index: number): SiteInput => ({
  site_id:    `site-${String.fromCharCode(65 + index)}`,
  label:      '',
  region_key: REGION_OPTIONS[0].key,
  free_text:  '',
})

export function SiteForm({ onSubmit, loading }: SiteFormProps) {
  const [projectName, setProjectName] = useState('Site Selection Analysis')
  const [capacityKW, setCapacityKW]   = useState(10000)
  const [designPUE, setDesignPUE]     = useState(1.4)
  const [lifetimeYrs, setLifetimeYrs] = useState(15)
  const [discountRate, setDiscountRate] = useState(0.08)
  const [sites, setSites]             = useState<SiteInput[]>(HERO_SITES)
  const [activeTab, setActiveTab]     = useState(0)

  function updateSite(i: number, patch: Partial<SiteInput>) {
    setSites(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  }

  function addSite() {
    if (sites.length >= 4) return
    const newSite = DEFAULT_SITE(sites.length)
    setSites(prev => [...prev, newSite])
    setActiveTab(sites.length)
  }

  function removeSite(i: number) {
    if (sites.length <= 2) return
    setSites(prev => prev.filter((_, idx) => idx !== i))
    setActiveTab(Math.min(activeTab, sites.length - 2))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const cleanedSites = sites.map((s, i) => ({
      ...s,
      site_id: s.site_id.trim() || `site-${String.fromCharCode(65 + i)}`,
      label:   s.label.trim()   || `Site ${String.fromCharCode(65 + i)}`,
    }))
    await onSubmit(cleanedSites, projectName, capacityKW, designPUE, lifetimeYrs, discountRate)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-0">

      {/* ── Header bar ──────────────────────────────────────────────────────── */}
      <div className="bg-ibm-cool-90 text-white px-6 py-4">
        <p className="section-label text-ibm-cool-40 mb-2">Project</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <label className="field-label text-ibm-cool-30">Project name</label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              required
              className="w-full bg-ibm-cool-80 border border-ibm-cool-70 px-3 py-2 text-sm text-white
                         focus:outline-none focus:ring-1 focus:ring-ibm-blue-light placeholder:text-ibm-cool-50"
            />
          </div>
          <div>
            <label className="field-label text-ibm-cool-30">IT Load (kW)</label>
            <input
              type="number" min={100} max={500000} step={500}
              value={capacityKW}
              onChange={e => setCapacityKW(Number(e.target.value))}
              required
              className="w-full bg-ibm-cool-80 border border-ibm-cool-70 px-3 py-2 text-sm text-white
                         focus:outline-none focus:ring-1 focus:ring-ibm-blue-light font-mono"
            />
          </div>
          <div>
            <label className="field-label text-ibm-cool-30">Design PUE</label>
            <input
              type="number" min={1.0} max={3.0} step={0.05}
              value={designPUE}
              onChange={e => setDesignPUE(Number(e.target.value))}
              required
              className="w-full bg-ibm-cool-80 border border-ibm-cool-70 px-3 py-2 text-sm text-white
                         focus:outline-none focus:ring-1 focus:ring-ibm-blue-light font-mono"
            />
          </div>
          <div>
            <label className="field-label text-ibm-cool-30">Analysis horizon (yr)</label>
            <div className="flex gap-2">
              <input
                type="number" min={5} max={40} step={1}
                value={lifetimeYrs}
                onChange={e => setLifetimeYrs(Number(e.target.value))}
                required
                className="w-20 bg-ibm-cool-80 border border-ibm-cool-70 px-3 py-2 text-sm text-white
                           focus:outline-none focus:ring-1 focus:ring-ibm-blue-light font-mono"
              />
              <input
                type="number" min={0.01} max={0.30} step={0.005}
                value={discountRate}
                onChange={e => setDiscountRate(Number(e.target.value))}
                required
                placeholder="WACC"
                title="WACC / discount rate (decimal)"
                className="w-20 bg-ibm-cool-80 border border-ibm-cool-70 px-3 py-2 text-sm text-white
                           focus:outline-none focus:ring-1 focus:ring-ibm-blue-light font-mono"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Site tabs ────────────────────────────────────────────────────────── */}
      <div className="card">
        {/* Tab strip */}
        <div className="flex items-stretch border-b border-ibm-cool-20 overflow-x-auto">
          {sites.map((site, i) => (
            <button
              key={i} type="button"
              onClick={() => setActiveTab(i)}
              className={`px-5 py-3 text-sm font-medium border-r border-ibm-cool-20 shrink-0 transition-colors ${
                activeTab === i
                  ? 'bg-ibm-blue text-white'
                  : 'bg-white text-ibm-cool-70 hover:bg-ibm-cool-10'
              }`}
            >
              <span className="mr-1.5 font-mono text-xs opacity-60">
                {String.fromCharCode(65 + i)}
              </span>
              {site.label.trim() || `Site ${String.fromCharCode(65 + i)}`}
            </button>
          ))}
          {sites.length < 4 && (
            <button
              type="button" onClick={addSite}
              className="px-5 py-3 text-sm text-ibm-blue hover:bg-ibm-cool-10 transition-colors shrink-0 flex items-center gap-1"
            >
              <span className="text-lg leading-none">+</span> Add site
            </button>
          )}
        </div>

        {/* Active site panel */}
        {sites.map((site, i) =>
          i !== activeTab ? null : (
            <div key={i} className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="field-label">Site label</label>
                  <input
                    type="text" value={site.label}
                    onChange={e => updateSite(i, { label: e.target.value })}
                    required placeholder="e.g. Northern Virginia"
                    className="field-input"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="field-label">Region</label>
                  <div className="relative">
                    <select
                      value={site.region_key}
                      onChange={e => {
                        const opt = REGION_OPTIONS.find(r => r.key === e.target.value)
                        updateSite(i, { region_key: e.target.value, label: site.label || (opt?.label ?? '') })
                      }}
                      className="field-select pr-8"
                    >
                      {REGION_OPTIONS.map(r => (
                        <option key={r.key} value={r.key}>{r.label}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ibm-cool-50 text-xs">▼</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="field-label">
                  Free-text description
                  <span className="ml-2 normal-case font-normal text-ibm-cool-40">(optional — AI parses power rate, incentives, land cost…)</span>
                </label>
                <textarea
                  rows={2}
                  value={site.free_text ?? ''}
                  onChange={e => updateSite(i, { free_text: e.target.value })}
                  placeholder="e.g. Greenfield parcel, 40 acres at $75k/acre, power negotiated at $0.041/kWh from APS, state incentive $2.5M, 68% renewable"
                  className="field-input resize-none"
                />
              </div>

              {sites.length > 2 && (
                <button
                  type="button" onClick={() => removeSite(i)}
                  className="mt-3 text-xs text-ibm-red hover:underline"
                >
                  Remove this site
                </button>
              )}
            </div>
          )
        )}
      </div>

      {/* ── Submit ──────────────────────────────────────────────────────────── */}
      <button
        type="submit" disabled={loading}
        className="btn-primary w-full justify-center py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <SpinnerIcon />
            Analyzing {sites.length} candidates…
          </>
        ) : (
          <>Run analysis →</>
        )}
      </button>
    </form>
  )
}

function SpinnerIcon() {
  return (
    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}
