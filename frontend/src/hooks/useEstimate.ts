import { useState } from 'react'
import type { EstimateInput, EstimateOutput } from '../types/schema.ts'

interface UseEstimateResult {
  data:    EstimateOutput | null
  loading: boolean
  error:   string | null
  submit:  (input: EstimateInput) => Promise<void>
  reset:   () => void
}

export function useEstimate(): UseEstimateResult {
  const [data, setData]       = useState<EstimateOutput | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function submit(input: EstimateInput) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/estimate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const json = await res.json() as EstimateOutput
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setData(null)
    setError(null)
  }

  return { data, loading, error, submit, reset }
}
