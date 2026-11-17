/** Tests for the usage-stat fold, ledger, waterfall, and client helpers. Run: node tests/usage-stat.test.mjs */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { foldEvent, newFoldState } from '../index.js'
import { createLedgerWriter, loadLedger } from '../ledger.js'

const T0 = 1794900000000
const ev = (seq, type, data, dt = 0) => ({ seq, time: T0 + dt, type, data })
const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 900, reasoningTokens: 10 }
const msg = (turn, step, u, stream) => ev(0, 'assistant/message', {
  turn, step, usage: u, stream,
  message: { source: { kind: 'model', provider: 'qwen', model: 'qwen4-max' } },
})

// 1. Normal step: timing from the embedded stream + usage + route attribution.
{
  const state = newFoldState()
  const out = []
  const push = e => { const c = foldEvent(state, e); if (c) out.push(c) }
  push(ev(0, 'step/start', { turn: 1, step: 1 }, 0))
  const stream = [{ type: 'text-chunks', time0: T0 + 800, index: 0, dt: [200, 300], texts: ['hi', ' there', '!'] }]
  push({ ...msg(1, 1, usage, stream), seq: 2, time: T0 + 5800 })
  push(ev(3, 'step/end', { turn: 1, step: 1 }, 5900))
  assert.equal(out.length, 2)
  const message = out[0], end = out[1]
  assert.equal(message.provider, 'qwen')
  assert.equal(message.d.input, 100)
  assert.equal(message.d.cacheRead, 900)
  assert.equal(message.d.ttftMs, 800)
  assert.equal(message.d.decodeMs, 5000)
  assert.equal(message.d.ttftSteps, 1)
  assert.deepEqual(end.d, { steps: 1, requests: 1 })
  assert.equal(end.provider, 'qwen')
  console.log('1. normal step fold OK')
}

// 1b. First-token time skips leading empty deltas; raw chunk records work too.
{
  const state = newFoldState()
  foldEvent(state, ev(0, 'step/start', { turn: 1, step: 1 }, 0))
  const stream = [
    { type: 'reasoning-chunks', time0: T0 + 500, index: 0, dt: [100, 100], texts: ['', '', 'think'] },
    { type: 'chunk', time: T0 + 900, chunk: { type: 'text-delta', index: 0, text: 'x' } },
  ]
  const c = foldEvent(state, { ...msg(1, 1, usage, stream), seq: 1, time: T0 + 2000 })
  assert.equal(c.d.ttftMs, 700) // 500 + 100 + 100 -> first non-empty reasoning delta
  assert.equal(c.d.decodeMs, 1300)
  const state2 = newFoldState()
  foldEvent(state2, ev(0, 'step/start', { turn: 1, step: 1 }, 0))
  const c2 = foldEvent(state2, { ...msg(1, 1, usage, undefined), seq: 1, time: T0 + 2000 })
  assert.equal(c2.d.ttftSteps, undefined) // no stream -> no timing claimed
  console.log('1b. stream timing edges OK')
}

// 2. Retry attribution uses the scheduled provider + last route model.
{
  const state = newFoldState()
  foldEvent(state, msg(1, 1, usage))
  foldEvent(state, ev(4, 'llm/retry', { provider: 'qwen', retryId: 'r', turn: 1, step: 1, retry: 1 }))
  const c = foldEvent(state, ev(5, 'llm/retry-started', { retryId: 'r', turn: 1, step: 1, retry: 1 }))
  assert.deepEqual(c.d, { retries: 1, requests: 1 })
  assert.equal(c.provider, 'qwen')
  assert.equal(c.model, 'qwen4-max')
  console.log('2. retry fold OK')
}

// 3. Compaction and title contributions.
{
  const state = newFoldState()
  const c = foldEvent(state, ev(6, 'compaction/summary', { provider: 'plank', model: 'claude-sonnet-4.5', usage }))
  assert.equal(c.d.compactions, 1)
  assert.equal(c.d.requests, 1)
  assert.equal(c.d.input, 100)
  const t = foldEvent(state, ev(7, 'session/title-llm-request', { route: { provider: 'qwen', model: 'qwen3-max' } }))
  assert.deepEqual(t.d, { aux: 1, requests: 1 })
  console.log('3. compaction/title fold OK')
}

// 4. Cancelled step without a message falls back to unknown route.
{
  const state = newFoldState()
  foldEvent(state, ev(0, 'step/start', { turn: 1, step: 1 }))
  const c = foldEvent(state, ev(1, 'step/end', { turn: 1, step: 1 }))
  assert.equal(c.provider, 'unknown')
  assert.deepEqual(c.d, { steps: 1, requests: 1 })
  console.log('4. cancelled step fold OK')
}

// 5. Ledger roundtrip + seq dedup semantics.
{
  const dir = await mkdtemp(path.join(tmpdir(), 'tks-test-'))
  const file = path.join(dir, 'ledger.jsonl')
  try {
    const writer = createLedgerWriter(file)
    await writer.append({ sessionId: 's1', seq: 2, day: '2026-11-17', provider: 'qwen', model: 'm', d: { input: 100, requests: 1 } })
    await writer.append({ sessionId: 's1', seq: 3, day: '2026-11-17', provider: 'qwen', model: 'm', d: { steps: 1, requests: 1 } })
    await writer.flush()
    const totals = {}
    const loaded = await loadLedger(file, line => {
      for (const [k, v] of Object.entries(line.d)) totals[k] = (totals[k] ?? 0) + v
    })
    assert.deepEqual(totals, { input: 100, requests: 2, steps: 1 })
    assert.equal(loaded.lastSeq.get('s1'), 3)
    assert.equal(loaded.skipped, 0)
    // History markers advance histSeq only, never the fold.
    await writer.append({ sessionId: 's1', seq: 3, day: '', provider: '', model: '', d: {}, hist: true })
    await writer.flush()
    const loaded2 = await loadLedger(file, () => {})
    assert.equal(loaded2.histSeq.get('s1'), 3)
    assert.equal(loaded2.lastSeq.get('s1'), 3)
    const missing = await loadLedger(path.join(dir, 'absent.jsonl'), () => {})
    assert.equal(missing.lastSeq.size, 0)
    console.log('5. ledger roundtrip OK')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
console.log('ALL FOLD/LEDGER TESTS PASSED')
// 6. Client pure helpers via factory capture (logic only, no DOM rendering).
{
  let registration
  globalThis.window = { __ModuleLoader__: { load: reg => { registration = reg } } }
  await import('../client.js')
  const stubReact = { createElement: () => null, useState: () => [], useEffect: () => {}, useMemo: f => f(), useCallback: f => f, useRef: () => ({ current: null }) }
  const mod = registration.factory(name => name === 'react' ? stubReact : {})
  const { rangeDayList, aggregateRecords, dayWeights, isoDate } = mod.pure
  const days7 = rangeDayList('7d', '', '', [])
  assert.equal(days7.length, 7)
  assert.equal(days7[0], isoDate(0))
  const custom = rangeDayList('custom', isoDate(3), isoDate(10), [])
  assert.equal(custom.length, 8) // inverted bounds swap
  const recs = [
    { day: isoDate(0), sessionId: 's1', provider: 'p', model: 'm', requests: 2, steps: 2, retries: 0, compactions: 0, aux: 0, input: 100, cacheRead: 900, cacheWrite: 0, output: 50, reasoning: 0, decodeMs: 1000, ttftMs: 200, ttftSteps: 2 },
    { day: isoDate(1), sessionId: 's1', provider: 'p', model: 'm', requests: 1, steps: 1, retries: 0, compactions: 0, aux: 0, input: 200, cacheRead: 800, cacheWrite: 0, output: 100, reasoning: 0, decodeMs: 2000, ttftMs: 400, ttftSteps: 1 },
  ]
  const agg = aggregateRecords(recs)
  assert.equal(agg.list.length, 1)
  assert.equal(agg.total.requests, 3)
  assert.equal(agg.total.tps, 50) // 150 output / 3s
  assert.equal(agg.total.cacheRate, '85.0') // 1700/2000
  const w = dayWeights(recs, [isoDate(0), isoDate(1)])
  assert.equal(w.get(isoDate(0)), 1050)
  assert.equal(w.get(isoDate(1)), 1100)
  console.log('6. client pure helpers OK')
}
console.log('ALL TESTS PASSED (incl. client helpers)')

// 7. llm/stream waterfall: aux usage semantics per purpose.
{
  const { apply } = await import('../index.js')
  const dir = await mkdtemp(path.join(tmpdir(), 'tks-wf-'))
  const file = path.join(dir, 'ledger.jsonl')
  try {
    const handlers = {}
    const ctx = {
      on: (name, fn) => { handlers[name] = fn; return () => {} },
      effect: fn => fn(),
      get: () => undefined,
      inject: () => {},
      logger: { warn: () => {} },
    }
    await apply(ctx, { dataFile: file })
    const wf = handlers['llm/stream']
    assert.equal(typeof wf, 'function')
    const chunks = u => [
      { type: 'text-delta', index: 0, text: 'x' },
      { type: 'usage', usage: u },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const drain = async iterable => { for await (const c of iterable) { void c } }
    const settle = () => new Promise(r => setTimeout(r, 60))
    const readLines = async () => { await settle(); try { const t = await (await import('node:fs/promises')).readFile(file, 'utf8'); return t.trim().split('\n').filter(Boolean).map(JSON.parse) } catch (e) { if (e.code === 'ENOENT') return []; throw e } }

    // Loop request (no purpose): pass-through, nothing recorded.
    const passthrough = wf({ provider: 'p', model: 'm' }, () => (async function* () { yield* chunks(usage) })())
    await drain(passthrough)
    assert.equal((await readLines()).length, 0)

    // Title: usage only, no request count (the log event counts the request).
    await drain(wf({ purpose: 'session-title', provider: 'p', model: 'm', sessionId: 's9' }, () => (async function* () { yield* chunks(usage) })()))
    let lines = await readLines()
    assert.equal(lines.length, 1)
    assert.equal(lines[0].d.input, 100)
    assert.equal(lines[0].d.requests, undefined)

    // Successful compaction: log covers it, waterfall records nothing.
    await drain(wf({ purpose: 'compaction', provider: 'p', model: 'm', sessionId: 's9' }, () => (async function* () { yield* chunks(usage) })()))
    assert.equal((await readLines()).length, 1)

    // Failed compaction: counted whole.
    const failedChunks = [{ type: 'usage', usage }, { type: 'finish', reason: { kind: 'error', failure: { code: 'X' } } }]
    await drain(wf({ purpose: 'compaction', provider: 'p', model: 'm', sessionId: 's9' }, () => (async function* () { yield* failedChunks })()))
    lines = await readLines()
    assert.equal(lines.length, 2)
    assert.equal(lines[1].d.compactions, 1)
    assert.equal(lines[1].d.requests, 1)

    // Other declared purpose: aux request + usage.
    await drain(wf({ purpose: 'timeline-summary', provider: 'p', model: 'm', sessionId: 's9' }, () => (async function* () { yield* chunks(usage) })()))
    lines = await readLines()
    assert.equal(lines.length, 3)
    assert.equal(lines[2].d.aux, 1)
    console.log('7. llm/stream waterfall OK')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
console.log('ALL TESTS PASSED (incl. waterfall)')

// 8. Client apply(): registration logic with stub services (no DOM rendering).
{
  let registration
  globalThis.window = { __ModuleLoader__: { load: reg => { registration = reg } } }
  // Re-import is cached; capture via a fresh query string.
  const mod0 = await import('../client.js?regtest')
  void mod0
  const stubReact = { createElement: () => null, useState: () => [], useEffect: () => {}, useMemo: f => f(), useCallback: f => f, useRef: () => ({ current: null }) }
  const mod = registration.factory(name => name === 'react' ? stubReact : {})
  const registered = []
  const injections = []
  const ctx = {
    effect: fn => fn(),
    locale: { register: (ns, dicts) => { registered.push(['locale', ns, Object.keys(dicts)]); return () => {} }, bind: ns => key => ns + ':' + key },
    slots: {
      inject: (key, cb) => { injections.push(key); cb() },
      register: (opts, comp) => { registered.push(['slot', opts.name, opts.key ?? opts.id, typeof comp]); return () => {} },
    },
  }
  mod.apply(ctx)
  assert.deepEqual(injections.sort(), ['main', 'sidebar.panellist'])
  const locale = registered.find(r => r[0] === 'locale')
  assert.equal(locale[1], 'usageStat')
  assert.deepEqual(locale[2].sort(), ['en', 'zh'])
  const main = registered.find(r => r[0] === 'slot' && r[1] === 'main')
  assert.equal(main[2], 'usage-stat')
  const entry = registered.find(r => r[0] === 'slot' && r[1] === 'sidebar.panellist')
  assert.equal(entry[2], 'usage-stat')
  assert.equal(mod.inject.includes('slots'), true)
  assert.equal(mod.inject.includes('locale'), true)
  console.log('8. client apply registration OK')
}
console.log('ALL TESTS PASSED (incl. registration)')
