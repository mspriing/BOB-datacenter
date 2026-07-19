/**
 * Thin watsonx.ai REST client.
 *
 * Reads credentials from environment variables:
 *   WATSONX_API_KEY      — IBM Cloud IAM API key
 *   WATSONX_PROJECT_ID   — watsonx.ai project UUID
 *   WATSONX_URL          — regional endpoint (default: us-south)
 *   WATSONX_MODEL        — Granite model ID (default: ibm/granite-13b-instruct-v2)
 *
 * Returns the generated text string, or throws on HTTP error.
 * Does NOT handle caching — callers manage that.
 */

const DEFAULT_URL   = 'https://us-south.ml.cloud.ibm.com'
const DEFAULT_MODEL = 'ibm/granite-13b-instruct-v2'
const IAM_URL       = 'https://iam.cloud.ibm.com/identity/token'

let _iamToken: string | null = null
let _iamExpiry = 0

/** Exchange an IBM Cloud API key for a short-lived IAM bearer token. */
async function getIAMToken(apiKey: string): Promise<string> {
  const now = Date.now()
  if (_iamToken && now < _iamExpiry) return _iamToken

  const resp = await fetch(IAM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
      apikey:     apiKey,
    }),
  })
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
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const token = await getIAMToken(cfg.apiKey)
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

  const resp = await fetch(url, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })

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
