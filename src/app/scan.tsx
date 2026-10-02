import type { BarcodeScanningResult } from 'expo-camera'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { router } from 'expo-router'
import { Button } from 'heroui-native/button'
import { useThemeColor } from 'heroui-native/hooks'
import { useEffect, useRef, useState } from 'react'
import { Else, If, Then } from 'react-if-lite'
import { Linking, Text, View } from 'react-native'
import { X } from 'react-native-lucide'
import { SafeAreaView } from 'react-native-safe-area-context'
import { DotsLoader } from '@/components/dots-loader'
import { copy } from '@/config/copy'
import { useAppState } from '@/hooks/use-app-state'
import { connectAddress } from '@/store/modules/connection/runtime'
import { parseQrPayload } from '@/utils/bridge-protocol'

export default function ScanScreen() {
  const [permission, requestPermission, refreshPermission] = useCameraPermissions()
  const appState = useAppState()
  const [error, setError] = useState<string | null>(null)
  const [scanned, setScanned] = useState(false)
  const lockedRef = useRef(false)
  const [background, foreground] = useThemeColor(['background', 'foreground'])
  // keep:effect Recheck the native camera permission when returning from system settings.
  useEffect(() => {
    if (appState === 'active')
      void refreshPermission().catch(() => setError(copy.cameraError))
  }, [appState, refreshPermission])
  function handleBarcode({ data }: BarcodeScanningResult) {
    if (lockedRef.current)
      return
    lockedRef.current = true
    setScanned(true)
    const address = parseQrPayload(data)
    if (!address) {
      setError(copy.invalidQr)
      return
    }
    connectAddress(address)
    router.back()
  }
  async function allowCamera() {
    try {
      if (permission && !permission.canAskAgain)
        await Linking.openSettings()
      else
        await requestPermission()
    }
    catch {
      setError(copy.cameraError)
    }
  }
  function retry() {
    lockedRef.current = false
    setError(null)
    setScanned(false)
  }
  let permissionLabel: string = copy.allowCamera
  if (permission && !permission.canAskAgain)
    permissionLabel = copy.openSettings
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: background }}>
      <View className="flex-row items-center justify-between gap-3 px-5 pb-3 pt-2">
        <Text className="flex-1 text-lg font-semibold text-foreground">{copy.cameraTitle}</Text>
        <Button variant="ghost" isIconOnly accessibilityLabel={copy.closeScanner} onPress={() => router.back()}>
          <X size={24} color={foreground} />
        </Button>
      </View>
      <If cond={permission !== null}>
        <Then>
          <If cond={permission?.granted}>
            <Then>
              <View className="mx-5 flex-1 overflow-hidden rounded-3xl bg-black">
                <If cond={appState === 'active'}>
                  <Then>
                    <CameraView
                      style={{ flex: 1 }}
                      facing="back"
                      barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                      onBarcodeScanned={scanned ? undefined : handleBarcode}
                      onMountError={() => setError(copy.cameraError)}
                    />
                  </Then>
                </If>
                <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
                  <View className="h-64 w-64 rounded-3xl border-2 border-white/80" />
                </View>
              </View>
              <View className="gap-4 px-6 py-6">
                <Text className="text-center text-sm leading-6 text-muted">{copy.cameraHint}</Text>
                <If cond={error !== null}>
                  <Then>
                    <Text className="text-center text-sm text-danger" accessibilityLiveRegion="polite">{error}</Text>
                    <Button variant="outline" onPress={retry}>{copy.qrRetry}</Button>
                  </Then>
                </If>
              </View>
            </Then>
            <Else>
              <View className="flex-1 items-center justify-center gap-6 px-8">
                <Text className="text-center text-base leading-7 text-foreground">{copy.cameraPermission}</Text>
                <Button onPress={() => { void allowCamera() }}>{permissionLabel}</Button>
                <If cond={error}><Then><Text className="text-center text-sm text-danger">{error}</Text></Then></If>
              </View>
            </Else>
          </If>
        </Then>
        <Else><View className="flex-1 items-center justify-center"><DotsLoader /></View></Else>
      </If>
    </SafeAreaView>
  )
}
