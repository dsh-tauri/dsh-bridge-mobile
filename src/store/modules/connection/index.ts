import type { BridgeAddress } from '@/utils/bridge-protocol'
import { defineStore } from 'valtio-define'
import { HISTORY_LIMIT, RECENT_LIMIT } from '@/config/constants'
import { isRecord, parseQrPayload } from '@/utils/bridge-protocol'

export type ConnectionStage = 'scanning' | 'idle' | 'connected'
export type HostHealth = 'checking' | 'available' | 'unavailable'

export interface HistoryEntry extends Omit<BridgeAddress, 'token'> {
  lastConnectedAt: number
}

export interface NotificationFocus {
  origin: string
  sessionId: string
  title: string
  tag: string
}

export interface ConnectionSnapshot {
  version: 1
  history: HistoryEntry[]
  guidedHosts: string[]
}

export interface ConnectionState {
  hydrated: boolean
  stage: ConnectionStage
  current: BridgeAddress | null
  history: HistoryEntry[]
  tokens: Record<string, string>
  health: Record<string, HostHealth>
  guidedHosts: string[]
  drawerOpen: boolean
  swipeHintVisible: boolean
  loading: boolean
  loadError: string | null
  notice: string | null
  scanGeneration: number
  viewGeneration: number
  pendingFocus: NotificationFocus | null
  focusGeneration: number
}

export function parseConnectionSnapshot(value: unknown): ConnectionSnapshot {
  const snapshot: ConnectionSnapshot = { version: 1, history: [], guidedHosts: [] }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.history))
    return snapshot
  const entries = new Map<string, HistoryEntry>()
  for (const entry of value.history) {
    if (!isRecord(entry) || typeof entry.url !== 'string' || typeof entry.lastConnectedAt !== 'number')
      continue
    if (!Number.isFinite(entry.lastConnectedAt) || entry.lastConnectedAt < 0)
      continue
    const address = parseQrPayload(entry.url)
    if (!address)
      continue
    const previous = entries.get(address.id)
    if (!previous || entry.lastConnectedAt > previous.lastConnectedAt)
      entries.set(address.id, { id: address.id, url: address.url, host: address.host, port: address.port, lastConnectedAt: entry.lastConnectedAt })
  }
  snapshot.history = [...entries.values()].sort((a, b) => b.lastConnectedAt - a.lastConnectedAt)
  snapshot.history = snapshot.history.slice(0, HISTORY_LIMIT)
  const guidedHosts = value.guidedHosts
  if (Array.isArray(guidedHosts))
    snapshot.guidedHosts = snapshot.history.filter(entry => guidedHosts.includes(entry.id)).map(entry => entry.id)
  return snapshot
}

export function createConnectionStore() {
  return defineStore({
    state: (): ConnectionState => ({
      hydrated: false,
      stage: 'scanning',
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
    }),
    getters: {
      recentFive(): HistoryEntry[] {
        return this.history.slice(0, RECENT_LIMIT)
      },
    },
    actions: {
      hydrate(snapshot: ConnectionSnapshot, tokens: Record<string, string>) {
        if (this.hydrated)
          return
        this.history = snapshot.history
        this.guidedHosts = snapshot.guidedHosts
        this.tokens = tokens
        this.hydrated = true
      },
      beginScan(): number {
        this.scanGeneration++
        this.viewGeneration++
        this.current = null
        this.stage = 'scanning'
        this.loading = false
        this.loadError = null
        this.notice = null
        this.drawerOpen = false
        this.swipeHintVisible = false
        return this.scanGeneration
      },
      cancelScan() {
        this.scanGeneration++
        if (this.stage === 'scanning')
          this.stage = 'idle'
      },
      finishScan(generation: number, notice: string) {
        if (generation !== this.scanGeneration || this.stage !== 'scanning')
          return
        this.stage = 'idle'
        this.notice = notice
      },
      accept(address: BridgeAddress, generation?: number): boolean {
        if (generation !== undefined && generation !== this.scanGeneration)
          return false
        const normalized = parseQrPayload(address.url)
        if (!normalized)
          return false
        const token = address.token ?? normalized.token ?? this.tokens[normalized.id]
        if (token) {
          normalized.token = token
          this.tokens[normalized.id] = token
        }
        this.scanGeneration++
        this.current = normalized
        this.stage = 'connected'
        this.loading = true
        this.loadError = null
        this.notice = null
        this.drawerOpen = false
        this.swipeHintVisible = false
        this.health[normalized.id] = 'available'
        this.viewGeneration++
        return true
      },
      markLoaded(generation: number, at = Date.now()) {
        if (!this.current || generation !== this.viewGeneration || this.loadError || !this.loading)
          return
        this.loading = false
        const { id, url, host, port } = this.current
        this.history = [{ id, url, host, port, lastConnectedAt: at }, ...this.history.filter(entry => entry.id !== id)].slice(0, HISTORY_LIMIT)
        const retained = new Set(this.history.map(entry => entry.id))
        this.guidedHosts = this.guidedHosts.filter(origin => retained.has(origin))
        this.swipeHintVisible = !this.guidedHosts.includes(id)
        this.health[id] = 'available'
      },
      markLoadFailed(generation: number, message: string) {
        if (!this.current || generation !== this.viewGeneration)
          return
        this.loading = false
        this.loadError = message
        this.swipeHintVisible = false
        this.health[this.current.id] = 'unavailable'
      },
      dismissHint() {
        if (this.current && !this.guidedHosts.includes(this.current.id))
          this.guidedHosts.push(this.current.id)
        this.swipeHintVisible = false
      },
      setDrawerOpen(open: boolean) {
        this.drawerOpen = open
      },
      setHealth(id: string, health: HostHealth) {
        this.health[id] = health
      },
      setNotice(notice: string | null) {
        this.notice = notice
      },
      queueFocus(focus: NotificationFocus | null) {
        this.pendingFocus = focus
        this.focusGeneration++
      },
      disconnect() {
        this.scanGeneration++
        this.viewGeneration++
        this.current = null
        this.stage = 'scanning'
        this.loading = false
        this.loadError = null
        this.notice = null
        this.drawerOpen = false
        this.swipeHintVisible = false
        this.pendingFocus = null
      },
      serialize(): ConnectionSnapshot {
        return {
          version: 1,
          history: this.history.map(({ id, url, host, port, lastConnectedAt }) => ({ id, url, host, port, lastConnectedAt })),
          guidedHosts: [...this.guidedHosts],
        }
      },
    },
  })
}

export const connection = createConnectionStore()
