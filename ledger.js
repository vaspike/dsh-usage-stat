/**
 * Durable ledger for the usage-stat fold: one JSONL line per contributing
 * session event, keyed by (sessionId, seq) so restarts and history backfill
 * never double-count. The file lives in the profile's own data area, outside
 * the bundle directory and outside the user's cordis.patch.yml.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const LEDGER_VERSION = 1

/** Default ledger location: the profile directory when known, else ~/.dsh. */
export function defaultLedgerFile() {
  const base = process.env.DSH_PROFILE_DIR || path.join(os.homedir(), '.dsh')
  return path.join(base, 'usage-stat', 'ledger.jsonl')
}

/**
 * Replay persisted ledger lines into the fold.
 * @param file - absolute ledger path; a missing file is an empty ledger.
 * @param applyLine - receives each valid line's {sessionId, seq, day, provider, model, d}.
 * @returns per-session highest applied seq, the history-channel watermark
 *   (from explicit `hist` marker lines only), and the unreadable-line count.
 */
export async function loadLedger(file, applyLine) {
  const lastSeq = new Map()
  const histSeq = new Map()
  let skipped = 0
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { lastSeq, histSeq, skipped }
    throw error
  }
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      skipped += 1
      continue
    }
    if (parsed === null || typeof parsed !== 'object'
      || parsed.v !== LEDGER_VERSION
      || typeof parsed.sessionId !== 'string'
      || !Number.isSafeInteger(parsed.seq) || parsed.seq < 0
      || typeof parsed.day !== 'string'
      || typeof parsed.provider !== 'string' || typeof parsed.model !== 'string'
      || parsed.d === null || typeof parsed.d !== 'object') {
      skipped += 1
      continue
    }
    if (parsed.hist === true) {
      const prev = histSeq.get(parsed.sessionId) ?? -1
      if (parsed.seq > prev) histSeq.set(parsed.sessionId, parsed.seq)
      continue
    }
    applyLine(parsed)
    const prev = lastSeq.get(parsed.sessionId) ?? -1
    if (parsed.seq > prev) lastSeq.set(parsed.sessionId, parsed.seq)
  }
  return { lastSeq, histSeq, skipped }
}

/**
 * Serial append-only writer; every line is durable when its append resolves.
 * @param file - absolute ledger path; the parent directory is created on demand.
 */
export function createLedgerWriter(file) {
  let queue = Promise.resolve()
  let dirReady = false
  const append = line => {
    const run = async () => {
      if (!dirReady) {
        await mkdir(path.dirname(file), { recursive: true })
        dirReady = true
      }
      await appendFile(file, JSON.stringify({ v: LEDGER_VERSION, ...line }) + '\n', 'utf8')
    }
    queue = queue.then(run, run)
    return queue
  }
  return {
    append,
    /** Await every queued append; failures surface to the caller that waits. */
    flush: () => queue,
  }
}