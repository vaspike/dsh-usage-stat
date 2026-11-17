/**
 * Host half of the usage-stat bundle: folds committed session events into a
 * per-day, per-session, per-route usage ledger, persists every contributing
 * event as one JSONL line, backfills stored history on startup, and serves the
 * ledger to the browser panel as JSON on one authenticated web-server route.
 *
 * Counting model (disjoint request kinds):
 * - steps: one per `step/end` (the loop's step lifecycle authority), attributed
 *   to the route of the step's assembled assistant message.
 * - retries: one per `llm/retry-started` (an attempt actually dispatched).
 * - compactions: one per `compaction/summary` (successful summarize call).
 * - aux: one per `session/title-llm-request` (pre-dispatch title record).
 * Token buckets come from `assistant/message.usage` and `compaction/summary.usage`
 * (disjoint counts: inputTokens excludes cache reads/writes).
 *
 * Dedup: every ledger line carries (sessionId, seq); restarts replay the file,
 * and backfill only applies events past the per-session watermark. Live events
 * of sessions adopted at startup are covered from their adoption seq onward,
 * so backfill stops below that boundary.
 */
import { createLedgerWriter, defaultLedgerFile, loadLedger } from './ledger.js'

const SNAPSHOT_PATH = '/usage-stat/api/snapshot'

const RECORD_FIELDS = [
  'requests', 'steps', 'retries', 'compactions', 'aux',
  'input', 'cacheRead', 'cacheWrite', 'output', 'reasoning',
  'decodeMs', 'ttftMs', 'ttftSteps',
]

/** Local-calendar day key for one epoch-ms timestamp. */
function dayKey(time) {
  const d = new Date(time)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function zeroRecord(day, sessionId, provider, model) {
  const record = { day, sessionId, provider, model }
  for (const field of RECORD_FIELDS) record[field] = 0
  return record
}

/** Per-session fold state: one open step boundary and the last known route. Exported for tests. */
export function newFoldState() {
  return { openStep: null, lastRoute: null, retryProvider: null }
}

function usageDeltas(usage) {
  if (usage === undefined || usage === null) return {}
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0,
    cacheWrite: usage.cacheWriteTokens ?? 0,
    reasoning: usage.reasoningTokens ?? 0,
  }
}

/**
 * First non-empty text/reasoning delta time from the durable embedded stream
 * (current format packs deltas into timed runs; raw chunk records keep `time`).
 */
function streamFirstTokenTime(stream) {
  if (!Array.isArray(stream)) return null
  let first = null
  for (const rec of stream) {
    let t = null
    if (rec.type === 'text-chunks' || rec.type === 'reasoning-chunks') {
      const i = rec.texts.findIndex(x => x.length > 0)
      if (i >= 0) {
        t = rec.time0
        for (let k = 0; k < i; k++) t += rec.dt[k] ?? 0
      }
    } else if (rec.type === 'chunk'
      && (rec.chunk.type === 'text-delta' || rec.chunk.type === 'reasoning-delta')
      && rec.chunk.text.length > 0) {
      t = rec.time
    }
    if (t !== null && (first === null || t < first)) first = t
  }
  return first
}

/**
 * Fold one event into per-session state; return its ledger contribution or
 * null for events that only advance boundaries. Pure with respect to the
 * ledger: the caller applies and persists the returned delta. Exported for tests.
 */
export function foldEvent(state, event) {
  const data = event.data
  const day = dayKey(event.time)
  switch (event.type) {
    case 'step/start':
      state.openStep = {
        turn: data.turn, step: data.step,
        startTime: event.time, route: null, messageSeen: false,
      }
      return null
    case 'assistant/message': {
      const source = data.message.source
      if (source.kind !== 'model') return null
      const route = { provider: source.provider, model: source.model }
      state.lastRoute = route
      const d = usageDeltas(data.usage)
      const open = state.openStep
      if (open !== null && open.turn === data.turn && open.step === data.step && !open.messageSeen) {
        open.messageSeen = true
        open.route = route
        const firstToken = streamFirstTokenTime(data.stream)
        if (firstToken !== null) {
          d.ttftMs = Math.max(0, firstToken - open.startTime)
          d.ttftSteps = 1
          if (data.usage !== undefined && data.usage !== null) {
            d.decodeMs = Math.max(0, event.time - firstToken)
          }
        }
      }
      return { day, ...route, d }
    }
    case 'step/end': {
      const open = state.openStep
      const route = open?.route ?? state.lastRoute ?? { provider: 'unknown', model: 'unknown' }
      state.openStep = null
      return { day, ...route, d: { steps: 1, requests: 1 } }
    }
    case 'llm/retry':
      state.retryProvider = data.provider
      return null
    case 'llm/retry-started': {
      const provider = state.retryProvider ?? 'unknown'
      const model = state.lastRoute !== null && state.lastRoute.provider === provider
        ? state.lastRoute.model : 'unknown'
      state.retryProvider = null
      return { day, provider, model, d: { retries: 1, requests: 1 } }
    }
    case 'compaction/summary':
      return { day, provider: data.provider, model: data.model, d: { compactions: 1, requests: 1, ...usageDeltas(data.usage) } }
    case 'session/title-llm-request':
      return { day, provider: data.route.provider, model: data.route.model, d: { aux: 1, requests: 1 } }
    default:
      return null
  }
}

/**
 * Fold session events into the ledger and serve snapshots.
 * @param ctx - composing plugin context; owns every registration.
 * @param config - row config; optional `dataFile` overrides the ledger path.
 */
export async function apply(ctx, config) {
  const dataFile = typeof config?.dataFile === 'string' && config.dataFile !== ''
    ? config.dataFile : defaultLedgerFile()
  const writer = createLedgerWriter(dataFile)

  /** @type {Map<string, object>} joined day/session/route key -> record */
  const records = new Map()
  /** @type {Map<string, object>} sessionId -> display metadata */
  const sessions = new Map()
  /** @type {Map<string, object>} sessionId -> live fold state */
  const liveState = new Map()
  /** @type {Map<string, number>} sessionId -> highest seq covered by the history channel (ledger load + backfill) */
  const histSeq = new Map()
  /** @type {Map<string, number>} sessionId -> first seq folded live; history backfill stays below it */
  const liveFloor = new Map()

  const adoptMeta = (id, header) => {
    if (header === undefined || sessions.has(id)) return
    sessions.set(id, {
      id,
      title: '',
      cwd: header.cwd ?? '',
      createdAt: header.createdAt,
      lastActive: header.createdAt,
    })
  }

  const record = (day, sessionId, provider, model) => {
    const key = day + '\u0000' + sessionId + '\u0000' + provider + '\u0000' + model
    let rec = records.get(key)
    if (rec === undefined) {
      rec = zeroRecord(day, sessionId, provider, model)
      records.set(key, rec)
    }
    return rec
  }

  const applyContribution = (sessionId, seq, contribution, persist, history) => {
    const { day, provider, model, d } = contribution
    const rec = record(day, sessionId, provider, model)
    for (const [field, delta] of Object.entries(d)) {
      if (RECORD_FIELDS.includes(field)) rec[field] += delta
    }
    if (history) {
      const prev = histSeq.get(sessionId) ?? -1
      if (seq > prev) histSeq.set(sessionId, seq)
    }
    if (persist) {
      // A ledger write failure must not break the live fold; surface it once.
      void writer.append({ sessionId, seq, day, provider, model, d })
        .catch(error => ctx.logger?.warn?.(`usage-stat: ledger append failed: ${error.message}`))
    }
  }

  // Replay the durable ledger before any live event or backfill can apply.
  // History coverage comes from explicit marker lines, so a gap left by a
  // failed backfill heals on the next run instead of being masked by the
  // highest live seq.
  try {
    const loaded = await loadLedger(dataFile, line => {
      applyContribution(line.sessionId, line.seq, line, false, false)
    })
    for (const [id, seq] of loaded.histSeq) histSeq.set(id, seq)
    if (loaded.skipped > 0) ctx.logger?.warn?.(`usage-stat: ignored ${loaded.skipped} unreadable ledger line(s)`)
  } catch (error) {
    ctx.logger?.warn?.(`usage-stat: ledger unreadable, starting empty: ${error.message}`)
  }

  const onEvent = (session, event) => {
    adoptMeta(session.id, session.header)
    const meta = sessions.get(session.id)
    if (meta !== undefined && event.time > meta.lastActive) meta.lastActive = event.time
    if (!liveFloor.has(session.id)) liveFloor.set(session.id, event.seq)
    let state = liveState.get(session.id)
    if (state === undefined) {
      state = newFoldState()
      liveState.set(session.id, state)
    }
    const contribution = foldEvent(state, event)
    if (contribution === null) return
    if (event.seq <= (histSeq.get(session.id) ?? -1)) return
    applyContribution(session.id, event.seq, contribution, true, false)
  }

  const live = ctx.get('sessions')
  if (live !== undefined) {
    for (const session of live.list()) adoptMeta(session.id, session.header)
  }
  ctx.effect(() => ctx.on('session/created', session => adoptMeta(session.id, session.header)))
  ctx.effect(() => ctx.on('session/event', onEvent))
  ctx.effect(() => () => { void writer.flush().catch(() => {}) })

  // Real-time auxiliary usage: purpose-tagged calls bypass the step log.
  // Title requests are already counted by their pre-dispatch log event, so
  // the waterfall only adds their usage; a FAILED compaction attempt has no
  // summary event, so the waterfall counts it whole; other declared purposes
  // (experimental features) count as aux. Loop requests (no purpose) are
  // covered by the log fold and pass through untouched.
  ctx.effect(() => ctx.on('llm/stream', (options, next) => {
    const purpose = options.purpose
    if (purpose === undefined) return next()
    const sid = typeof options.sessionId === 'string' ? options.sessionId : 'unknown'
    const provider = options.provider
    const model = options.model
    const inner = next()
    async function* observe() {
      let usage = null
      let failed = false
      try {
        for await (const chunk of inner) {
          if (chunk.type === 'usage') usage = chunk.usage
          if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) failed = true
          yield chunk
        }
      } finally {
        const d = usageDeltas(usage)
        const hasUsage = Object.values(d).some(v => v > 0)
        let contribution = null
        if (purpose === 'session-title') {
          if (hasUsage) contribution = { day: dayKey(Date.now()), provider, model, d }
        } else if (purpose === 'compaction') {
          if (failed) contribution = { day: dayKey(Date.now()), provider, model, d: { compactions: 1, requests: 1, ...d } }
        } else {
          contribution = { day: dayKey(Date.now()), provider, model, d: { aux: 1, requests: 1, ...d } }
        }
        if (contribution !== null) {
          // Auxiliary lines ride the session's current history seq: they never
          // advance the backfill watermark and replay exactly once.
          applyContribution(sid, histSeq.get(sid) ?? 0, contribution, true, false)
        }
      }
    }
    return observe()
  }))

  const snapshot = () => ({
    generatedAt: Date.now(),
    dataFile,
    providers: (ctx.get('llm')?.listProviders?.() ?? []).map(p => ({ id: p.id, name: p.name })),
    sessions: [...sessions.values()],
    records: [...records.values()],
  })

  ctx.inject(['webServer'], scope => {
    const server = scope.get('webServer')
    if (server === undefined) return
    scope.effect(() => server.register({
      kind: 'exact',
      path: SNAPSHOT_PATH,
      resource: async () => Response.json(snapshot()),
    }))
  })

  // Backfill stored history once the live startup settles. The history
  // channel stops below each session's first live-folded seq (live events
  // cover the rest); sessions with no live events since install replay whole.
  // Live sessions are read through sessionQuery, whose in-memory log may be
  // ahead of the persisted file.
  const backfillSession = async (sid, header, persistence, query, liveNow) => {
    const watermark = liveFloor.get(sid) ?? Infinity
    const from = (histSeq.get(sid) ?? -1) + 1
    if (from >= watermark) return { skipped: 'covered', from, watermark }
    let events
    let handle
    try {
      if (liveNow.has(sid) && query !== undefined) {
        const inspection = await query.readSession(sid)
        events = inspection.events
      } else {
        handle = await persistence.open(sid, 'read')
        const result = await handle.read(0, undefined)
        events = result.events
      }
    } catch (error) {
      return { skipped: 'read-failed', error: String(error && error.message || error) }
    }
    let applied = 0
    let scanned = from - 1
    try {
      adoptMeta(sid, header)
      const state = newFoldState()
      for (const event of events) {
        if (event.seq < from) continue
        if (event.seq >= watermark) break
        scanned = event.seq
        const meta = sessions.get(sid)
        if (meta !== undefined && event.time > meta.lastActive) meta.lastActive = event.time
        const contribution = foldEvent(state, event)
        if (contribution !== null) {
          applyContribution(sid, event.seq, contribution, true, false)
          applied += 1
        }
      }
      if (scanned >= from) {
        // Coverage marker: everything below `scanned` has been folded, even
        // where events produced no contribution.
        histSeq.set(sid, scanned)
        void writer.append({ sessionId: sid, seq: scanned, day: '', provider: '', model: '', d: {}, hist: true })
          .catch(error => ctx.logger?.warn?.(`usage-stat: ledger marker failed: ${error.message}`))
      }
      return { applied, from, watermark, read: events.length }
    } catch (error) {
      return { skipped: 'fold-failed', applied, error: String(error && error.message || error) }
    } finally {
      if (handle !== undefined) await handle.close().catch(() => {})
    }
  }
  ctx.inject(['sessionPersistence'], scope => {
    const persistence = scope.get('sessionPersistence')
    if (persistence === undefined) return
    const runBackfill = async () => {
      let snapshots
      try {
        snapshots = await persistence.list()
      } catch {
        return
      }
      const liveNow = new Set((ctx.get('sessions')?.list() ?? []).map(s => s.id))
      const query = ctx.get('sessionQuery')
      for (const snap of snapshots) {
        if (snap.formatStatus === 'migration-required') continue
        await backfillSession(snap.header.id, snap.header, persistence, query, liveNow)
      }
      void refreshTitles()
    }
    scope.effect(() => {
      const timer = setTimeout(() => { void runBackfill() }, 1500)
      // Second pass heals sessions whose first read failed transiently.
      const retry = setTimeout(() => { void runBackfill() }, 30000)
      return () => { clearTimeout(timer); clearTimeout(retry) }
    })
  })

  // Display titles come from the query service's folded title snapshots;
  // refresh is best-effort and never blocks the ledger. Backfill completion
  // triggers one refresh so newly adopted history sessions get titles too.
  let refreshTitles = async () => {}
  ctx.inject(['sessionQuery'], scope => {
    const query = scope.get('sessionQuery')
    if (query === undefined) return
    refreshTitles = async () => {
      const ids = [...sessions.keys()]
      if (ids.length === 0) return
      try {
        const results = await query.readTitleSnapshots(ids)
        for (const result of results) {
          if (result.status === 'rejected') continue
          const title = result.value?.title?.title
          const meta = sessions.get(result.sessionId)
          if (meta !== undefined && typeof title === 'string' && title !== '') meta.title = title
        }
      } catch (error) {
        // Title refresh is cosmetic; a query failure keeps the previous titles.
        ctx.logger?.warn?.(`usage-stat: title refresh failed: ${error.message}`)
      }
    }
    scope.effect(() => {
      const initial = setTimeout(() => { void refreshTitles() }, 4000)
      const timer = setInterval(() => { void refreshTitles() }, 60000)
      return () => { clearTimeout(initial); clearInterval(timer) }
    })
  })
}