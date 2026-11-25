import { describe, expect, it } from 'vitest'
import { partnerProjectBody, planRename, projectErrorMessage } from './partner-sync'
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

describe('Real Expert project master — their field names, renames and readable errors', () => {
  const base: Project = {
    id: '1', name: 'HIM City', code: 'GSR-HIM-01', category: 'residential', tag: 'p-gsr-him-01', keywords: [], ad_ids: [],
    welcome_mode: 'default', welcome_template: null, welcome_language: null, ai_instructions: null, is_active: true,
  }

  it('reads their exact payload', () => {
    expect(
      partnerProjectBody('GSR-HIM-01', {
        name: 'HIM City',
        code: 'GSR-HIM-01',
        type: 'residential',
        tag: 'p-gsr-him-01',
        keywords: ['him city', 'sector 82'],
        meta_ad_ids: ['23859100000000000'],
        welcome: 'default',
        ai_notes: '3 BHK from ₹68L.',
        active: false,
      }),
    ).toEqual({
      name: 'HIM City',
      code: 'GSR-HIM-01',
      category: 'residential',
      tag: 'p-gsr-him-01',
      keywords: ['him city', 'sector 82'],
      ad_ids: ['23859100000000000'],
      welcome_mode: 'default',
      ai_instructions: '3 BHK from ₹68L.',
      is_active: false,
    })
  })

  it('accepts every code Real Expert allows', () => {
    expect(partnerProjectBody('.hidden-01', { name: 'X' }).code).toBe('.hidden-01')
    expect(partnerProjectBody('A/B 2', { name: 'X' }).code).toBe('A/B 2')
  })

  it('plans a code rename and refuses clashes in plain words', () => {
    const other = { ...base, id: '2', name: 'Sky Mall', code: 'SKY', tag: 'p-sky' }
    expect(planRename([base, other], 'gsr-him-01', 'GSR-HIM-1')).toEqual({ project: base })
    expect(planRename([base, other], 'GSR-HIM-01', 'sky')).toEqual({ error: 'Code “sky” is already used by project “Sky Mall” in Whatspert.' })
    expect(planRename([base], 'NOPE', 'NEW')).toMatchObject({ error: expect.stringContaining('is not set up in Whatspert') })
  })

  it('words errors for a salesperson', () => {
    expect(projectErrorMessage('GSR-HIM-01', 'HIM City', 'the WhatsApp tag must be 1–50 letters, digits or hyphens')).toBe(
      'Project “HIM City” (GSR-HIM-01): the WhatsApp tag must be 1–50 letters, digits or hyphens.',
    )
  })
})
