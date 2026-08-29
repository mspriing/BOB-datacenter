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
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs'
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

const MAX_CACHE_ENTRIES = 500
const MAX_ENTRY_BYTES = 64 * 1024
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

function pruneCache(dir: string): void {
  const now = Date.now()
  const entries = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const path = resolve(dir, name)
      return { path, mtimeMs: statSync(path).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  for (const [index, entry] of entries.entries()) {
    if (index >= MAX_CACHE_ENTRIES || now - entry.mtimeMs > MAX_AGE_MS) {
      unlinkSync(entry.path)
    }
  }
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
  if (Buffer.byteLength(text, 'utf8') > MAX_ENTRY_BYTES) {
    console.warn('[LLM] cache entry skipped because it exceeds 64 KiB')
    return
  }
  try {
    const dir = cacheDir()
    const path = resolve(dir, `${keyFor(prompt)}.json`)
    writeFileSync(path, JSON.stringify({ text, cached_at: new Date().toISOString() }), 'utf-8')
    pruneCache(dir)
  } catch (err) {
    console.warn('[LLM] cache write failed:', err instanceof Error ? err.message : String(err))
  }
}

export function cacheKey(prompt: string): string {
  return keyFor(prompt)
}
