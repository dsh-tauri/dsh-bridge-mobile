import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { CONNECTION_STORAGE_KEY } from '@/config/constants'
import { copy } from '@/config/copy'
import { connection, parseConnectionSnapshot } from './index'

function tokenKey(origin: string): string {
  const encoded = Array.from(origin, character => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')
  return `dsh-bridge.token.${encoded}`
}

export async function restoreConnections(): Promise<void> {
  if (connection.hydrated)
    return
  try {
    const serialized = await AsyncStorage.getItem(CONNECTION_STORAGE_KEY)
    let value: unknown = null
    if (serialized) {
      try {
        value = JSON.parse(serialized)
      }
      catch {
        connection.setNotice(copy.storageFailed)
      }
    }
    const snapshot = parseConnectionSnapshot(value)
    const entries = await Promise.all(snapshot.history.map(async (entry) => {
      try {
        const token = await SecureStore.getItemAsync(tokenKey(entry.id))
        return [entry.id, token] as const
      }
      catch (error) {
        console.error('[connection] token restore failed:', error)
        connection.setNotice(copy.storageFailed)
        return [entry.id, null] as const
      }
    }))
    const tokens: Record<string, string> = {}
    for (const [id, token] of entries) {
      if (token)
        tokens[id] = token
    }
    connection.hydrate(snapshot, tokens)
  }
  catch (error) {
    console.error('[connection] restore failed:', error)
    connection.hydrate({ version: 1, history: [], guidedHosts: [] }, {})
    connection.setNotice(copy.storageFailed)
  }
}

export function bindConnectionPersistence(): () => void {
  let writtenIds = new Set(connection.history.map(entry => entry.id))
  let lastPayload = ''
  let queue = Promise.resolve()
  return connection.$subscribe(() => {
    if (!connection.hydrated)
      return
    const snapshot = connection.serialize()
    const retained = new Set(snapshot.history.map(entry => entry.id))
    if (connection.current)
      retained.add(connection.current.id)
    const tokens = Object.fromEntries(Object.entries(connection.tokens).filter(([id]) => retained.has(id)))
    const snapshotJson = JSON.stringify(snapshot)
    const payload = JSON.stringify({ snapshot, tokens })
    if (payload === lastPayload)
      return
    lastPayload = payload
    queue = queue.then(async () => {
      for (const [id, token] of Object.entries(tokens))
        await SecureStore.setItemAsync(tokenKey(id), token)
      await AsyncStorage.setItem(CONNECTION_STORAGE_KEY, snapshotJson)
      for (const id of writtenIds) {
        if (!retained.has(id))
          await SecureStore.deleteItemAsync(tokenKey(id))
      }
      writtenIds = retained
    }).catch((error) => {
      lastPayload = ''
      console.error('[connection] save failed:', error)
      connection.setNotice(copy.storageFailed)
    })
  })
}
