import { useState } from 'react'
import type { EstimateInput, EstimateOutput } from '../types/schema.ts'
import { API_BASE } from '../config.ts'

interface UseEstimateResult {
  data:        EstimateOutput | null
  loading:     boolean
  slowWarning: boolean
  error:       string | null
  submit:      (input: EstimateInput) => Promise<void>
  reset:       () => void
}

const SLOW_THRESHOLD_MS = 3_000
const TIMEOUT_MS        = 90_000

export function useEstimate(): UseEstimateResult {
  const [data, setData]               = useState<EstimateOutput | null>(null)
  const [loading, setLoading]         = useState(false)
  const [slowWarning, setSlowWarning] = useState(false)
  const [error, setError]             = useState<string | null>(null)

  async function submit(input: EstimateInput) {
    setLoading(true)
    setSlowWarning(false)
    setError(null)

    const controller   = new AbortController()
    const timeoutId    = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const slowTimerId  = setTimeout(() => setSlowWarning(true), SLOW_THRESHOLD_MS)

    try {
      const res = await fetch(`${API_BASE}/api/estimate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(input),
        signal:  controller.signal,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const json = await res.json() as EstimateOutput
      setData(json)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError(
          'The server did not respond in time. It may still be starting up. Try again in a minute.'
        )
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    } finally {
      clearTimeout(timeoutId)
      clearTimeout(slowTimerId)
      setSlowWarning(false)
      setLoading(false)
    }
  }

  function reset() {
    setData(null)
    setError(null)
    setSlowWarning(false)
  }

  return { data, loading, slowWarning, error, submit, reset }
}
