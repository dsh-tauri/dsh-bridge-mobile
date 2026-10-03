import type { ConnectionSnapshot } from './index'
import type { BridgeAddress } from '@/utils/bridge-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConnectionStore, parseConnectionSnapshot } from './index'

const alpha: BridgeAddress = { id: 'http://bridge.local:3080', url: 'http://bridge.local:3080/tasks?theme=dark', host: 'bridge.local', port: 3080 }
const beta: BridgeAddress = { id: 'https://second.local', url: 'https://second.local/workspaces', host: 'second.local', port: 443 }

function load(store: ReturnType<typeof createConnectionStore>, address: BridgeAddress, at: number) {
  expect(store.accept(address)).toBe(true)
  store.markLoaded(store.viewGeneration, at)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('parseConnectionSnapshot trust boundary', () => {
  it.each([null, undefined, [], {}, { version: 2, history: [] }, { version: '1', history: [] }, { version: 1, history: {} }])('discards invalid snapshot envelope %j', (value) => {
    expect(parseConnectionSnapshot(value)).toEqual({ version: 1, history: [], guidedHosts: [] })
  })

  it('reconstructs addresses from URLs, strips secrets and ignores injected metadata and unknown guided origins', () => {
    expect(parseConnectionSnapshot({
      version: 1,
      history: [
        { id: 'https://evil.test', url: 'https://BRIDGE.local:443/tasks?auth=secret&token=other&theme=dark#private', host: 'evil.test', port: 1, token: 'injected', lastConnectedAt: 10 },
        { url: 'http://second.local:3082/route', lastConnectedAt: 20 },
      ],
      tokens: { 'https://bridge.local': 'untrusted' },
      guidedHosts: ['https://bridge.local', 'https://unknown.local', 'https://bridge.local', 7, 'http://second.local:3082/path'],
    })).toEqual({
      version: 1,
      history: [
        { id: 'http://second.local:3082', url: 'http://second.local:3082/route', host: 'second.local', port: 3082, lastConnectedAt: 20 },
        { id: 'https://bridge.local', url: 'https://bridge.local/tasks?theme=dark', host: 'bridge.local', port: 443, lastConnectedAt: 10 },
      ],
      guidedHosts: ['https://bridge.local'],
    })
  })

  it('rejects malformed entries and nonfinite or negative timestamps while retaining timestamp zero', () => {
    expect(parseConnectionSnapshot({
      version: 1,
      history: [
        null,
        [],
        { url: 42, lastConnectedAt: 1 },
        { url: 'http://missing.local', lastConnectedAt: '1' },
        { url: 'ftp://wrong.local', lastConnectedAt: 1 },
        { url: 'http://user:password@unsafe.local', lastConnectedAt: 1 },
        { url: 'http://negative.local', lastConnectedAt: -1 },
        { url: 'http://nan.local', lastConnectedAt: Number.NaN },
        { url: 'http://infinite.local', lastConnectedAt: Number.POSITIVE_INFINITY },
        { url: 'http://zero.local', lastConnectedAt: 0 },
      ],
      guidedHosts: 'http://zero.local',
    })).toEqual({
      version: 1,
      history: [{ id: 'http://zero.local', url: 'http://zero.local/', host: 'zero.local', port: 80, lastConnectedAt: 0 }],
      guidedHosts: [],
    })
  })

  it('deduplicates equivalent default-port origins without merging distinct schemes or ports', () => {
    expect(parseConnectionSnapshot({
      version: 1,
      history: [
        { url: 'http://BRIDGE.local:80/new', lastConnectedAt: 3 },
        { url: 'http://bridge.local/old', lastConnectedAt: 1 },
        { url: 'https://bridge.local/', lastConnectedAt: 2 },
        { url: 'http://bridge.local:3080/', lastConnectedAt: 0 },
      ],
    }).history).toEqual([
      { id: 'http://bridge.local', url: 'http://bridge.local/new', host: 'bridge.local', port: 80, lastConnectedAt: 3 },
      { id: 'https://bridge.local', url: 'https://bridge.local/', host: 'bridge.local', port: 443, lastConnectedAt: 2 },
      { id: 'http://bridge.local:3080', url: 'http://bridge.local:3080/', host: 'bridge.local', port: 3080, lastConnectedAt: 0 },
    ])
  })

  it('retains the newest duplicate origin even when persisted history is unsorted', () => {
    expect(parseConnectionSnapshot({
      version: 1,
      history: [
        { url: 'http://bridge.local:3080/older?auth=old', lastConnectedAt: 1 },
        { url: 'http://bridge.local:3080/newer?token=new', lastConnectedAt: 7 },
      ],
    }).history).toEqual([
      { id: 'http://bridge.local:3080', url: 'http://bridge.local:3080/newer', host: 'bridge.local', port: 3080, lastConnectedAt: 7 },
    ])
  })

  it('sorts and caps persisted history at twenty while pruning guides for evicted origins', () => {
    const history = Array.from({ length: 22 }, (_, index) => ({ url: `http://host-${index + 1}.local:3080/`, lastConnectedAt: index + 1 }))
    const snapshot = parseConnectionSnapshot({ version: 1, history, guidedHosts: ['http://host-1.local:3080', 'http://host-22.local:3080'] })
    expect(snapshot.history).toHaveLength(20)
    expect(snapshot.history.map(entry => entry.lastConnectedAt)).toEqual([22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3])
    expect(snapshot.guidedHosts).toEqual(['http://host-22.local:3080'])
    expect(history).toHaveLength(22)
    expect(history[0]).toEqual({ url: 'http://host-1.local:3080/', lastConnectedAt: 1 })
  })
})

describe('connection hydration', () => {
  it('starts each real store with an isolated empty method-selection state', () => {
    const store = createConnectionStore()
    expect(store.$state).toEqual({
      hydrated: false,
      stage: 'idle',
      current: null,
      history: [],
      tokens: {},
      health: {},
      guidedHosts: [],
      drawerOpen: false,
      swipeHintVisible: false,
      loading: false,
      loadError: null,
      notice: null,
      scanGeneration: 0,
      viewGeneration: 0,
      pendingFocus: null,
      focusGeneration: 0,
    })
    store.setHealth('http://bridge.local:3080', 'unavailable')
    expect(createConnectionStore().health).toEqual({})
  })

  it('hydrates exactly once without opening a connection or replacing later state', () => {
    const store = createConnectionStore()
    const snapshot: ConnectionSnapshot = {
      version: 1,
      history: [{ ...alpha, lastConnectedAt: 10 }],
      guidedHosts: ['http://bridge.local:3080'],
    }
    store.hydrate(snapshot, { 'http://bridge.local:3080': 'secure-secret' })
    store.hydrate({ version: 1, history: [], guidedHosts: [] }, {})
    expect(store.hydrated).toBe(true)
    expect(store.history).toEqual([{ id: 'http://bridge.local:3080', url: 'http://bridge.local:3080/tasks?theme=dark', host: 'bridge.local', port: 3080, lastConnectedAt: 10 }])
    expect(store.guidedHosts).toEqual(['http://bridge.local:3080'])
    expect(store.tokens).toEqual({ 'http://bridge.local:3080': 'secure-secret' })
    expect(store.current).toBeNull()
    expect(store.stage).toBe('idle')
    expect(store.scanGeneration).toBe(0)
    expect(store.viewGeneration).toBe(0)
  })
})

describe('connection scan and view generations', () => {
  it('ignores stale scan results without mutating the active scan', () => {
    const store = createConnectionStore()
    const first = store.beginScan()
    const second = store.beginScan()
    expect(first).toBe(1)
    expect(second).toBe(2)
    expect(store.accept(alpha, first)).toBe(false)
    store.finishScan(first, 'old notice')
    expect(store.stage).toBe('scanning')
    expect(store.current).toBeNull()
    expect(store.notice).toBeNull()
    expect(store.scanGeneration).toBe(2)
    store.finishScan(second, 'No hosts')
    expect(store.stage).toBe('idle')
    expect(store.notice).toBe('No hosts')
  })

  it('cancelScan invalidates pending discoveries and completion notices', () => {
    const store = createConnectionStore()
    const generation = store.beginScan()
    store.cancelScan()
    expect(store.scanGeneration).toBe(2)
    expect(store.stage).toBe('idle')
    expect(store.accept(alpha, generation)).toBe(false)
    store.finishScan(generation, 'stale')
    expect(store.notice).toBeNull()
    expect(store.current).toBeNull()
  })

  it('does not let scan cancellation or stale completion disconnect an accepted host', () => {
    const store = createConnectionStore()
    const generation = store.beginScan()
    expect(store.accept(alpha, generation)).toBe(true)
    expect(store.scanGeneration).toBe(2)
    expect(store.viewGeneration).toBe(2)
    store.finishScan(generation, 'late scan')
    store.cancelScan()
    expect(store.stage).toBe('connected')
    expect(store.current).toEqual(alpha)
    expect(store.notice).toBeNull()
  })

  it('beginScan clears transient view state while retaining successful history and tokens', () => {
    const store = createConnectionStore()
    load(store, { ...alpha, token: 'saved' }, 10)
    store.setDrawerOpen(true)
    store.setNotice('old notice')
    store.markLoadFailed(store.viewGeneration, 'old error')
    expect(store.beginScan()).toBe(2)
    expect(store.viewGeneration).toBe(2)
    expect(store.current).toBeNull()
    expect(store.stage).toBe('scanning')
    expect(store.loading).toBe(false)
    expect(store.loadError).toBeNull()
    expect(store.notice).toBeNull()
    expect(store.drawerOpen).toBe(false)
    expect(store.swipeHintVisible).toBe(false)
    expect(store.history).toEqual([{ ...alpha, lastConnectedAt: 10 }])
    expect(store.tokens).toEqual({ 'http://bridge.local:3080': 'saved' })
  })

  it('ignores stale loaded and failed callbacks after accepting another origin', () => {
    const store = createConnectionStore()
    store.accept(alpha)
    const oldView = store.viewGeneration
    store.accept(beta)
    store.markLoaded(oldView, 100)
    store.markLoadFailed(oldView, 'late failure')
    expect(store.current).toEqual(beta)
    expect(store.loading).toBe(true)
    expect(store.loadError).toBeNull()
    expect(store.history).toEqual([])
    expect(store.health).toEqual({ 'http://bridge.local:3080': 'available', 'https://second.local': 'available' })
    store.markLoaded(store.viewGeneration, 200)
    expect(store.history).toEqual([{ ...beta, lastConnectedAt: 200 }])
  })
})

describe('connection acceptance and successful history', () => {
  it('rejects invalid addresses without storing their token or advancing generations', () => {
    const store = createConnectionStore()
    expect(store.accept({ id: 'https://forged.local', url: 'ftp://bad.local', host: 'forged.local', port: 3080, token: 'secret' })).toBe(false)
    expect(store.current).toBeNull()
    expect(store.tokens).toEqual({})
    expect(store.scanGeneration).toBe(0)
    expect(store.viewGeneration).toBe(0)
  })

  it('normalizes the URL instead of trusting id, host and port supplied by a caller', () => {
    const store = createConnectionStore()
    expect(store.accept({ id: 'https://evil.local', url: 'http://BRIDGE.local:80/tasks?token=url-secret&theme=dark#fragment', host: 'evil.local', port: 9, token: 'explicit-secret' })).toBe(true)
    expect(store.current).toEqual({ id: 'http://bridge.local', url: 'http://bridge.local/tasks?theme=dark', host: 'bridge.local', port: 80, token: 'explicit-secret' })
    expect(store.tokens).toEqual({ 'http://bridge.local': 'explicit-secret' })
    expect(store.history).toEqual([])
    expect(store.health).toEqual({ 'http://bridge.local': 'available' })
  })

  it('reuses a secure token only for the exact normalized origin', () => {
    const store = createConnectionStore()
    store.hydrate({ version: 1, history: [], guidedHosts: [] }, { 'http://bridge.local:3080': 'saved' })
    store.accept(alpha)
    expect(store.current).toEqual({ ...alpha, token: 'saved' })
    store.accept({ ...alpha, id: 'http://bridge.local:3082', url: 'http://bridge.local:3082/tasks', port: 3082 })
    expect(store.current).toEqual({ id: 'http://bridge.local:3082', url: 'http://bridge.local:3082/tasks', host: 'bridge.local', port: 3082 })
    expect(store.tokens).toEqual({ 'http://bridge.local:3080': 'saved' })
  })

  it('remembers a token extracted from the accepted URL even if there was no explicit token field', () => {
    const store = createConnectionStore()
    store.accept({ ...alpha, url: 'http://bridge.local:3080/tasks?auth=fresh&theme=dark' })
    expect(store.current).toEqual({ ...alpha, token: 'fresh' })
    expect(store.tokens).toEqual({ 'http://bridge.local:3080': 'fresh' })
  })

  it('prefers a newly scanned URL token over an older saved token for that origin', () => {
    const store = createConnectionStore()
    store.hydrate({ version: 1, history: [], guidedHosts: [] }, { 'http://bridge.local:3080': 'old' })
    store.accept({ ...alpha, url: 'http://bridge.local:3080/tasks?auth=fresh&theme=dark' })
    expect(store.current).toEqual({ ...alpha, token: 'fresh' })
    expect(store.tokens).toEqual({ 'http://bridge.local:3080': 'fresh' })
  })

  it('records history only after a successful view load', () => {
    const store = createConnectionStore()
    store.accept({ ...alpha, token: 'secret' })
    expect(store.history).toEqual([])
    store.markLoadFailed(store.viewGeneration, 'HTTP 401')
    store.markLoaded(store.viewGeneration, 100)
    expect(store.history).toEqual([])
    expect(store.loadError).toBe('HTTP 401')
    expect(store.health['http://bridge.local:3080']).toBe('unavailable')
    expect(store.loading).toBe(false)
    expect(store.swipeHintVisible).toBe(false)
    load(store, alpha, 200)
    expect(store.history).toEqual([{ ...alpha, lastConnectedAt: 200 }])
    expect(store.loading).toBe(false)
    expect(store.loadError).toBeNull()
  })

  it('does not rewrite history or reopen the dismissed guide on duplicate document readiness', () => {
    const store = createConnectionStore()
    load(store, alpha, 10)
    store.dismissHint()
    store.markLoaded(store.viewGeneration, 20)
    expect(store.history).toEqual([{ ...alpha, lastConnectedAt: 10 }])
    expect(store.guidedHosts).toEqual(['http://bridge.local:3080'])
    expect(store.swipeHintVisible).toBe(false)
    expect(store.loading).toBe(false)
  })

  it('uses the successful load clock rather than the accept time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-02T03:04:05.000Z'))
    const store = createConnectionStore()
    store.accept(alpha)
    vi.setSystemTime(new Date('2024-01-02T03:04:06.000Z'))
    store.markLoaded(store.viewGeneration)
    expect(store.history).toEqual([{ ...alpha, lastConnectedAt: 1704164646000 }])
  })

  it('moves a repeated origin to the front with its latest route instead of duplicating it', () => {
    const store = createConnectionStore()
    load(store, alpha, 1)
    load(store, beta, 2)
    load(store, { ...alpha, url: 'http://bridge.local:3080/new?auth=secret&view=compact' }, 3)
    expect(store.history).toEqual([
      { id: 'http://bridge.local:3080', url: 'http://bridge.local:3080/new?view=compact', host: 'bridge.local', port: 3080, lastConnectedAt: 3 },
      { ...beta, lastConnectedAt: 2 },
    ])
  })

  it('retains twenty successful origins, exposes only five recent entries and prunes evicted guides', () => {
    const store = createConnectionStore()
    for (let index = 1; index <= 21; index++) {
      load(store, { id: `http://host-${index}.local:3080`, url: `http://host-${index}.local:3080/`, host: `host-${index}.local`, port: 3080 }, index)
      if (index === 1 || index === 2)
        store.dismissHint()
    }
    expect(store.history).toHaveLength(20)
    expect(store.history.map(entry => entry.lastConnectedAt)).toEqual([21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
    expect(store.recentFive.map(entry => entry.id)).toEqual(['http://host-21.local:3080', 'http://host-20.local:3080', 'http://host-19.local:3080', 'http://host-18.local:3080', 'http://host-17.local:3080'])
    expect(store.guidedHosts).toEqual(['http://host-2.local:3080'])
    store.recentFive.pop()
    expect(store.history).toHaveLength(20)
    expect(store.recentFive).toHaveLength(5)
  })
})

describe('connection hints, disconnect and serialization', () => {
  it('shows the swipe hint only on successful load until dismissed for that exact origin', () => {
    const store = createConnectionStore()
    store.accept(alpha)
    expect(store.swipeHintVisible).toBe(false)
    store.markLoaded(store.viewGeneration, 1)
    expect(store.swipeHintVisible).toBe(true)
    store.dismissHint()
    store.dismissHint()
    expect(store.guidedHosts).toEqual(['http://bridge.local:3080'])
    expect(store.swipeHintVisible).toBe(false)
    load(store, { ...alpha, url: 'http://bridge.local:3080/another' }, 2)
    expect(store.swipeHintVisible).toBe(false)
    load(store, { ...alpha, id: 'http://bridge.local:3082', url: 'http://bridge.local:3082/', port: 3082 }, 3)
    expect(store.swipeHintVisible).toBe(true)
    expect(store.guidedHosts).toEqual(['http://bridge.local:3080'])
  })

  it('cannot record an unseen guide as dismissed while the first document is loading or failed', () => {
    const store = createConnectionStore()
    store.accept(alpha)
    store.dismissHint()
    expect(store.guidedHosts).toEqual([])
    store.markLoadFailed(store.viewGeneration, 'Network unavailable')
    store.dismissHint()
    expect(store.guidedHosts).toEqual([])
    load(store, alpha, 10)
    expect(store.swipeHintVisible).toBe(true)
    store.dismissHint()
    expect(store.guidedHosts).toEqual(['http://bridge.local:3080'])
    expect(store.swipeHintVisible).toBe(false)
  })

  it('does not record a dismissed hint when no current host exists', () => {
    const store = createConnectionStore()
    store.dismissHint()
    expect(store.guidedHosts).toEqual([])
    expect(store.swipeHintVisible).toBe(false)
  })

  it('disconnect clears transient UI and invalidates callbacks while preserving history, secure tokens and guides', () => {
    const store = createConnectionStore()
    load(store, { ...alpha, token: 'secure-secret' }, 10)
    store.dismissHint()
    store.setDrawerOpen(true)
    store.setNotice('offline')
    store.queueFocus({ origin: 'http://bridge.local:3080', sessionId: 'session-1', title: 'Task', tag: 'task-1' })
    const oldView = store.viewGeneration
    store.disconnect()
    store.markLoaded(oldView, 20)
    store.markLoadFailed(oldView, 'stale')
    expect(store.current).toBeNull()
    expect(store.stage).toBe('scanning')
    expect(store.scanGeneration).toBe(2)
    expect(store.viewGeneration).toBe(2)
    expect(store.loading).toBe(false)
    expect(store.loadError).toBeNull()
    expect(store.notice).toBeNull()
    expect(store.drawerOpen).toBe(false)
    expect(store.swipeHintVisible).toBe(false)
    expect(store.pendingFocus).toBeNull()
    expect(store.history).toEqual([{ ...alpha, lastConnectedAt: 10 }])
    expect(store.tokens).toEqual({ 'http://bridge.local:3080': 'secure-secret' })
    expect(store.guidedHosts).toEqual(['http://bridge.local:3080'])
  })

  it('serializes only sanitized successful history and guides, never runtime state or tokens', () => {
    const store = createConnectionStore()
    load(store, { ...alpha, url: 'http://bridge.local:3080/tasks?auth=secret&token=other&theme=dark#private', token: 'secure-secret' }, 10)
    store.dismissHint()
    store.queueFocus({ origin: 'http://bridge.local:3080', sessionId: 'session-1', title: 'Task', tag: 'task-1' })
    expect(store.serialize()).toEqual({
      version: 1,
      history: [{ id: 'http://bridge.local:3080', url: 'http://bridge.local:3080/tasks?theme=dark', host: 'bridge.local', port: 3080, lastConnectedAt: 10 }],
      guidedHosts: ['http://bridge.local:3080'],
    })
    expect(JSON.stringify(store.serialize())).not.toContain('secret')
    const serialized = store.serialize()
    serialized.history[0]!.url = 'https://mutated.test/'
    serialized.guidedHosts.push('https://mutated.test')
    expect(store.history[0]?.url).toBe('http://bridge.local:3080/tasks?theme=dark')
    expect(store.guidedHosts).toEqual(['http://bridge.local:3080'])
  })
})
