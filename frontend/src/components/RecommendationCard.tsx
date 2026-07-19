import { useState } from 'react'
import type { EstimateOutput } from '../types/schema.ts'

interface RecommendationCardProps {
  output: EstimateOutput
}

export function RecommendationCard({ output }: RecommendationCardProps) {
  const { narrative, flip_sentence } = output
  const [copied, setCopied] = useState(false)

  function copyRecommendation() {
    const text = [
      narrative.recommendation,
      '',
      'Sensitivity:',
      ...narrative.sensitivity_callouts.map(c => `• ${c.label}: ${c.callout}`),
      '',
      `Flip condition: ${flip_sentence}`,
    ].join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const sourceLabel: Record<string, string> = {
    watsonx:  'IBM watsonx · Granite',
    fallback: 'Deterministic template',
    cache:    'Cached · IBM watsonx',
  }

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-ibm-cool-20 px-6 py-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-ibm-cool-90 tracking-wide uppercase">
            Recommendation
          </h3>
          <span className="text-xs text-ibm-cool-50 font-mono bg-ibm-cool-10 px-2 py-0.5 border border-ibm-cool-20">
            {sourceLabel[narrative.source] ?? narrative.source}
          </span>
        </div>
        <button
          onClick={copyRecommendation}
          className="btn-ghost text-xs py-1.5 px-3"
          title="Copy recommendation to clipboard"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>

      {/* Main recommendation */}
      <div className="px-6 py-5">
        <p className="text-sm text-ibm-cool-80 leading-relaxed">
          {narrative.recommendation}
        </p>
      </div>

      {/* Sensitivity callouts */}
      {narrative.sensitivity_callouts.length > 0 && (
        <div className="border-t border-ibm-cool-20 px-6 py-4">
          <p className="section-label mb-3">Cost driver analysis</p>
          <div className="space-y-2">
            {narrative.sensitivity_callouts.map((c, i) => (
              <div key={i} className="flex gap-3 text-sm">
                <span className="shrink-0 font-medium text-ibm-cool-70 w-36 truncate">{c.label}</span>
                <span className="text-ibm-cool-60 leading-relaxed">{c.callout}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Uncertainty flags */}
      {narrative.uncertainty_flags.length > 0 && (
        <div className="border-t border-ibm-yellow/40 bg-ibm-yellow/5 px-6 py-4">
          <p className="section-label text-ibm-orange mb-3">Data uncertainty</p>
          <div className="space-y-1.5">
            {narrative.uncertainty_flags.map((f, i) => (
              <div key={i} className="flex gap-2 text-xs text-ibm-cool-70">
                <span className="text-ibm-orange shrink-0">⚠</span>
                <span><span className="font-mono text-ibm-cool-80">{f.field}</span> — {f.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
