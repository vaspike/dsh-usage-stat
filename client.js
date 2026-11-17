/**
 * Browser half of the usage-stat bundle: the sidebar "Token usage" entry and
 * the global panel it opens. Data arrives from the Host's authenticated
 * `/usage-stat/api/snapshot` route; all styling consumes --dsw-alias-* tokens
 * so custom themes apply unchanged. Pure aggregation helpers are exposed on
 * the module's `pure` key for workspace-side unit tests.
 */
window.__ModuleLoader__.load({
  id: 'dsh-usage-stat',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useCallback, useRef } = React

    const NS = 'usageStat'
    const PANEL_ID = 'usage-stat'
    const SNAPSHOT_URL = '/usage-stat/api/snapshot'
    const DAY_MS = 864e5
    const REFRESH_MS = 30000

    const zh = {
      panel: '用量统计',
      title: '用量统计',
      refresh: '刷新',
      loading: '正在读取用量数据…',
      error: '读取用量数据失败',
      errorNetwork: '网络异常,无法读取用量数据',
      errorHttp: '服务返回错误(HTTP {code})',
      updatedAt: '更新于 {time}',
      retry: '重试',
      empty: '还没有统计到模型请求,开始一段对话后这里会显示用量',
      noRoutes: '无匹配的模型路由',
      kpiRequests: '请求数',
      kpiInput: '输入 tokens',
      kpiOutput: '输出 tokens',
      kpiTotal: '总 tokens',
      kpiCache: '缓存命中率',
      kpiTps: '平均 TPS',
      subReasoning: '含推理 {n}',
      subShare: '占比 {p}%',
      subHit: '命中 {n}',
      subTtft: 'TTFT 均值 {n}ms',
      breakdown: '{steps} 步 · {retries} 重试 · {compactions} 压缩 · {aux} 辅助',
      subProviders: '{n} 个供应商',
      filterTime: '时间',
      filterProvider: '供应商',
      filterModel: '模型',
      filterSession: '会话',
      rangeToday: '今天',
      rangeYesterday: '昨天',
      range7d: '7 天',
      range30d: '30 天',
      rangeAll: '全部',
      rangeCustom: '自定义',
      allProviders: '全部供应商',
      allModels: '全部模型',
      allSessions: '全部会话',
      pickProvider: '选择供应商',
      pickModel: '选择模型',
      pickSession: '选择会话',
      sessionHint: '不选即全局口径',
      providerHint: '不选即全部供应商',
      modelHint: '不选即全部模型',
      clearSelection: '清空选择',
      remove: '移除',
      to: '至',
      trendTitle: '用量趋势',
      heatHint: '近 {n} 天 · 点击格子查看当天',
      heatHintRange: '近 {n} 天 · 淡化 = 范围外 · 点击格子查看当天',
      window90: '90 天',
      window180: '180 天',
      window365: '365 天',
      heatDays: '一,,三,,五,,日',
      heatMonths: '1月,2月,3月,4月,5月,6月,7月,8月,9月,10月,11月,12月',
      legendLess: '少',
      legendMore: '多',
      routesTitle: '模型统计',
      legendUncached: '未缓存输入',
      legendCacheRead: '缓存命中',
      legendCacheWrite: '缓存写入',
      colRoute: '路由',
      colRequests: '请求',
      colTotal: '总计',
      colInput: '输入',
      colCacheRead: '缓存命中',
      colCacheWrite: '缓存写入',
      colOutput: '输出',
      colCacheRate: '缓存率',
      colTps: 'TPS',
      billedInput: '计费输入合计 {n}',
      reasoningPart: '(推理 {n})',
      footer: '统计折叠自会话日志(步/重试/压缩/标题请求),按本地时区分天;缓存率 = 缓存命中 ÷(未缓存输入 + 缓存命中 + 缓存写入);总 tokens = 输入(含缓存)+ 输出;TPS = 输出 tokens ÷ 解码时长',
      sessionMeta: '{cwd} · 最近活跃 {day} · {n} 请求',
      providerMeta: '{n} 个模型 · {r} 请求',
      modelMeta: '{providers} · {r} 请求',
    }
    const en = {
      panel: 'Usage Stat',
      title: 'Usage Stat',
      refresh: 'Refresh',
      loading: 'Loading usage data…',
      error: 'Failed to load usage data',
      errorNetwork: 'Network error while loading usage data',
      errorHttp: 'Service returned an error (HTTP {code})',
      updatedAt: 'Updated {time}',
      retry: 'Retry',
      empty: 'No model requests recorded yet. Start a conversation and usage will appear here.',
      noRoutes: 'No matching model routes',
      kpiRequests: 'Requests',
      kpiInput: 'Input tokens',
      kpiOutput: 'Output tokens',
      kpiTotal: 'Total tokens',
      kpiCache: 'Cache hit rate',
      kpiTps: 'Avg TPS',
      subReasoning: 'incl. reasoning {n}',
      subShare: 'share {p}%',
      subHit: 'hit {n}',
      subTtft: 'avg TTFT {n}ms',
      breakdown: '{steps} steps · {retries} retries · {compactions} compactions · {aux} aux',
      subProviders: '{n} providers',
      filterTime: 'Time',
      filterProvider: 'Provider',
      filterModel: 'Model',
      filterSession: 'Sessions',
      rangeToday: 'Today',
      rangeYesterday: 'Yesterday',
      range7d: '7 days',
      range30d: '30 days',
      rangeAll: 'All',
      rangeCustom: 'Custom',
      allProviders: 'All providers',
      allModels: 'All models',
      allSessions: 'All sessions',
      pickProvider: 'Pick providers',
      pickModel: 'Pick models',
      pickSession: 'Pick sessions',
      sessionHint: 'No selection means the global scope',
      providerHint: 'No selection means all providers',
      modelHint: 'No selection means all models',
      clearSelection: 'Clear selection',
      remove: 'Remove',
      to: 'to',
      trendTitle: 'Usage trend',
      heatHint: 'Last {n} days · click a cell to view that day',
      heatHintRange: 'Last {n} days · dimmed = out of range · click a cell to view that day',
      window90: '90 days',
      window180: '180 days',
      window365: '365 days',
      heatDays: 'Mon,,Wed,,Fri,,Sun',
      heatMonths: 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec',
      legendLess: 'Less',
      legendMore: 'More',
      routesTitle: 'Model stats',
      legendUncached: 'Uncached input',
      legendCacheRead: 'Cache read',
      legendCacheWrite: 'Cache write',
      colRoute: 'Route',
      colRequests: 'Requests',
      colTotal: 'Total',
      colInput: 'Input',
      colCacheRead: 'Cache read',
      colCacheWrite: 'Cache write',
      colOutput: 'Output',
      colCacheRate: 'Cache rate',
      colTps: 'TPS',
      billedInput: 'billed input total {n}',
      reasoningPart: '(reasoning {n})',
      footer: 'Statistics fold the session log (steps/retries/compactions/title requests), bucketed by local day. Cache rate = cacheRead / (input + cacheRead + cacheWrite); total tokens = input (incl. cache) + output; TPS = output tokens / decode time.',
      sessionMeta: '{cwd} · active {day} · {n} requests',
      providerMeta: '{n} models · {r} requests',
      modelMeta: '{providers} · {r} requests',
    }

    // ---------- Pure helpers (unit-tested via the module's `pure` key) ----------

    const isoOf = time => {
      const d = new Date(time)
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    }
    const isoDate = daysAgo => isoOf(Date.now() - daysAgo * DAY_MS)
    const daysAgoOf = iso => Math.round((new Date(isoOf(Date.now())) - new Date(iso)) / DAY_MS)
    const fmt = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n).toLocaleString('en-US')
    const pct = (a, b) => b > 0 ? (100 * a / b).toFixed(1) : '0.0'
    const dateLabel = iso => { const [, m, d] = iso.split('-'); return Number(m) + '/' + Number(d) }

    const SUM_FIELDS = ['requests', 'steps', 'retries', 'compactions', 'aux', 'input', 'cacheRead', 'cacheWrite', 'output', 'reasoning', 'decodeMs', 'ttftMs', 'ttftSteps']

    function rangeDayList(range, customStart, customEnd, allDays) {
      if (range === 'today') return [isoDate(0)]
      if (range === 'yesterday') return [isoDate(1)]
      if (range === '7d') return Array.from({ length: 7 }, (_, i) => isoDate(i))
      if (range === '30d') return Array.from({ length: 30 }, (_, i) => isoDate(i))
      if (range === 'all') return allDays
      let a = daysAgoOf(customStart), b = daysAgoOf(customEnd)
      if (a < b) [a, b] = [b, a]
      const days = []
      for (let d = Math.max(0, b); d <= a; d++) days.push(isoDate(d))
      return days
    }

    function aggregateRecords(records) {
      const routes = new Map()
      const total = Object.fromEntries(SUM_FIELDS.map(k => [k, 0]))
      for (const r of records) {
        for (const k of SUM_FIELDS) total[k] += r[k] ?? 0
        const key = r.provider + '/' + r.model
        let acc = routes.get(key)
        if (acc === undefined) {
          acc = { provider: r.provider, model: r.model, ...Object.fromEntries(SUM_FIELDS.map(k => [k, 0])) }
          routes.set(key, acc)
        }
        for (const k of SUM_FIELDS) acc[k] += r[k] ?? 0
      }
      const list = [...routes.values()].sort((a, b) => b.requests - a.requests)
      for (const acc of list) acc.tps = acc.decodeMs > 0 ? acc.output / (acc.decodeMs / 1000) : 0
      total.tps = total.decodeMs > 0 ? total.output / (total.decodeMs / 1000) : 0
      total.ttft = total.ttftSteps > 0 ? Math.round(total.ttftMs / total.ttftSteps) : 0
      total.cacheRate = pct(total.cacheRead, total.input + total.cacheRead + total.cacheWrite)
      return { total, list }
    }

    function dayWeights(records, days) {
      const set = new Set(days)
      const weights = new Map()
      for (const r of records) {
        if (!set.has(r.day)) continue
        weights.set(r.day, (weights.get(r.day) ?? 0) + r.input + r.cacheRead + r.output)
      }
      return weights
    }

    const pure = { isoOf, isoDate, daysAgoOf, rangeDayList, aggregateRecords, dayWeights, fmt, pct }

    // ---------- Styles: semantic tokens only ----------

    const CSS = `
.tks-page { height: 100%; overflow-y: auto; padding: clamp(24px, 4vw, 48px); padding-top: calc(clamp(24px, 4vw, 48px) + var(--dsh-frame-top-clearance, 0px)); color: var(--dsw-alias-label-primary); font-size: 14px; }
.tks-inner { max-width: 960px; margin: 0 auto; }
.tks-head { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.tks-head h1 { font-size: 20px; font-weight: 500; margin: 0; letter-spacing: -.01em; }
.tks-spacer { flex: 1; }
.tks-updated { font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.tks-btn { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; padding: 4px 12px; border-radius: var(--dsw-radius-md, 12px); cursor: pointer; }
.tks-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.tks-btn[disabled] { opacity: .6; cursor: default; }
.tks-status { padding: 32px 0; text-align: center; color: var(--dsw-alias-label-tertiary); font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.tks-spinner { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-state-business-primary); animation: tks-spin .8s linear infinite; }
@keyframes tks-spin { to { transform: rotate(360deg); } }
.tks-errbar { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 12px); padding: 6px 12px; margin-bottom: 12px; }
.tks-errbar .diag { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.tks-filters { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-xl, 20px); padding: 12px 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 10px; }
.tks-frow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.tks-flabel { font-size: 12px; color: var(--dsw-alias-label-tertiary); width: 52px; flex: none; }
.tks-seg { display: flex; background: var(--dsw-alias-bg-layer-2); border-radius: var(--dsw-radius-sm, 8px); padding: 2px; gap: 2px; flex-wrap: wrap; }
.tks-seg button { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; padding: 4px 10px; border-radius: var(--dsw-radius-xs, 4px); cursor: pointer; white-space: nowrap; }
.tks-seg button.on { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-weight: 500; }
.tks-seg.small button { padding: 2px 8px; font-size: 11px; }
.tks-dates { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.tks-dates input { font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm, 8px); padding: 3px 8px; color-scheme: light dark; }
.tks-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.tks-ms { position: relative; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; }
.tks-ms-all { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.tks-chip { border: 1px solid var(--dsw-alias-state-business-primary); background: var(--dsw-alias-interactive-bg-hover-accent); color: var(--dsw-alias-state-business-primary); font: inherit; font-size: 12px; padding: 2px 6px 2px 10px; border-radius: 999px; display: inline-flex; align-items: center; gap: 4px; max-width: 220px; }
.tks-chip .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tks-chip .x { border: 0; background: none; color: inherit; cursor: pointer; font-size: 12px; line-height: 1; padding: 2px 4px; border-radius: 50%; opacity: .7; }
.tks-chip .x:hover { opacity: 1; }
.tks-plus { width: 24px; height: 24px; flex: none; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 14px; line-height: 1; display: grid; place-items: center; }
.tks-plus:hover { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-state-business-primary); }
.tks-panel { position: absolute; top: calc(100% + 6px); left: 0; z-index: 20; width: 340px; max-height: 320px; overflow: auto; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 12px); box-shadow: 0 8px 24px rgb(0 0 0 / 12%); padding: 6px; }
.tks-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--dsw-radius-sm, 8px); cursor: pointer; }
.tks-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.tks-item input { accent-color: var(--dsw-alias-state-business-primary); flex: none; }
.tks-item-title { font-size: 13px; color: var(--dsw-alias-label-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tks-item-meta { font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.tks-item-text { min-width: 0; flex: 1; }
.tks-panel-foot { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px 4px; border-top: 1px solid var(--dsw-alias-border-l1); margin-top: 4px; }
.tks-link { border: 0; background: none; color: var(--dsw-alias-state-business-primary); font: inherit; font-size: 12px; cursor: pointer; padding: 2px 4px; }
.tks-kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 16px; }
.tks-kpi { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-xl, 20px); padding: 14px 16px; }
.tks-kpi-label { font-size: 12px; color: var(--dsw-alias-label-secondary); margin-bottom: 6px; }
.tks-kpi-value { font-size: 22px; font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
.tks-kpi-value small { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-secondary); margin-left: 2px; }
.tks-kpi-sub { font-size: 11px; color: var(--dsw-alias-label-tertiary); margin-top: 4px; font-variant-numeric: tabular-nums; }
.tks-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-xl, 20px); padding: 18px 20px; margin-bottom: 16px; }
.tks-card-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.tks-card-head h2 { font-size: 14px; font-weight: 500; margin: 0; }
.tks-legend { display: flex; gap: 14px; margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.tks-legend span { display: inline-flex; align-items: center; gap: 5px; }
.tks-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.tks-empty { padding: 24px 0; text-align: center; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.tks-route { padding: 12px 0; border-top: 1px solid var(--dsw-alias-border-l1); }
.tks-route:first-of-type { border-top: 0; padding-top: 0; }
.tks-route-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.tks-route-name { font-weight: 500; font-size: 13px; }
.tks-provider-tag { font-size: 11px; color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-layer-2); padding: 1px 7px; border-radius: 999px; }
.tks-route-nums { margin-left: auto; display: flex; gap: 16px; font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.tks-route-nums b { color: var(--dsw-alias-label-primary); font-weight: 500; }
.tks-bar { height: 8px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; display: flex; }
.tks-bar i { display: block; height: 100%; }
.tks-bar-meta { display: flex; gap: 14px; margin-top: 6px; font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; flex-wrap: wrap; }
.tks-heat-wrap { container-type: inline-size; }
.tks-heat { padding-top: 2px; overflow-x: auto; --cell: 12px; --gap: 3px; }
.tks-heat-fit { margin: 0 auto; width: fit-content; max-width: 100%; }
.tks-heat-months { position: relative; height: 14px; margin-left: 28px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.tks-heat-months span { position: absolute; top: 0; white-space: nowrap; }
.tks-heat-body { display: flex; gap: 6px; }
.tks-heat-days { display: grid; grid-template-rows: repeat(7, var(--cell)); gap: var(--gap); font-size: 9px; color: var(--dsw-alias-label-tertiary); width: 22px; flex: none; }
.tks-heat-days span { line-height: var(--cell); }
.tks-heat-grid { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, var(--cell)); grid-auto-columns: var(--cell); gap: var(--gap); }
.tks-cell { width: var(--cell); height: var(--cell); border-radius: 3px; background: var(--dsw-alias-bg-layer-2); cursor: pointer; }
.tks-cell.pad { background: transparent; cursor: default; }
.tks-cell.out { opacity: .22; }
.tks-cell:not(.pad):hover { outline: 1px solid var(--dsw-alias-label-tertiary); outline-offset: 1px; }
.tks-cell.l1 { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 28%, var(--dsw-alias-bg-layer-2)); }
.tks-cell.l2 { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 50%, var(--dsw-alias-bg-layer-2)); }
.tks-cell.l3 { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 72%, var(--dsw-alias-bg-layer-2)); }
.tks-cell.l4 { background: var(--dsw-alias-state-success-primary); }
.tks-heat-legend { display: flex; align-items: center; gap: 4px; justify-content: flex-end; margin-top: 8px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.tks-heat-legend .tks-cell { width: 10px; height: 10px; cursor: default; }
.tks-heat-legend .tks-cell:hover { outline: none; }
.tks-good { color: var(--dsw-alias-state-success-primary); }
.tks-footer { font-size: 11px; color: var(--dsw-alias-label-tertiary); line-height: 1.7; }
@media (max-width: 720px) { .tks-kpis { grid-template-columns: repeat(2, 1fr); } .tks-legend { display: none; } .tks-panel { width: min(340px, calc(100vw - 60px)); } }
`

    // ---------- Components ----------

    function Kpi({ label, value, unit, sub, good, title }) {
      return h('div', { className: 'tks-kpi', title },
        h('div', { className: 'tks-kpi-label' }, label),
        h('div', { className: 'tks-kpi-value' + (good ? ' tks-good' : '') }, value, unit ? h('small', null, unit) : null),
        h('div', { className: 'tks-kpi-sub' }, sub),
      )
    }

    function MultiSelect({ items, selected, onToggle, onClear, allLabel, pickLabel, hint, clearLabel, removeLabel }) {
      const [open, setOpen] = useState(false)
      const rootRef = useRef(null)
      useEffect(() => {
        if (!open) return
        const close = e => { if (rootRef.current !== null && !rootRef.current.contains(e.target)) setOpen(false) }
        document.addEventListener('click', close)
        return () => document.removeEventListener('click', close)
      }, [open])
      const sel = items.filter(it => selected.has(it.id))
      return h('div', { className: 'tks-ms', ref: rootRef },
        sel.length === 0
          ? h('span', { className: 'tks-ms-all' }, allLabel)
          : sel.map(it => h('span', { className: 'tks-chip', key: it.id },
              h('span', { className: 't', title: it.title }, it.title),
              h('button', { className: 'x', title: removeLabel, onClick: () => onToggle(it.id) }, '×'),
            )),
        h('button', { className: 'tks-plus', title: pickLabel, onClick: () => setOpen(v => !v) }, '+'),
        open ? h('div', { className: 'tks-panel' },
          items.map(it => h('label', { className: 'tks-item', key: it.id },
            h('input', { type: 'checkbox', checked: selected.has(it.id), onChange: () => onToggle(it.id) }),
            h('span', { className: 'tks-item-text' },
              h('span', { className: 'tks-item-title' }, it.title), h('br'),
              h('span', { className: 'tks-item-meta' }, it.meta),
            ),
          )),
          h('div', { className: 'tks-panel-foot' },
            h('span', { className: 'tks-hint' }, hint),
            h('button', { className: 'tks-link', onClick: onClear }, clearLabel),
          ),
        ) : null,
      )
    }

    function Heatmap({ window: win, weights, activeSet, onPickDay, lessLabel, moreLabel, dayLabels, monthNames }) {
      const today = new Date(isoOf(Date.now()))
      const start = new Date(today.getTime() - (win - 1) * DAY_MS)
      const pad = (start.getDay() + 6) % 7
      const weeks = Math.ceil((pad + win) / 7)
      let max = 1
      for (let d = 0; d < win; d++) max = Math.max(max, weights.get(isoDate(d)) ?? 0)
      const level = w => w <= 0 ? 0 : Math.max(1, Math.ceil(4 * w / max))
      const cells = []
      for (let i = 0; i < pad; i++) cells.push(h('span', { className: 'tks-cell pad', key: 'p' + i }))
      for (let d = win - 1; d >= 0; d--) {
        const iso = isoDate(d)
        const w = weights.get(iso) ?? 0
        cells.push(h('span', {
          key: iso,
          className: 'tks-cell l' + level(w) + (activeSet.has(iso) ? '' : ' out'),
          title: dateLabel(iso) + ' · ' + Math.round(w).toLocaleString('en-US') + ' tokens',
          onClick: () => onPickDay(iso),
        }))
      }
      const months = []
      let lastMonth = -1
      for (let c = 0; c < weeks; c++) {
        const idx = Math.max(0, c * 7 - pad)
        const d = win - 1 - idx
        if (d < 0) continue
        const m = new Date(today.getTime() - d * DAY_MS).getMonth()
        if (m !== lastMonth) {
          months.push(h('span', { key: c, style: { left: `calc(${c} * (var(--cell) + var(--gap)))` } }, monthNames[m]))
          lastMonth = m
        }
      }
      // Cell size adapts to the container width via container-query units:
      // a full year fills the card with 12px cells, short windows grow to 28px.
      const cellExpr = `clamp(12px, calc((100cqw - 28px - (${weeks} - 1) * 3px) / ${weeks}), 28px)`
      return h('div', { className: 'tks-heat-wrap' },
        h('div', { className: 'tks-heat', style: { '--cell': cellExpr } },
          h('div', { className: 'tks-heat-fit' },
            h('div', { className: 'tks-heat-months' }, months),
            h('div', { className: 'tks-heat-body' },
              h('div', { className: 'tks-heat-days' }, dayLabels.map((x, i) => h('span', { key: i }, x))),
              h('div', { className: 'tks-heat-grid' }, cells),
            ),
          ),
          h('div', { className: 'tks-heat-legend' }, lessLabel,
            [0, 1, 2, 3, 4].map(l => h('i', { key: l, className: 'tks-cell l' + l })), moreLabel),
        ))
    }

    function StatsPage({ t, loadSnapshot }) {
      const [data, setData] = useState(null)
      const [status, setStatus] = useState('loading')
      const [errMsg, setErrMsg] = useState('')
      const [busy, setBusy] = useState(false)
      const [refreshErr, setRefreshErr] = useState('')
      const reqRef = useRef(0)
      const dataRef = useRef(null)
      const [range, setRange] = useState('today')
      const [customStart, setCustomStart] = useState(isoDate(6))
      const [customEnd, setCustomEnd] = useState(isoDate(0))
      const [providers, setProviders] = useState(new Set())
      const [models, setModels] = useState(new Set())
      const [sessions, setSessions] = useState(new Set())
      const [heatWindow, setHeatWindow] = useState(365)

      const load = useCallback(() => {
        const req = ++reqRef.current
        setBusy(true)
        loadSnapshot().then(
          value => {
            if (req !== reqRef.current) return
            dataRef.current = value
            setData(value); setStatus('ready'); setRefreshErr(''); setBusy(false)
          },
          error => {
            if (req !== reqRef.current) return
            setBusy(false)
            const raw = String(error && error.message || error)
            const msg = /^HTTP \d+$/.test(raw) ? t('errorHttp', { code: raw.slice(5) }) : t('errorNetwork')
            // A failed refresh keeps the last-good data visible; only the very
            // first load failure gets the full-page error state.
            if (dataRef.current === null) { setStatus('error'); setErrMsg(msg + ' (' + raw + ')') }
            else setRefreshErr(msg)
          },
        )
      }, [loadSnapshot, t])
      useEffect(() => {
        load()
        const timer = setInterval(load, REFRESH_MS)
        return () => clearInterval(timer)
      }, [load])

      const view = useMemo(() => {
        if (data === null) return null
        // Unknown-route rows (steps cancelled before dispatch, retries without
        // model attribution) carry request counts but no usage; keep them in
        // the ledger, hide them from every display surface.
        const records = data.records.filter(r => r.provider !== 'unknown' && r.model !== 'unknown')
        const allDays = [...new Set(records.map(r => r.day))].sort()
        const days = rangeDayList(range, customStart, customEnd, allDays)
        const daySet = new Set(days)
        const routeOn = r => (providers.size === 0 || providers.has(r.provider)) && (models.size === 0 || models.has(r.model))
        const sessionOn = r => sessions.size === 0 || sessions.has(r.sessionId)
        const filtered = records.filter(r => daySet.has(r.day) && routeOn(r) && sessionOn(r))
        const agg = aggregateRecords(filtered)
        const scoped = records.filter(r => routeOn(r) && sessionOn(r))
        const heatDays = Array.from({ length: heatWindow }, (_, i) => isoDate(i))
        const heatW = dayWeights(scoped, heatDays)
        const providerIds = [...new Set([...(data.providers ?? []).map(p => p.id), ...records.map(r => r.provider)])]
        const providerItems = providerIds.map(p => ({
          id: p, title: p,
          meta: t('providerMeta', {
            n: new Set(records.filter(r => r.provider === p).map(r => r.model)).size,
            r: records.filter(r => r.provider === p).reduce((s, r) => s + r.requests, 0).toLocaleString(),
          }),
        }))
        const modelNames = [...new Set(records.map(r => r.model))]
        const modelItems = modelNames.map(m => ({
          id: m, title: m,
          meta: t('modelMeta', {
            providers: [...new Set(records.filter(r => r.model === m).map(r => r.provider))].join(' / '),
            r: records.filter(r => r.model === m).reduce((s, r) => s + r.requests, 0).toLocaleString(),
          }),
        }))
        const sessionItems = [...data.sessions].sort((a, b) => b.lastActive - a.lastActive).map(s => ({
          id: s.id, title: s.title !== '' ? s.title : (s.cwd !== '' ? s.cwd.split('/').pop() : s.id.slice(0, 12)),
          meta: t('sessionMeta', {
            cwd: s.cwd || '—', day: dateLabel(isoOf(s.lastActive)),
            n: records.filter(r => r.sessionId === s.id).reduce((sum, r) => sum + r.requests, 0).toLocaleString(),
          }),
        }))
        return { agg, days, daySet, heatW, providerItems, modelItems, sessionItems }
      }, [data, range, customStart, customEnd, providers, models, sessions, heatWindow, t])

      const toggle = (setter, set) => id => {
        const next = new Set(set)
        next.has(id) ? next.delete(id) : next.add(id)
        setter(next)
      }
      const pickDay = iso => {
        setRange('custom')
        setCustomStart(iso)
        setCustomEnd(iso)
      }

      const children = [h('style', { key: 'css' }, CSS)]
      const updated = data !== null ? new Date(data.generatedAt) : null
      const updatedText = updated !== null
        ? t('updatedAt', { time: String(updated.getHours()).padStart(2, '0') + ':' + String(updated.getMinutes()).padStart(2, '0') + ':' + String(updated.getSeconds()).padStart(2, '0') })
        : ''
      children.push(h('div', { className: 'tks-head', key: 'head' },
        h('h1', null, t('title')),
        h('div', { className: 'tks-spacer' }),
        updatedText !== '' ? h('span', { className: 'tks-updated' }, updatedText) : null,
        h('button', { className: 'tks-btn', onClick: load, disabled: busy, 'aria-busy': busy }, t('refresh')),
      ))
      if (refreshErr !== '') {
        children.push(h('div', { className: 'tks-errbar', key: 'errbar', role: 'alert' },
          h('span', null, refreshErr),
          h('button', { className: 'tks-link', onClick: load }, t('retry')),
        ))
      }

      if (status === 'loading' && data === null) {
        children.push(h('div', { className: 'tks-status', key: 's', 'aria-live': 'polite' },
          h('div', { className: 'tks-spinner' }), t('loading')))
        return h('div', { className: 'tks-page' }, h('div', { className: 'tks-inner' }, children))
      }
      if (status === 'error' && data === null) {
        children.push(h('div', { className: 'tks-status', key: 's', role: 'alert' },
          t('error') + ': ' + errMsg,
          h('button', { className: 'tks-btn', onClick: load }, t('retry')),
        ))
        return h('div', { className: 'tks-page' }, h('div', { className: 'tks-inner' }, children))
      }

      const { agg, days, daySet, heatW, providerItems, modelItems, sessionItems } = view
      const total = agg.total

      // Filter bar
      const rangeButtons = [['today', 'rangeToday'], ['yesterday', 'rangeYesterday'], ['7d', 'range7d'], ['30d', 'range30d'], ['all', 'rangeAll'], ['custom', 'rangeCustom']]
      children.push(h('div', { className: 'tks-filters', key: 'filters' },
        h('div', { className: 'tks-frow' },
          h('span', { className: 'tks-flabel' }, t('filterTime')),
          h('div', { className: 'tks-seg' }, rangeButtons.map(([id, key]) =>
            h('button', { key: id, className: range === id ? 'on' : '', onClick: () => setRange(id) }, t(key)))),
          range === 'custom' ? h('span', { className: 'tks-dates' },
            h('input', { type: 'date', value: customStart, max: isoDate(0), onChange: e => e.target.value && setCustomStart(e.target.value) }),
            t('to'),
            h('input', { type: 'date', value: customEnd, max: isoDate(0), onChange: e => e.target.value && setCustomEnd(e.target.value) }),
          ) : null,
        ),
        h('div', { className: 'tks-frow' },
          h('span', { className: 'tks-flabel' }, t('filterProvider')),
          h(MultiSelect, {
            items: providerItems, selected: providers, onToggle: toggle(setProviders, providers),
            onClear: () => setProviders(new Set()), allLabel: t('allProviders'), pickLabel: t('pickProvider'),
            hint: t('providerHint'), clearLabel: t('clearSelection'), removeLabel: t('remove'),
          }),
        ),
        h('div', { className: 'tks-frow' },
          h('span', { className: 'tks-flabel' }, t('filterModel')),
          h(MultiSelect, {
            items: modelItems, selected: models, onToggle: toggle(setModels, models),
            onClear: () => setModels(new Set()), allLabel: t('allModels'), pickLabel: t('pickModel'),
            hint: t('modelHint'), clearLabel: t('clearSelection'), removeLabel: t('remove'),
          }),
        ),
        h('div', { className: 'tks-frow' },
          h('span', { className: 'tks-flabel' }, t('filterSession')),
          h(MultiSelect, {
            items: sessionItems, selected: sessions, onToggle: toggle(setSessions, sessions),
            onClear: () => setSessions(new Set()), allLabel: t('allSessions'), pickLabel: t('pickSession'),
            hint: t('sessionHint'), clearLabel: t('clearSelection'), removeLabel: t('remove'),
          }),
          h('span', { className: 'tks-hint' }, t('sessionHint')),
        ),
      ))

      if (total.requests === 0) {
        children.push(h('div', { className: 'tks-status', key: 's' }, t('empty')))
        children.push(h('div', { className: 'tks-footer', key: 'f' }, t('footer')))
        return h('div', { className: 'tks-page' }, h('div', { className: 'tks-inner' }, children))
      }

      // KPIs
      const totalTokens = total.input + total.cacheRead + total.cacheWrite + total.output
      const totalInput = total.input + total.cacheRead + total.cacheWrite
      const providerCount = new Set(agg.list.map(r => r.provider)).size
      children.push(h('div', { className: 'tks-kpis', key: 'kpis' },
        h(Kpi, { key: 'req', label: t('kpiRequests'), value: fmt(total.requests), sub: t('subProviders', { n: providerCount }), title: t('breakdown', total) }),
        h(Kpi, { key: 'total', label: t('kpiTotal'), value: fmt(totalTokens), sub: t('subReasoning', { n: fmt(total.reasoning) }) }),
        h(Kpi, { key: 'in', label: t('kpiInput'), value: fmt(totalInput), sub: t('subShare', { p: pct(totalInput, totalTokens) }) }),
        h(Kpi, { key: 'out', label: t('kpiOutput'), value: fmt(total.output), sub: t('subShare', { p: pct(total.output, totalTokens) }) }),
        h(Kpi, { key: 'cache', label: t('kpiCache'), value: total.cacheRate, unit: '%', sub: t('subHit', { n: fmt(total.cacheRead) }), good: true }),
        h(Kpi, { key: 'tps', label: t('kpiTps'), value: total.tps ? total.tps.toFixed(1) : '—', sub: total.ttft > 0 ? t('subTtft', { n: total.ttft }) : '—' }),
      ))

      // Trend card: the heatmap is the only trend form.
      const heatActive = days.length < heatWindow
      children.push(h('div', { className: 'tks-card', key: 'trend' },
        h('div', { className: 'tks-card-head' },
          h('h2', null, t('trendTitle')),
          h('span', { className: 'tks-hint' }, t(heatActive ? 'heatHintRange' : 'heatHint', { n: heatWindow })),
          h('div', { className: 'tks-seg small', style: { marginLeft: 'auto' } },
            [90, 180, 365].map(w => h('button', { key: w, className: heatWindow === w ? 'on' : '', onClick: () => setHeatWindow(w) }, t('window' + w))),
          ),
        ),
        h(Heatmap, { window: heatWindow, weights: heatW, activeSet: daySet, onPickDay: pickDay, lessLabel: t('legendLess'), moreLabel: t('legendMore'), dayLabels: t('heatDays').split(','), monthNames: t('heatMonths').split(',') }),
      ))

      // Routes card
      children.push(h('div', { className: 'tks-card', key: 'routes' },
        h('div', { className: 'tks-card-head' },
          h('h2', null, t('routesTitle')),
          h('div', { className: 'tks-legend' },
            h('span', null, h('i', { className: 'tks-dot', style: { background: 'var(--dsw-alias-state-business-primary)' } }), t('legendUncached')),
            h('span', null, h('i', { className: 'tks-dot', style: { background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, var(--dsw-alias-bg-layer-1))' } }), t('legendCacheRead')),
            h('span', null, h('i', { className: 'tks-dot', style: { background: 'var(--dsw-alias-state-done-primary)' } }), t('legendCacheWrite')),
          ),
        ),
        agg.list.length === 0 ? h('div', { className: 'tks-empty' }, t('noRoutes')) : agg.list.map(r => {
          const prompt = r.input + r.cacheRead + r.cacheWrite
          const w = v => prompt > 0 ? (100 * v / prompt).toFixed(2) + '%' : '0%'
          return h('div', { className: 'tks-route', key: r.provider + '/' + r.model },
            h('div', { className: 'tks-route-top' },
              h('span', { className: 'tks-route-name' }, r.model),
              h('span', { className: 'tks-provider-tag' }, r.provider),
              h('div', { className: 'tks-route-nums' },
                h('span', null, t('colRequests'), ' ', h('b', null, r.requests.toLocaleString())),
                h('span', null, t('colTotal'), ' ', h('b', null, fmt(prompt + r.output))),
                h('span', null, t('colOutput'), ' ', h('b', null, fmt(r.output)),
                  r.reasoning ? h('span', { style: { color: 'var(--dsw-alias-label-tertiary)' } }, ' ' + t('reasoningPart', { n: fmt(r.reasoning) })) : null),
                h('span', null, t('colCacheRate'), ' ', h('b', null, pct(r.cacheRead, prompt) + '%')),
                h('span', null, t('colTps'), ' ', h('b', null, r.tps ? r.tps.toFixed(1) : '—')),
              ),
            ),
            h('div', { className: 'tks-bar', title: t('legendUncached') + ' ' + r.input.toLocaleString() + ' · ' + t('legendCacheRead') + ' ' + r.cacheRead.toLocaleString() + ' · ' + t('legendCacheWrite') + ' ' + r.cacheWrite.toLocaleString() },
              h('i', { style: { width: w(r.input), background: 'var(--dsw-alias-state-business-primary)' } }),
              h('i', { style: { width: w(r.cacheRead), background: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, var(--dsw-alias-bg-layer-1))' } }),
              h('i', { style: { width: w(r.cacheWrite), background: 'var(--dsw-alias-state-done-primary)' } }),
            ),
            h('div', { className: 'tks-bar-meta' },
              h('span', null, t('legendUncached'), ' ', fmt(r.input)),
              h('span', null, t('legendCacheRead'), ' ', fmt(r.cacheRead)),
              h('span', null, t('legendCacheWrite'), ' ', r.cacheWrite ? fmt(r.cacheWrite) : '—'),
              h('span', { style: { marginLeft: 'auto' } }, t('billedInput', { n: fmt(prompt) })),
            ),
          )
        }),
      ))

      children.push(h('div', { className: 'tks-footer', key: 'f' }, t('footer')))
      return h('div', { className: 'tks-page' }, h('div', { className: 'tks-inner' }, children))
    }

    function PanelIcon({ size }) {
      const edge = size ?? 16
      return h('svg', {
        viewBox: '0 0 24 24', width: edge, height: edge,
        'aria-hidden': true, style: { display: 'block' },
      },
        h('rect', { x: 4, y: 13, width: 4, height: 7, rx: 1, fill: 'currentColor', opacity: 0.45 }),
        h('rect', { x: 10, y: 8, width: 4, height: 12, rx: 1, fill: 'currentColor', opacity: 0.7 }),
        h('rect', { x: 16, y: 4, width: 4, height: 16, rx: 1, fill: 'currentColor' }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      pure,
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'usage-stat: dictionaries')
        const t = ctx.locale.bind(NS)
        const loadSnapshot = async () => {
          const response = await fetch(SNAPSHOT_URL, { cache: 'no-store' })
          if (!response.ok) throw new Error('HTTP ' + response.status)
          return response.json()
        }
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
          inject: () => ({ t, loadSnapshot }),
        }, StatsPage))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => t('panel'),
          locale: NS,
        }, PanelIcon))
      },
    }
  },
})