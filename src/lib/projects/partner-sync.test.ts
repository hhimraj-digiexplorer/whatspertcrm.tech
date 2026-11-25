import { describe, expect, it } from 'vitest'
import { partnerProjectBody } from './partner-sync'
import { mergeProjectSettings, toProjectSetting } from '@/lib/integrations/real-expert/projects-bridge'
import type { Project } from './match'

describe('Real Expert ⇄ workspace projects', () => {
  it('maps the partner shape to a project', () => {
    expect(
      partnerProjectBody('GAL', { name: 'AIS Galleria', tag: 'p-galleria', code: 'GAL', ads: ['120000000001', 'galleria'], welcome: { template: 'gal_welcome', language: 'en' } }),
    ).toEqual({
      name: 'AIS Galleria',
      tag: 'p-galleria',
      code: 'GAL',
      keywords: ['galleria'],
      ad_ids: ['120000000001'],
      welcome_mode: 'template',
      welcome_template: 'gal_welcome',
      welcome_language: 'en',
    })
    expect(partnerProjectBody('Sky Heights', { welcome: 'none' })).toMatchObject({ name: 'Sky Heights', tag: 'p-sky-heights', welcome_mode: 'none' })
  })

  it('table projects override legacy ones with the same tag; paused ones drop out', () => {
    const proj: Project = {
      id: '1', name: 'AIS Galleria', code: 'GAL', category: 'villa', tag: 'p-galleria', keywords: ['galleria'], ad_ids: [],
      welcome_mode: 'none', welcome_template: null, welcome_language: null, ai_instructions: null, is_active: true,
    }
    const merged = mergeProjectSettings(
      { galleria: { name: 'Old', tag: 'p-galleria' }, other: { name: 'Other', tag: 'p-other' } },
      [proj, { ...proj, id: '2', tag: 'p-paused', code: 'PAU', is_active: false }],
    )
    expect(Object.values(merged).map((s) => s.name).sort()).toEqual(['AIS Galleria', 'Other'])
    expect(toProjectSetting(proj)).toEqual({ name: 'AIS Galleria', tag: 'p-galleria', code: 'GAL', ads: ['galleria'], welcome: 'none' })
  })
})
