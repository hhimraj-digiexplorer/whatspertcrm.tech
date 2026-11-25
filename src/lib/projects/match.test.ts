import { describe, expect, it } from 'vitest'
import { matchByKeywords, parseProjectInput, resolveProject, suggestTag, type Project } from './match'

function project(over: Partial<Project> & Pick<Project, 'id' | 'name' | 'tag'>): Project {
  return {
    code: null,
    category: 'residential',
    keywords: [],
    ad_ids: [],
    welcome_mode: 'default',
    welcome_template: null,
    welcome_language: null,
    ai_instructions: null,
    is_active: true,
    ...over,
  }
}

// A channel partner with a villa project, a commercial project and an apartment project.
const galleria = project({ id: 'g', name: 'AIS Galleria', tag: 'p-galleria', code: 'GAL', category: 'villa', keywords: ['galleria'], ad_ids: ['120000000001'] })
const sky = project({ id: 's', name: 'Sky Heights', tag: 'p-sky', code: 'SKY', keywords: ['sky heights', 'skyheights'] })
const skyMall = project({ id: 'm', name: 'Sky Mall', tag: 'p-sky-mall', category: 'commercial', keywords: ['sky mall', 'shops'] })
const paused = project({ id: 'x', name: 'Old Project', tag: 'p-old', keywords: ['old'], is_active: false })
const all = [galleria, sky, skyMall, paused]

describe('resolveProject — strict, ordered rules', () => {
  it('an explicit code, tag or name wins', () => {
    expect(resolveProject(all, { values: ['gal'] }).project?.id).toBe('g')
    expect(resolveProject(all, { values: ['P-SKY'] }).project?.id).toBe('s')
    expect(resolveProject(all, { values: ['Sky Mall'] }).project?.id).toBe('m')
  })

  it('the explicit value beats a conflicting ad or keyword', () => {
    expect(resolveProject(all, { values: ['SKY'], adId: '120000000001', sourceTexts: ['Galleria campaign'] }).project?.id).toBe('s')
  })

  it('an unknown explicit value falls through to the ad id', () => {
    expect(resolveProject(all, { values: ['Unknown'], adId: '120000000001' })).toMatchObject({ project: { id: 'g' }, via: 'ad_id' })
  })

  it('keywords: whole words only', () => {
    expect(resolveProject(all, { sourceTexts: ['Galleria Lucknow Nov'] }).project?.id).toBe('g')
    expect(resolveProject(all, { sourceTexts: ['Galleriaa offer'] }).project).toBeNull()
  })

  it('a longer keyword wins over a shorter one it contains', () => {
    // "sky heights" vs. nothing else; "sky mall" vs "sky" style overlaps
    expect(matchByKeywords(all, ['Sky Mall shops leasing'], 'source_text').project?.id).toBe('m')
  })

  it('two different projects = ambiguous = no project (never a guess)', () => {
    const m = resolveProject(all, { sourceTexts: ['Galleria vs Sky Heights comparison'] })
    expect(m).toMatchObject({ project: null, ambiguous: true })
  })

  it('an ambiguous source does not fall through to a weaker signal', () => {
    const m = resolveProject(all, { sourceTexts: ['Galleria and Sky Heights'], messageText: 'galleria please' })
    expect(m.project).toBeNull()
    expect(m.ambiguous).toBe(true)
  })

  it('message keywords are used only when passed', () => {
    expect(resolveProject(all, { messageText: 'Hi, I want details of Sky Heights' })).toMatchObject({ project: { id: 's' }, via: 'message' })
    expect(resolveProject(all, { messageText: null }).project).toBeNull()
  })

  it('paused projects never match', () => {
    expect(resolveProject(all, { values: ['p-old'], sourceTexts: ['old'] }).project).toBeNull()
  })

  it('works with no projects at all', () => {
    expect(resolveProject([], { values: ['x'] })).toEqual({ project: null, via: null, ambiguous: false })
  })

  it('handles Hindi keywords', () => {
    const hindi = project({ id: 'h', name: 'गैलेरिया', tag: 'p-hindi', keywords: ['गैलेरिया'] })
    expect(resolveProject([hindi], { messageText: 'गैलेरिया का रेट बताइए' }).project?.id).toBe('h')
  })
})

describe('parseProjectInput', () => {
  it('suggests a tag from the name', () => {
    expect(suggestTag('AIS Galleria')).toBe('p-ais-galleria')
    expect(parseProjectInput({ name: 'AIS Galleria' }).value.tag).toBe('p-ais-galleria')
  })
  it('validates every field', () => {
    const { errors } = parseProjectInput({
      name: '',
      tag: '#bad',
      code: '<x>',
      category: 'castle',
      ad_ids: ['abc'],
      welcome_mode: 'template',
      welcome_template: 'Bad Name',
    })
    expect(errors).toEqual(expect.arrayContaining(['name', 'tag', 'code', 'category', 'ad_ids', 'welcome_template']))
  })
  it('accepts comma lists and normalises', () => {
    const { value, errors } = parseProjectInput({
      name: ' Sky  Heights ',
      tag: 'p-sky',
      keywords: 'sky heights, skyheights, sky heights',
      ad_ids: '120211, 120212',
      category: 'commercial',
    })
    expect(errors).toEqual([])
    expect(value).toMatchObject({ name: 'Sky Heights', keywords: ['sky heights', 'skyheights'], ad_ids: ['120211', '120212'] })
  })
  it('partial updates only touch sent fields', () => {
    expect(parseProjectInput({ is_active: false }, true)).toEqual({ value: { is_active: false }, errors: [] })
  })
})
