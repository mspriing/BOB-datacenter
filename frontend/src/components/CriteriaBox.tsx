import { useEffect, useRef, useState } from 'react'
import { Sparkles, X, Loader2, AlertTriangle } from 'lucide-react'
import { Card, Chip } from './Primitives'
import {
  parseCriteria,
  type ParcelFilters,
  type ParcelWeights,
  type CriteriaResult,
} from '../lib/parcelApi'
import { usd } from '../lib/format'

/**
 * Describe what you want in a sentence; the parse is shown back before it
 * changes anything.
 *
 * The confirmation step is not politeness. Acting straight on a model's reading
 * of intent means a tool can quietly answer a question nobody asked, and the
 * reader has no way to notice. Parsing changes nothing on screen until Apply.
 */

const FILTER_LABEL: Record<keyof ParcelFilters, (v: number | boolean) => string> = {
  min_acres:              v => `at least ${Number(v).toLocaleString('en-US')} acres`,
  max_acres:              v => `at most ${Number(v).toLocaleString('en-US')} acres`,
  max_land_cost_per_acre: v => `land under ${usd(Number(v))} per acre`,
  max_dist_tx_m:          v => `within ${(Number(v) / 1000).toFixed(1)} km of transmission`,
  exclude_flood:          () => 'no known flood overlap',
}

const WEIGHT_LABEL: Record<keyof ParcelWeights, string> = {
  total_cost: 'cost',
  risk: 'hazard risk',
  sustainability: 'sustainability',
  latency: 'latency',
}

export function CriteriaBox({ onApply }: {
  onApply: (filters: ParcelFilters, weights: ParcelWeights) => void
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CriteriaResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dropped, setDropped] = useState<Set<string>>(new Set())
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => {
    request.current?.abort()
    request.current = null
  }, [])

  const run = async () => {
    if (!text.trim()) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setError(null); setResult(null); setDropped(new Set())
    const r = await parseCriteria(text, controller.signal)
    if (request.current !== controller) return
    request.current = null
    setBusy(false)
    if (r.error || !r.data) { setError(r.error ?? 'No response'); return }
    setResult(r.data)
  }

  const entries = Object.entries(result?.filters ?? {})
    .filter(([k, v]) => v !== undefined && v !== null && !dropped.has(k)) as Array<[keyof ParcelFilters, number | boolean]>
  const weightEntries = Object.entries(result?.weights ?? {})
    .filter(([, value]) => value !== undefined && value !== null) as Array<[keyof ParcelWeights, number]>

  return (
    <Card title="Describe your criteria" note="Optional">
      <div className="space-y-3.5 p-5">
        <label className="block">
          <span className="label-xs mb-1.5 block">What should the parcel match?</span>
          <textarea
            className="field font-normal"
            rows={2}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="At least 200 acres within 3 km of transmission, under $25k per acre, no flood risk." />
        </label>

        <div className="flex items-center gap-3">
          <button className="btn btn-primary" onClick={run} disabled={busy || !text.trim()}>
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden />
                  : <Sparkles size={15} strokeWidth={2.2} aria-hidden />}
            Turn into filters
          </button>
          <span className="text-[13px] text-mid">Review the interpretation before applying it.</span>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 rounded-[11px] border border-line bg-card2 p-3.5">
            <AlertTriangle size={16} strokeWidth={2.2} className="mt-[2px] shrink-0 text-bad" aria-hidden />
            <p className="text-[13.5px] leading-[1.55] text-mid">{error}</p>
          </div>
        )}

        {result && (
          <div className="space-y-3 rounded-[11px] border border-line bg-card2 p-4">
            <p className="label-xs">
              {result.source === 'watsonx'
                ? 'Interpreted by watsonx Granite'
                : 'Matched to the available filters'}
            </p>

            {entries.length === 0 ? (
              weightEntries.length === 0 && (
                <p className="text-[13.5px] leading-[1.55] text-mid">
                  Nothing here could be turned into a filter or ranking preference.
                </p>
              )
            ) : (
              <div className="flex flex-wrap gap-2">
                {entries.map(([k, v]) => (
                  <span key={k}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line
                               bg-card px-2.5 py-1 text-[13px] text-ink2">
                    {FILTER_LABEL[k](v)}
                    <button onClick={() => setDropped(d => new Set(d).add(k))}
                      aria-label={`Remove ${k}`}
                      className="rounded-full p-0.5 text-mid transition-colors hover:text-bad">
                      <X size={12} strokeWidth={2.4} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {weightEntries.length > 0 && (
              <div>
                <p className="mb-2 text-[13px] font-medium text-ink2">Ranking weights</p>
                <div className="flex flex-wrap gap-2">
                  {weightEntries.map(([key, value]) => (
                    <span key={key} className="rounded-full border border-line bg-card px-2.5 py-1 text-[13px] text-ink2">
                      {WEIGHT_LABEL[key]} {Math.round(value * 100)}%
                    </span>
                  ))}
                </div>
              </div>
            )}

            {result.unparsed.length > 0 && (
              <div className="border-t border-[var(--line2)] pt-3">
                <p className="mb-1.5 text-[13px] font-medium text-ink2">
                  Read but left out, since no filter covers it:
                </p>
                <ul className="space-y-1">
                  {result.unparsed.map((u, i) => (
                    <li key={i} className="text-[13px] leading-[1.5] text-mid">
                      <Chip tone="grey">ignored</Chip> <span className="ml-1">{u}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(entries.length > 0 || weightEntries.length > 0) && (
              <button className="btn btn-primary w-full"
                onClick={() => {
                  const f: ParcelFilters = {}
                  for (const [k, v] of entries) (f as Record<string, unknown>)[k] = v
                  onApply(f, result.weights)
                }}>
                Apply filters and ranking
              </button>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
