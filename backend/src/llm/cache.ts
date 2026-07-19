/**
 * Disk-backed LLM response cache.
 *
 * Key  = SHA-256 of the prompt string (hex).
 * File = .bob/llm-cache/<key>.json
 *
 * The cache directory is created on first use. On cache-miss the caller
 * is responsible for fetching and then calling set().
 *
 * Safe for concurrent reads; writes are synchronous (single-process demo).
 */

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

function cacheDir(): string {
  // Resolve from cwd (project root) so it works both from backend/ and IDE root.
  const dir = resolve(process.cwd(), '.bob', 'llm-cache')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function keyFor(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex')
}

export function cacheGet(prompt: string): string | null {
  const path = resolve(cacheDir(), `${keyFor(prompt)}.json`)
  if (!existsSync(path)) return null
  try {
    const entry = JSON.parse(readFileSync(path, 'utf-8')) as { text: string }
    return entry.text
  } catch {
    return null
  }
}

export function cacheSet(prompt: string, text: string): void {
  const path = resolve(cacheDir(), `${keyFor(prompt)}.json`)
  writeFileSync(path, JSON.stringify({ text, cached_at: new Date().toISOString() }), 'utf-8')
}

export function cacheKey(prompt: string): string {
  return keyFor(prompt)
}
