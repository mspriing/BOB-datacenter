import { useState } from 'react'
import type { SiteInput } from '../types/schema.ts'

// Region options that correspond to keys in data/regions.json
const REGION_OPTIONS = [
  { key: 'us-az-phoenix',    label: 'Phoenix, AZ' },
  { key: 'us-tx-san-antonio',label: 'San Antonio, TX' },
  { key: 'us-va-northern',   label: 'Northern Virginia' },
  { key: 'us-or-portland',   label: 'Portland, OR' },
  { key: 'us-oh-columbus',   label: 'Columbus, OH' },
  { key: 'us-ga-atlanta',    label: 'Atlanta, GA' },
]

const DEFAULT_SITE = (): SiteInput => ({
  site_id:    '',
  label:      '',
  region_key: REGION_OPTIONS[0].key,
  free_text:  '',
})

interface SiteFormProps {
  onSubmit: (sites: SiteInput[], projectName: string, capacityKW: number) => Promise<void>
}

export function SiteForm({ onSubmit }: SiteFormProps) {
  const [projectName, setProjectName] = useState('My Data Center Project')
  const [capacityKW, setCapacityKW]   = useState(10000)
  const [sites, setSites]             = useState<SiteInput[]>([
    { ...DEFAULT_SITE(), site_id: 'site-A', label: 'Phoenix, AZ',   region_key: 'us-az-phoenix' },
    { ...DEFAULT_SITE(), site_id: 'site-B', label: 'Columbus, OH',  region_key: 'us-oh-columbus' },
  ])
  const [activeTab, setActiveTab] = useState(0)

  function updateSite(i: number, patch: Partial<SiteInput>) {
    setSites((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  function addSite() {
    if (sites.length >= 4) return
    const next = String.fromCharCode(65 + sites.length)   // C, D
    setSites((prev) => [
      ...prev,
      { ...DEFAULT_SITE(), site_id: `site-${next}`, label: `Site ${next}` },
    ])
    setActiveTab(sites.length)
  }

  function removeSite(i: number) {
    if (sites.length <= 2) return
    setSites((prev) => prev.filter((_, idx) => idx !== i))
    setActiveTab(Math.min(activeTab, sites.length - 2))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Assign site_id if blank
    const cleanedSites = sites.map((s, i) => ({
      ...s,
      site_id: s.site_id.trim() || `site-${String.fromCharCode(65 + i)}`,
      label:   s.label.trim()   || s.site_id,
    }))

    await onSubmit(cleanedSites, projectName, capacityKW)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── Project settings ───────────────────────────────────────────────── */}
      <div className="border border-gray-300 rounded-md p-4 bg-white">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Project Settings</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Project name</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">IT capacity (kW)</label>
            <input
              type="number"
              min={100}
              max={500000}
              step={100}
              value={capacityKW}
              onChange={(e) => setCapacityKW(Number(e.target.value))}
              required
              className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
            />
          </div>
        </div>
      </div>

      {/* ── Site tabs ──────────────────────────────────────────────────────── */}
      <div className="border border-gray-300 rounded-md bg-white">
        {/* Tab bar */}
        <div className="flex items-center border-b border-gray-300">
          {sites.map((site, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2 text-sm font-medium border-r border-gray-300 transition ${
                activeTab === i
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
              }`}
            >
              {site.label.trim() || `Site ${String.fromCharCode(65 + i)}`}
            </button>
          ))}
          {sites.length < 4 && (
            <button
              type="button"
              onClick={addSite}
              className="px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 transition"
            >
              + Add site
            </button>
          )}
        </div>

        {/* Active site fields */}
        {sites.map((site, i) =>
          i !== activeTab ? null : (
            <div key={i} className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Site label</label>
                  <input
                    type="text"
                    value={site.label}
                    onChange={(e) => updateSite(i, { label: e.target.value })}
                    required
                    placeholder="e.g. Phoenix, AZ"
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Region</label>
                  <select
                    value={site.region_key}
                    onChange={(e) => updateSite(i, { region_key: e.target.value })}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                  >
                    {REGION_OPTIONS.map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Free-text description (optional — AI will extract details)
                </label>
                <textarea
                  rows={2}
                  value={site.free_text ?? ''}
                  onChange={(e) => updateSite(i, { free_text: e.target.value })}
                  placeholder="e.g. Greenfield site near I-10, negotiated power at $0.038/kWh, 40-acre parcel"
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                />
              </div>

              {sites.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeSite(i)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Remove this site
                </button>
              )}
            </div>
          )
        )}
      </div>

      <button
        type="submit"
        className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-semibold rounded-md transition"
      >
        Analyze candidates →
      </button>
    </form>
  )
}
