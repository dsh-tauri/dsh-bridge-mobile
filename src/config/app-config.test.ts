import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getConfig } from 'expo/config'
import { describe, expect, it } from 'vitest'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))

describe('public Expo configuration packaged by expo-constants', () => {
  it('embeds the complete original artwork notice without changing Android identity or version', () => {
    const { exp } = getConfig(projectRoot, { isPublicConfig: true, skipSDKVersionRequirement: true })
    const notice = exp.extra?.thirdPartyNotices

    expect(notice).toBe(readFileSync(new URL('../../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'))
    expect(notice).toContain('Copyright (c) 2026 DeepSeek')
    expect(notice).toContain('Permission is hereby granted, free of charge')
    expect(notice).toContain('The above copyright notice and this permission notice shall be included in all')
    expect(notice).toContain('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND')
    expect(exp.version).toBe('0.1.2')
    expect(exp.android?.package).toBe('com.dshtauri.dshbridge')
    expect(exp.android?.versionCode).toBe(3)
  })
})
