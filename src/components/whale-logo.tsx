import { Image } from 'react-native'
import { copy } from '@/config/copy'

export function WhaleLogo({ size = 104 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/icon.png')}
      style={{ width: size, height: size }}
      accessibilityLabel={copy.appName}
      resizeMode="contain"
    />
  )
}
