const path = require('node:path')
const process = require('node:process')
const { getDefaultConfig } = require('expo/metro-config')
const { FileStore } = require('metro-cache')
const { withUniwindConfig } = require('uniwind/metro')

const config = withUniwindConfig(getDefaultConfig(__dirname), {
  cssEntryFile: './src/global.css',
  dtsFile: './src/uniwind-types.d.ts',
})

config.resolver.blockList = [/[\\/]\.git[\\/].*/, /[\\/]\.temp[\\/].*/]

if (process.platform === 'win32') {
  config.maxWorkers = 2
  config.cacheStores = [new FileStore({ root: path.join(__dirname, 'node_modules/.cache/metro') })]
}

module.exports = config
