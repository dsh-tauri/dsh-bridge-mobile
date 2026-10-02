import type { BridgeAddress } from '@/utils/bridge-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeBridge, scanCandidates } from './bridge-client'

const address: BridgeAddress = {
  id: 'https://bridge.local:8443',
  url: 'https://bridge.local:8443/workspaces/one?theme=dark',
  host: 'bridge.local',
  port: 8443,
  token: 'not-for-discovery',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
}

function deferredNetwork() {
  const requests: { url: string, signal: AbortSignal, resolve: (response: Response) => void }[] = []
  let inFlight = 0
  let peak = 0
  const fetchMock = vi.fn<typeof fetch>((input, init) => {
    const signal = init?.signal
    if (!signal)
      throw new Error('Expected an abort signal at the network boundary')
    const result = deferred<Response>()
    inFlight++
    peak = Math.max(peak, inFlight)
    let settled = false
    function settle() {
      if (settled)
        return false
      settled = true
      inFlight--
      signal!.removeEventListener('abort', abort)
      return true
    }
    function abort() {
      if (settle())
        result.reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    function resolve(response: Response) {
      if (settle())
        result.resolve(response)
    }
    requests.push({ url: String(input), signal, resolve })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted)
      abort()
    return result.promise
  })
  vi.stubGlobal('fetch', fetchMock)
  function active() {
    return inFlight
  }
  function maximum() {
    return peak
  }
  return { fetchMock, requests, active, maximum }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('probeBridge identity', () => {
  it('accepts the strict bridge auth response and probes only the stable origin without credentials', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ enabled: true, mode: 'token_only', allowLoopback: false, token: 'response-secret' }))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    const removeListener = vi.spyOn(signal, 'removeEventListener')
    expect(await probeBridge(address, signal)).toEqual({ ...address, auth: { enabled: true, mode: 'token_only', allowLoopback: false } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('https://bridge.local:8443/__dsh_bridge__/auth-status', {
      signal: expect.any(AbortSignal),
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
    })
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('requires the literal DSH manifest for a legacy auth response without allowLoopback', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ enabled: false }))
      .mockResolvedValueOnce(jsonResponse({ name: 'DeepSeek Harness', short_name: 'DSH' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await probeBridge(address, new AbortController().signal)).toEqual({ ...address, auth: { enabled: false } })
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      'https://bridge.local:8443/__dsh_bridge__/auth-status',
      'https://bridge.local:8443/manifest.webmanifest',
    ])
    expect(fetchMock.mock.calls[1]?.[1]).toEqual({
      signal: fetchMock.mock.calls[0]?.[1]?.signal,
      headers: { Accept: 'application/manifest+json' },
      cache: 'no-store',
      redirect: 'error',
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    null,
    [],
    {},
    { enabled: 'false', allowLoopback: true },
    { enabled: true, mode: 1, allowLoopback: false },
    { enabled: false, allowLoopback: 'true' },
  ])('rejects malformed auth identity %j before manifest fallback', async (body) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body))
    vi.stubGlobal('fetch', fetchMock)
    expect(await probeBridge(address, new AbortController().signal)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    {},
    { name: 'DeepSeek Harness' },
    { short_name: 'DSH' },
    { name: 'Other app', short_name: 'DSH' },
    { name: 'DeepSeek Harness', short_name: 'OTHER' },
    { name: 'deepseek harness', short_name: 'DSH' },
  ])('does not identify a legacy service with a foreign manifest %j', async (body) => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ enabled: false }))
      .mockResolvedValueOnce(jsonResponse(body))
    vi.stubGlobal('fetch', fetchMock)
    expect(await probeBridge(address, new AbortController().signal)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects an HTTP error rather than interpreting its auth body', async () => {
    const response = jsonResponse({ enabled: false, allowLoopback: true }, 401)
    const json = vi.spyOn(response, 'json')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)
    expect(await probeBridge(address, new AbortController().signal)).toBeNull()
    expect(json).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a failing manifest HTTP status even with a matching identity body', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ enabled: false }))
      .mockResolvedValueOnce(jsonResponse({ name: 'DeepSeek Harness', short_name: 'DSH' }, 404)))
    expect(await probeBridge(address, new AbortController().signal)).toBeNull()
  })

  it('rejects invalid JSON from the auth endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('not JSON')))
    expect(await probeBridge(address, new AbortController().signal)).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects invalid JSON from the legacy manifest endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ enabled: false }))
      .mockResolvedValueOnce(new Response('not JSON')))
    expect(await probeBridge(address, new AbortController().signal)).toBeNull()
  })

  it('handles a rejected network request as an unavailable bridge', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Network unavailable')))
    expect(await probeBridge(address, new AbortController().signal)).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('probeBridge cancellation', () => {
  it('does not fetch or allocate a timer for an already aborted caller', async () => {
    const network = deferredNetwork()
    const caller = new AbortController()
    caller.abort()
    expect(await probeBridge(address, caller.signal)).toBeNull()
    expect(network.fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates caller cancellation to the real request signal', async () => {
    const network = deferredNetwork()
    const caller = new AbortController()
    const pending = probeBridge(address, caller.signal, 500)
    expect(network.requests[0]?.signal.aborted).toBe(false)
    caller.abort()
    expect(await pending).toBeNull()
    expect(network.requests[0]?.signal.aborted).toBe(true)
    expect(network.active()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts at the exact default 600ms timeout', async () => {
    const network = deferredNetwork()
    const pending = probeBridge(address, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(599)
    expect(network.requests[0]?.signal.aborted).toBe(false)
    expect(network.active()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBeNull()
    expect(network.requests[0]?.signal.aborted).toBe(true)
    expect(network.active()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses one timeout budget across auth and manifest requests', async () => {
    const network = deferredNetwork()
    const pending = probeBridge(address, new AbortController().signal, 100)
    await vi.advanceTimersByTimeAsync(60)
    network.requests[0]!.resolve(jsonResponse({ enabled: false }))
    await vi.advanceTimersByTimeAsync(0)
    expect(network.requests.map(request => request.url)).toEqual([
      'https://bridge.local:8443/__dsh_bridge__/auth-status',
      'https://bridge.local:8443/manifest.webmanifest',
    ])
    await vi.advanceTimersByTimeAsync(39)
    expect(network.requests[1]?.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBeNull()
    expect(network.requests[1]?.signal.aborted).toBe(true)
    expect(network.active()).toBe(0)
  })

  it('discards an auth body that finishes parsing after the caller aborts', async () => {
    const body = deferred<unknown>()
    const response = jsonResponse({})
    vi.spyOn(response, 'json').mockReturnValue(body.promise)
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response)
    vi.stubGlobal('fetch', fetchMock)
    const caller = new AbortController()
    const pending = probeBridge(address, caller.signal)
    await vi.advanceTimersByTimeAsync(0)
    caller.abort()
    body.resolve({ enabled: false })
    expect(await pending).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('discards a late successful response even when a network mock ignores abort', async () => {
    const response = deferred<Response>()
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(response.promise)
    vi.stubGlobal('fetch', fetchMock)
    const caller = new AbortController()
    const pending = probeBridge(address, caller.signal)
    caller.abort()
    response.resolve(jsonResponse({ enabled: false, allowLoopback: true }))
    expect(await pending).toBeNull()
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })
})

describe('scanCandidates scheduling', () => {
  it('limits in-flight workers to two and publishes each successful host in completion order', async () => {
    const network = deferredNetwork()
    const onFound = vi.fn()
    const pending = scanCandidates([
      { host: '10.0.0.1', port: 3080 },
      { host: '10.0.0.2', port: 3080 },
      { host: '10.0.0.3', port: 3080 },
      { host: '10.0.0.4', port: 3080 },
      { host: '10.0.0.5', port: 3080 },
    ], { signal: new AbortController().signal, concurrency: 2, timeoutMs: 1000, budgetMs: 5000, onFound })
    expect(network.requests.map(request => request.url)).toEqual([
      'http://10.0.0.1:3080/__dsh_bridge__/auth-status',
      'http://10.0.0.2:3080/__dsh_bridge__/auth-status',
    ])
    expect(network.active()).toBe(2)
    network.requests[1]!.resolve(jsonResponse({ enabled: false, allowLoopback: true }))
    await vi.advanceTimersByTimeAsync(0)
    expect(network.requests).toHaveLength(3)
    expect(onFound.mock.calls.map(call => call[0].id)).toEqual(['http://10.0.0.2:3080'])
    network.requests[0]!.resolve(jsonResponse({ enabled: false, allowLoopback: true }))
    await vi.advanceTimersByTimeAsync(0)
    expect(network.requests).toHaveLength(4)
    network.requests[2]!.resolve(jsonResponse({ enabled: false, allowLoopback: true }))
    await vi.advanceTimersByTimeAsync(0)
    expect(network.requests).toHaveLength(5)
    network.requests[3]!.resolve(jsonResponse({ enabled: false, allowLoopback: true }))
    network.requests[4]!.resolve(jsonResponse({ enabled: false, allowLoopback: true }))
    const found = await pending
    expect(found.map(host => host.id)).toEqual(['http://10.0.0.2:3080', 'http://10.0.0.1:3080', 'http://10.0.0.3:3080', 'http://10.0.0.4:3080', 'http://10.0.0.5:3080'])
    expect(found[0]).toEqual({ id: 'http://10.0.0.2:3080', url: 'http://10.0.0.2:3080/', host: '10.0.0.2', port: 3080, auth: { enabled: false, allowLoopback: true } })
    expect(onFound.mock.calls.map(call => call[0].id)).toEqual(['http://10.0.0.2:3080', 'http://10.0.0.1:3080', 'http://10.0.0.3:3080', 'http://10.0.0.4:3080', 'http://10.0.0.5:3080'])
    expect(network.maximum()).toBe(2)
    expect(network.active()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('enforces the literal default worker limit of forty', async () => {
    const network = deferredNetwork()
    const candidates = Array.from({ length: 41 }, (_, index) => ({ host: `10.0.0.${index + 1}`, port: 3082 }))
    const pending = scanCandidates(candidates, { signal: new AbortController().signal })
    expect(network.requests).toHaveLength(40)
    expect(network.active()).toBe(40)
    for (const request of network.requests.slice())
      request.resolve(jsonResponse({ enabled: false, allowLoopback: true }))
    await vi.advanceTimersByTimeAsync(0)
    expect(network.requests).toHaveLength(41)
    network.requests[40]!.resolve(jsonResponse({ enabled: false, allowLoopback: true }))
    expect(await pending).toHaveLength(41)
    expect(network.maximum()).toBe(40)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('allows a worker to continue after a timed-out candidate', async () => {
    const network = deferredNetwork()
    const pending = scanCandidates([
      { host: '10.0.0.1', port: 3080 },
      { host: '10.0.0.2', port: 3080 },
    ], { signal: new AbortController().signal, concurrency: 1, timeoutMs: 50, budgetMs: 500 })
    await vi.advanceTimersByTimeAsync(49)
    expect(network.requests).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(network.requests[0]?.signal.aborted).toBe(true)
    expect(network.requests[1]?.signal.aborted).toBe(false)
    network.requests[1]!.resolve(jsonResponse({ enabled: false, allowLoopback: true }))
    expect((await pending).map(host => host.id)).toEqual(['http://10.0.0.2:3080'])
    expect(network.maximum()).toBe(1)
  })

  it('aborts all active requests at the scan budget and returns only prior discoveries', async () => {
    const network = deferredNetwork()
    const onFound = vi.fn()
    const pending = scanCandidates([
      { host: '10.0.0.1', port: 3080 },
      { host: '10.0.0.2', port: 3080 },
      { host: '10.0.0.3', port: 3080 },
      { host: '10.0.0.4', port: 3080 },
    ], { signal: new AbortController().signal, concurrency: 2, timeoutMs: 1000, budgetMs: 50, onFound })
    network.requests[0]!.resolve(jsonResponse({ enabled: false, allowLoopback: true }))
    await vi.advanceTimersByTimeAsync(49)
    expect(network.requests).toHaveLength(3)
    expect(network.active()).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect((await pending).map(host => host.id)).toEqual(['http://10.0.0.1:3080'])
    expect(network.requests.slice(1).map(request => request.signal.aborted)).toEqual([true, true])
    expect(network.requests).toHaveLength(3)
    expect(onFound).toHaveBeenCalledTimes(1)
    expect(network.active()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('supports onFound cancelling the actual scan without scheduling further candidates', async () => {
    const network = deferredNetwork()
    const caller = new AbortController()
    const onFound = vi.fn(() => caller.abort())
    const pending = scanCandidates([
      { host: '10.0.0.1', port: 3080 },
      { host: '10.0.0.2', port: 3080 },
      { host: '10.0.0.3', port: 3080 },
    ], { signal: caller.signal, concurrency: 2, onFound })
    network.requests[0]!.resolve(jsonResponse({ enabled: false, allowLoopback: true }))
    expect((await pending).map(host => host.id)).toEqual(['http://10.0.0.1:3080'])
    expect(onFound).toHaveBeenCalledTimes(1)
    expect(network.requests).toHaveLength(2)
    expect(network.requests[1]?.signal.aborted).toBe(true)
    expect(network.active()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('propagates a callback failure while aborting the remaining real worker requests', async () => {
    const network = deferredNetwork()
    const error = new Error('Consumer failed')
    const pending = scanCandidates([
      { host: '10.0.0.1', port: 3080 },
      { host: '10.0.0.2', port: 3080 },
    ], {
      signal: new AbortController().signal,
      concurrency: 2,
      onFound() { throw error },
    })
    const rejection = expect(pending).rejects.toBe(error)
    network.requests[0]!.resolve(jsonResponse({ enabled: false, allowLoopback: true }))
    await rejection
    expect(network.requests[1]?.signal.aborted).toBe(true)
    expect(network.active()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not notify onFound for failed probes or malformed candidates', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ enabled: 'false' }))
    vi.stubGlobal('fetch', fetchMock)
    const onFound = vi.fn()
    expect(await scanCandidates([
      { host: 'bad host', port: 3080 },
      { host: '10.0.0.1', port: 0 },
      { host: '10.0.0.2', port: 65536 },
      { host: '10.0.0.3', port: 3080 },
    ], { signal: new AbortController().signal, concurrency: 256, onFound })).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://10.0.0.3:3080/__dsh_bridge__/auth-status')
    expect(onFound).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not launch work for an empty or already aborted scan', async () => {
    const network = deferredNetwork()
    const caller = new AbortController()
    caller.abort()
    expect(await scanCandidates([{ host: '10.0.0.1', port: 3080 }], { signal: caller.signal })).toEqual([])
    expect(await scanCandidates([], { signal: new AbortController().signal })).toEqual([])
    expect(network.fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([0, -1, 1.5, 257, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid worker concurrency %s', async (concurrency) => {
    const network = deferredNetwork()
    await expect(scanCandidates([], { signal: new AbortController().signal, concurrency })).rejects.toThrow('Scan concurrency must be between 1 and 256')
    expect(network.fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    { timeoutMs: 0 },
    { timeoutMs: -1 },
    { timeoutMs: Number.NaN },
    { timeoutMs: Number.POSITIVE_INFINITY },
    { budgetMs: 0 },
    { budgetMs: -1 },
    { budgetMs: Number.NaN },
    { budgetMs: Number.POSITIVE_INFINITY },
  ])('rejects invalid scan timing options %j', async (options) => {
    const network = deferredNetwork()
    await expect(scanCandidates([], { signal: new AbortController().signal, ...options })).rejects.toThrow('Scan timeouts must be positive')
    expect(network.fetchMock).not.toHaveBeenCalled()
  })
})
