import type { ShouldStartLoadRequest, WebViewMessageEvent } from 'react-native-webview/lib/WebViewTypes'
import type { NotificationFocus } from '@/store/modules/connection'
import type { BridgeAddress } from '@/utils/bridge-protocol'
import { randomUUID } from 'expo-crypto'
import { useNavigation } from 'expo-router'
import { Button } from 'heroui-native/button'
import { useThemeColor } from 'heroui-native/hooks'
import { useEffect, useRef, useState } from 'react'
import { If, Then } from 'react-if-lite'
import { BackHandler, Linking, Pressable, Text, View } from 'react-native'
import { ArrowLeft, Hand, PanelRightOpen } from 'react-native-lucide'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { useStore } from 'valtio-define'
import { DotsLoader } from '@/components/dots-loader'
import { WEBVIEW_LOAD_TIMEOUT_MS } from '@/config/constants'
import { copy } from '@/config/copy'
import { useAppState } from '@/hooks/use-app-state'
import { requestNotificationAccess, sendNativeNotification } from '@/hooks/use-notifications'
import { connection } from '@/store/modules/connection'
import { connectAddress, refreshHealth } from '@/store/modules/connection/runtime'
import { buildConnectUrl, isTrustedOrigin } from '@/utils/bridge-protocol'
import { createNotificationShim, nativeMessageScript, parseNativeMessage } from '@/utils/webview-bridge'

export function BridgeWebView({ address, generation }: { address: BridgeAddress, generation: number }) {
  const ref = useRef<WebView>(null)
  const [nonce] = useState(randomUUID)
  const mainUrlRef = useRef(buildConnectUrl(address))
  const canGoBackRef = useRef(false)
  const focusRequestRef = useRef<{ requestId: string, focus: NotificationFocus } | null>(null)
  const [documentReady, setDocumentReady] = useState(false)
  const state = useStore(connection)
  const navigation = useNavigation()
  const appState = useAppState()
  const [background, foreground] = useThemeColor(['background', 'foreground'])
  const shim = createNotificationShim(address.id, nonce)
  // keep:effect Mirror native visibility into the authenticated loaded document.
  useEffect(() => {
    if (!documentReady || state.loadError)
      return
    ref.current?.injectJavaScript(nativeMessageScript(address.id, nonce, {
      type: 'dsh://visibility-state',
      hidden: appState !== 'active',
    }))
  }, [address.id, appState, documentReady, nonce, state.loadError])
  // keep:effect Keep notification focus pending until the loaded page acknowledges selection.
  useEffect(() => {
    const focus = state.pendingFocus
    if (!documentReady || state.loadError || focus?.origin !== address.id || appState !== 'active')
      return
    const requestId = randomUUID()
    const webView = ref.current
    focusRequestRef.current = { requestId, focus }
    webView?.injectJavaScript(nativeMessageScript(address.id, nonce, {
      type: 'dsh://focus-session',
      requestId,
      sessionId: focus.sessionId,
      title: focus.title,
      tag: focus.tag,
    }))
    connection.setDrawerOpen(false)
    return () => {
      webView?.injectJavaScript(nativeMessageScript(address.id, nonce, { type: 'dsh://cancel-focus', requestId }))
      if (focusRequestRef.current?.requestId === requestId)
        focusRequestRef.current = null
    }
  }, [address.id, appState, documentReady, nonce, state.loadError, state.pendingFocus, state.focusGeneration])
  // keep:effect Bound a silent or non-DSH WebView load without mistaking Android's finish event for success.
  useEffect(() => {
    if (!state.loading)
      return
    const timeout = setTimeout(() => connection.markLoadFailed(generation, copy.connectionFailed), WEBVIEW_LOAD_TIMEOUT_MS)
    return () => clearTimeout(timeout)
  }, [generation, state.loading])
  // keep:effect Route Android back to WebView history without consuming an open drawer's back event.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused() || connection.drawerOpen || !canGoBackRef.current)
        return false
      ref.current?.goBack()
      return true
    })
    return () => subscription.remove()
  }, [navigation])
  async function openExternal(raw: string) {
    try {
      const url = new URL(raw)
      if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password)
        await Linking.openURL(url.toString())
    }
    catch {
      connection.setNotice(copy.connectionFailed)
    }
  }
  function allowNavigation(request: ShouldStartLoadRequest): boolean {
    if (request.isTopFrame === false)
      return true
    if (isTrustedOrigin(request.url, address.id)) {
      mainUrlRef.current = request.url
      return true
    }
    if (request.url === 'about:blank')
      return true
    void openExternal(request.url)
    return false
  }
  function handleMessage({ nativeEvent }: WebViewMessageEvent) {
    const message = parseNativeMessage(nativeEvent.data, nativeEvent.url, address.id, nonce)
    if (!message || generation !== connection.viewGeneration)
      return
    if (message.type === 'dsh://bridge-ready') {
      if (connection.loadError)
        return
      setDocumentReady(true)
      connection.markLoaded(generation)
      if (appState === 'active')
        void requestNotificationAccess()
      return
    }
    if (message.type === 'dsh://focus-result') {
      const request = focusRequestRef.current
      const pending = connection.pendingFocus
      if (!request || request.requestId !== message.requestId || !pending
        || pending.origin !== request.focus.origin || pending.sessionId !== request.focus.sessionId
        || pending.tag !== request.focus.tag || pending.title !== request.focus.title) {
        return
      }
      connection.queueFocus(null)
      if (!message.handled)
        connection.setNotice(copy.focusFailed)
      return
    }
    void sendNativeNotification(message, address.id)
  }
  function loadingStarted(url: string) {
    if (generation !== connection.viewGeneration || !isTrustedOrigin(url, address.id))
      return
    mainUrlRef.current = url
    focusRequestRef.current = null
    setDocumentReady(false)
  }
  function loaded(url: string) {
    if (isTrustedOrigin(url, address.id))
      ref.current?.injectJavaScript(shim)
  }
  function openDrawer() {
    connection.dismissHint()
    connection.setDrawerOpen(true)
    void refreshHealth()
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }} edges={['top', 'bottom']}>
      <View className="flex-1">
        <WebView
          ref={ref}
          source={{ uri: buildConnectUrl(address) }}
          style={{ flex: 1, backgroundColor: background }}
          injectedJavaScriptBeforeContentLoaded={shim}
          injectedJavaScript={shim}
          injectedJavaScriptForMainFrameOnly
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          mixedContentMode="never"
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={allowNavigation}
          onMessage={handleMessage}
          onLoadStart={event => loadingStarted(event.nativeEvent.url)}
          onLoad={event => loaded(event.nativeEvent.url)}
          onError={() => connection.markLoadFailed(generation, copy.connectionFailed)}
          onHttpError={({ nativeEvent }) => {
            if (nativeEvent.statusCode >= 400 && nativeEvent.url === mainUrlRef.current)
              connection.markLoadFailed(generation, copy.connectionFailed)
          }}
          onNavigationStateChange={(navigation) => {
            canGoBackRef.current = navigation.canGoBack
            if (isTrustedOrigin(navigation.url, address.id))
              mainUrlRef.current = navigation.url
          }}
          onOpenWindow={({ nativeEvent }) => { void openExternal(nativeEvent.targetUrl) }}
          onRenderProcessGone={() => connection.markLoadFailed(generation, copy.connectionFailed)}
          onContentProcessDidTerminate={() => connection.markLoadFailed(generation, copy.connectionFailed)}
        />
        <If cond={state.notice && !state.drawerOpen}>
          <Then>
            <Pressable
              className="absolute left-3 right-3 top-3 rounded-xl border border-border bg-surface px-4 py-3"
              accessibilityRole="button"
              accessibilityLabel={state.notice ?? copy.connectionInfo}
              onPress={openDrawer}
            >
              <Text className="text-sm leading-6 text-warning" accessibilityLiveRegion="polite">{state.notice}</Text>
            </Pressable>
          </Then>
        </If>
        <View className="absolute bottom-4 right-3">
          <Button variant="outline" isIconOnly className="bg-surface" accessibilityLabel={copy.openDrawer} onPress={openDrawer}>
            <PanelRightOpen size={21} color={foreground} />
          </Button>
        </View>
        <If cond={state.loading}>
          <Then>
            <View className="absolute inset-0 items-center justify-center gap-5 bg-background">
              <DotsLoader />
              <Text className="text-sm text-muted">{copy.loading}</Text>
            </View>
          </Then>
        </If>
        <If cond={state.loadError}>
          <Then>
            <View className="absolute inset-0 items-center justify-center gap-5 bg-background px-8">
              <Text className="text-center text-base leading-7 text-foreground">{state.loadError}</Text>
              <Button onPress={() => connectAddress(address)}>{copy.reconnect}</Button>
              <Button variant="ghost" onPress={openDrawer}>{copy.connectionInfo}</Button>
            </View>
          </Then>
        </If>
        <If cond={state.swipeHintVisible}>
          <Then>
            <Pressable
              className="absolute inset-0 items-center justify-center gap-5 bg-black/60"
              accessibilityRole="button"
              accessibilityLabel={copy.swipeAccessibility}
              onPress={() => connection.dismissHint()}
            >
              <View className="flex-row items-center gap-3">
                <ArrowLeft size={34} color="#ffffff" />
                <Hand size={52} color="#ffffff" strokeWidth={1.5} />
              </View>
              <Text className="text-base font-medium text-white">{copy.swipeHint}</Text>
            </Pressable>
          </Then>
        </If>
      </View>
    </SafeAreaView>
  )
}
