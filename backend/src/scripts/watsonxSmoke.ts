/**
 * watsonx live smoke test.
 *
 *   npm run watsonx:smoke
 *
 * Loads backend/.env, runs the deterministic engine on the hero-sites fixture,
 * then asks watsonx/Granite to write the narrative for real (cache bypassed).
 * Prints which path actually served the narrative and a snippet of the memo.
 *
 * Exit code 0  → watsonx answered (source = "watsonx"). The live path works.
 * Exit code 1  → fell back to the deterministic template. Read the reason
 *                printed above and check your .env credentials / entitlement.
 *
 * This is the one command to confirm the "built with IBM Bob (watsonx.ai)"
 * requirement is genuinely wired — the app silently uses the offline template
 * whenever credentials are missing or the call fails, so a green UI alone does
 * NOT prove watsonx is in the loop.
 */

import 'dotenv/config'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { runEngine } from '../engine/index.js'
import { watsonxConfigFromEnv } from '../llm/client.js'
import { generateNarrative } from '../llm/narrative.js'
import type { EstimateInput } from '../schemas/input.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadFixture(): EstimateInput {
  const path = resolve(__dirname, '../../tests/fixtures/heroSites.json')
  return JSON.parse(readFileSync(path, 'utf-8')) as EstimateInput
}

async function main(): Promise<void> {
  console.log('── watsonx live smoke test ──────────────────────────────\n')

  const cfg = watsonxConfigFromEnv()
  if (!cfg) {
    console.error('✗ No credentials found.')
    console.error('  WATSONX_API_KEY and WATSONX_PROJECT_ID must be set in backend/.env.')
    console.error('  Copy ../.env.example to backend/.env and fill in your IBM Cloud key + project UUID.')
    process.exit(1)
  }
  console.log(`Endpoint : ${cfg.url}`)
  console.log(`Model    : ${cfg.modelId}`)
  console.log(`Project  : ${cfg.projectId.slice(0, 8)}…`)
  console.log(`API key  : ${cfg.apiKey.slice(0, 4)}…${cfg.apiKey.slice(-2)} (loaded)\n`)

  const input  = loadFixture()
  const labels: Record<string, string> = {}
  for (const s of input.sites) labels[s.site_id] = s.label

  console.log('Running deterministic engine on hero-sites fixture…')
  const output = await runEngine(input, { forceFallback: true, skipCache: true })
  console.log(`  ranked ${output.ranking.length} sites, top = ${labels[output.ranking[0]]}\n`)

  console.log('Calling watsonx/Granite for the narrative (cache bypassed)…\n')
  const started = Date.now()
  const narrative = await generateNarrative(output, labels, { skipCache: true })
  const elapsed = ((Date.now() - started) / 1000).toFixed(1)

  console.log(`Source   : ${narrative.source}   (${elapsed}s)`)
  console.log('Memo     : ' + narrative.recommendation.slice(0, 220).replace(/\s+/g, ' ') + '…\n')

  if (narrative.source === 'watsonx') {
    console.log('✓ PASS — watsonx generated the narrative. The live path is wired.')
    process.exit(0)
  }
  console.error('✗ FAIL — the deterministic template served the narrative, not watsonx.')
  console.error('  A warning printed above (if any) explains why the call was rejected.')
  console.error('  Common causes: wrong region URL, project not associated with a WML')
  console.error('  service instance, model ID not available in your region, or an expired trial.')
  process.exit(1)
}

main().catch((err) => {
  console.error('\n✗ Smoke test threw:', err instanceof Error ? err.message : err)
  process.exit(1)
})
