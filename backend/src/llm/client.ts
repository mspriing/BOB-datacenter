/**
 * Thin watsonx.ai REST client.
 *
 * Reads credentials from environment variables:
 *   WATSONX_API_KEY      — IBM Cloud IAM API key
 *   WATSONX_PROJECT_ID   — watsonx.ai project UUID
 *   WATSONX_URL          — regional endpoint (default: us-south)
 *   WATSONX_MODEL        — Granite model ID (default: ibm/granite-3-3-8b-instruct)
 *   WATSONX_TIMEOUT_MS   — per-request timeout in ms (default: 20000)
 *
 * Returns the generated text string, or throws on HTTP error.
 * Does NOT handle caching — callers manage that.
 *
 * Robustness: every HTTP call is bounded by an AbortController timeout and
 * retried once on transient failures (network error, request timeout, HTTP
 * 429, or HTTP 5xx). This keeps a slow or flaky Granite endpoint from hanging
 * the /estimate response — the narrative layer falls back to the deterministic
 * template if the retry is also exhausted.
 */

const DEFAULT_URL     = 'https://us-south.ml.cloud.ibm.com'
const DEFAULT_MODEL   = 'ibm/granite-3-3-8b-instruct'
const IAM_URL         = 'https://iam.cloud.ibm.com/identity/token'
const DEFAULT_TIMEOUT = 20_000
const DEFAULT_RETRIES = 1

let _iamToken: string | null = null
let _iamExpiry = 0

function timeoutMsFromEnv(): number {
  const raw = process.env.WATSONX_TIMEOUT_MS
  const n   = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * fetch() bounded by a timeout and retried on transient failures.
 *
 * A response with a transient status (429 / 5xx) is retried; if the retry
 * budget is exhausted the last response is returned so the caller can surface
 * the status. Network errors and timeouts (AbortError) are retried and then
 * rethrown. 4xx responses (auth / bad request) are returned immediately — they
 * are not transient and retrying would only waste time.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; retries: number },
): Promise<Response> {
  let lastErr: unknown

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
    try {
      const resp = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timer)

      const transient = resp.status === 429 || resp.status >= 500
      if (transient && attempt < opts.retries) {
        await sleep(300 * (attempt + 1))
        continue
      }
      return resp
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      if (attempt < opts.retries) {
        await sleep(300 * (attempt + 1))
        continue
      }
      throw err
    }
  }

  // Unreachable in practice — the loop returns or throws — but satisfies TS.
  throw lastErr ?? new Error('watsonx request failed')
}

/** Exchange an IBM Cloud API key for a short-lived IAM bearer token. */
async function getIAMToken(apiKey: string, timeoutMs: number): Promise<string> {
  const now = Date.now()
  if (_iamToken && now < _iamExpiry) return _iamToken

  const resp = await fetchWithRetry(
    IAM_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
        apikey:     apiKey,
      }),
    },
    { timeoutMs, retries: DEFAULT_RETRIES },
  )
  if (!resp.ok) {
    throw new Error(`IAM token exchange failed: ${resp.status} ${await resp.text()}`)
  }
  const data = await resp.json() as { access_token: string; expires_in: number }
  _iamToken  = data.access_token
  _iamExpiry = now + (data.expires_in - 60) * 1000   // refresh 60s early
  return _iamToken
}

export interface WatsonxConfig {
  apiKey:    string
  projectId: string
  url?:      string
  modelId?:  string
}

export function watsonxConfigFromEnv(): WatsonxConfig | null {
  const apiKey    = process.env.WATSONX_API_KEY
  const projectId = process.env.WATSONX_PROJECT_ID
  if (!apiKey || !projectId) return null
  return {
    apiKey,
    projectId,
    url:     process.env.WATSONX_URL    ?? DEFAULT_URL,
    modelId: process.env.WATSONX_MODEL  ?? DEFAULT_MODEL,
  }
}

export async function watsonxGenerate(
  prompt: string,
  cfg: WatsonxConfig,
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? timeoutMsFromEnv()
  const token = await getIAMToken(cfg.apiKey, timeoutMs)
  const url   = `${cfg.url ?? DEFAULT_URL}/ml/v1/text/generation?version=2023-05-29`

  const body = {
    model_id: cfg.modelId ?? DEFAULT_MODEL,
    input:    prompt,
    parameters: {
      decoding_method: 'greedy',
      max_new_tokens:  opts.maxTokens   ?? 900,
      temperature:     opts.temperature ?? 0,
      stop_sequences:  ['\n\n\n'],
    },
    project_id: cfg.projectId,
  }

  const resp = await fetchWithRetry(
    url,
    {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    },
    { timeoutMs, retries: DEFAULT_RETRIES },
  )

  if (!resp.ok) {
    throw new Error(`watsonx generate failed: ${resp.status} ${await resp.text()}`)
  }

  const data = await resp.json() as {
    results: Array<{ generated_text: string }>
  }
  return data.results[0]?.generated_text?.trim() ?? ''
}

/** Reset cached IAM token — for tests only. */
export function _resetIAMToken(): void {
  _iamToken  = null
  _iamExpiry = 0
}
