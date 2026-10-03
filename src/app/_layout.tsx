import { router, Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { HeroUINativeProvider } from 'heroui-native/provider'
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { HEALTH_INTERVAL_MS } from '@/config/constants'
import { useNotifications } from '@/hooks/use-notifications'
import { connection } from '@/store/modules/connection'
import { connectAddress, refreshHealth, startAutoScan, stopConnectionRuntime } from '@/store/modules/connection/runtime'
import { bindConnectionPersistence, restoreConnections } from '@/store/modules/connection/storage'
import '../global.css'

export default function RootLayout() {
  useNotifications()
  // keep:effect Own hydration, persistence, cancellable discovery and foreground native subscriptions.
  useEffect(() => {
    let disposed = false
    let unsubscribePersistence = () => {}
    function focusRequested() {
      const focus = connection.pendingFocus
      if (!connection.hydrated || !focus)
        return
      let entry = connection.current
      if (entry?.id !== focus.origin)
        entry = connection.history.find(entry => entry.id === focus.origin) ?? null
      if (!entry) {
        connection.queueFocus(null)
        return
      }
      router.dismissTo('/')
      connection.setDrawerOpen(false)
      if (connection.current?.id !== focus.origin)
        connectAddress(entry)
    }
    const unsubscribeFocus = connection.$subscribeKey('focusGeneration', focusRequested)
    async function initialize() {
      await restoreConnections()
      if (disposed)
        return
      unsubscribePersistence = bindConnectionPersistence()
      focusRequested()
      if (connection.stage === 'idle' && connection.history.length > 0)
        void startAutoScan({ historyOnly: true })
      else
        void refreshHealth()
    }
    void initialize()
    const healthTimer = setInterval(() => {
      if (AppState.currentState === 'active' && connection.hydrated)
        void refreshHealth()
    }, HEALTH_INTERVAL_MS)
    const appSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && connection.hydrated)
        void refreshHealth()
    })
    return () => {
      disposed = true
      clearInterval(healthTimer)
      appSubscription.remove()
      unsubscribeFocus()
      unsubscribePersistence()
      stopConnectionRuntime()
    }
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <HeroUINativeProvider config={{ devInfo: { stylingPrinciples: false } }}>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="scan" options={{ presentation: 'fullScreenModal' }} />
          </Stack>
        </HeroUINativeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
