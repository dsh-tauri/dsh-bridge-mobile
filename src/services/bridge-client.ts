import type { AuthStatus, BridgeAddress } from '@/utils/bridge-protocol'
import type { ScanCandidate } from '@/utils/discovery'
import { AUTH_STATUS_PATH, MANIFEST_PATH, PROBE_TIMEOUT_MS, SCAN_BUDGET_MS, SCAN_CONCURRENCY } from '@/config/constants'
import { isBridgeManifest, parseAuthStatus, parseQrPayload } from '@/utils/bridge-protocol'

export interface BridgeHost extends BridgeAddress {
  auth: AuthStatus
}

export interface ScanOptions {
  signal: AbortSignal
  concurrency?: number
  timeoutMs?: number
  budgetMs?: number
  onFound?: (host: BridgeHost) => void
}

export async function probeBridge(address: BridgeAddress, signal: AbortSignal, timeoutMs = PROBE_TIMEOUT_MS): Promise<BridgeHost | null> {
  if (signal.aborted)
    return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  function abort() {
    controller.abort()
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const response = await fetch(new URL(AUTH_STATUS_PATH, address.id).toString(), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
    })
    if (controller.signal.aborted || !response.ok)
      return null
    const auth = parseAuthStatus(await response.json())
    if (!auth || controller.signal.aborted)
      return null
    if (auth.allowLoopback === undefined) {
      const manifest = await fetch(new URL(MANIFEST_PATH, address.id).toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/manifest+json' },
        cache: 'no-store',
        redirect: 'error',
      })
      if (!manifest.ok || !isBridgeManifest(await manifest.json()) || controller.signal.aborted)
        return null
    }
    return { ...address, auth }
  }
  catch {
    return null
  }
  finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}

export async function scanCandidates(candidates: readonly ScanCandidate[], {
  signal,
  concurrency = SCAN_CONCURRENCY,
  timeoutMs = PROBE_TIMEOUT_MS,
  budgetMs = SCAN_BUDGET_MS,
  onFound,
}: ScanOptions): Promise<BridgeHost[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 256)
    throw new RangeError('Scan concurrency must be between 1 and 256')
  if (!Number.isFinite(budgetMs) || budgetMs <= 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError('Scan timeouts must be positive')
  if (signal.aborted || candidates.length === 0)
    return []
  const controller = new AbortController()
  function abort() {
    controller.abort()
  }
  signal.addEventListener('abort', abort, { once: true })
  const deadline = setTimeout(abort, budgetMs)
  const found: BridgeHost[] = []
  let cursor = 0
  async function worker() {
    while (!controller.signal.aborted && cursor < candidates.length) {
      const candidate = candidates[cursor++]
      if (!candidate)
        break
      const address = parseQrPayload(`http://${candidate.host}:${candidate.port}`)
      if (!address)
        continue
      const result = await probeBridge(address, controller.signal, timeoutMs)
      if (result && !controller.signal.aborted) {
        found.push(result)
        onFound?.(result)
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker))
    return found
  }
  finally {
    clearTimeout(deadline)
    controller.abort()
    signal.removeEventListener('abort', abort)
  }
}
