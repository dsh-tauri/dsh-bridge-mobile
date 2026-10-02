const { readFileSync } = require('node:fs')
const path = require('node:path')

function appConfig({ config }) {
  return {
    ...config,
    extra: {
      ...config.extra,
      thirdPartyNotices: readFileSync(path.join(__dirname, 'THIRD_PARTY_NOTICES.md'), 'utf8'),
    },
  }
}

module.exports = appConfig
