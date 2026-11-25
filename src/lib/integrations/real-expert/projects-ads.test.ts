import { describe, expect, it } from 'vitest'
import { matchProject, parseOptions, projectForReferral, projectForTags, projectTagNames } from './config'
import { parseReferral } from './ad-referral'

const { options, invalid } = parseOptions({
  projects: {
    Galleria: { tag: 'p-galleria', code: 'GAL-01', ads: '120211223344, galleria' },
    'Sky Heights': { tag: 'p-sky', code: 'SKY', ads: ['sky heights', '998877'] },
    Plain: { tag: 'p-plain' },
  },
})

describe('project code and ads', () => {
  it('parses code and ads (comma string or list)', () => {
    expect(invalid).toEqual([])
    const byName = (n: string) => Object.values(options.projects).find((p) => p.name === n)
    expect(byName('Galleria')).toMatchObject({ code: 'GAL-01', ads: ['120211223344', 'galleria'] })
    expect(byName('Sky Heights')).toMatchObject({
      code: 'SKY',
      ads: ['sky heights', '998877'],
    })
  })

  it('flags a bad code or too many ads', () => {
    expect(parseOptions({ projects: { X: { code: 'bad<code>' } } }).invalid.length).toBeGreaterThan(0)
    const many = Array.from({ length: 25 }, (_, i) => `w${i}`)
    expect(parseOptions({ projects: { X: { ads: many } } }).invalid.length).toBeGreaterThan(0)
  })

  it('matches a lead on the saved code even when the project is keyed by name', () => {
    expect(matchProject(options.projects, { project_code: 'SKY' })?.setting.name).toBe('Sky Heights')
  })

  it('acceptance test 3: an ad id maps to its project', () => {
    expect(projectForReferral(options.projects, { source_id: '998877', headline: 'Galleria offer' })?.setting.tag).toBe('p-sky')
  })

  it('a word in the ad headline, text or link maps to its project', () => {
    expect(projectForReferral(options.projects, { headline: 'New launch: SKY HEIGHTS towers' })?.setting.tag).toBe('p-sky')
    expect(projectForReferral(options.projects, { source_url: 'https://fb.me/galleria-2bhk' })?.setting.tag).toBe('p-galleria')
    expect(projectForReferral(options.projects, { headline: 'Unrelated', source_id: '1' })).toBeNull()
    expect(projectForReferral(options.projects, null)).toBeNull()
  })

  it('maps tags back to projects', () => {
    expect(projectForTags(options.projects, ['P-SKY'])?.setting.code).toBe('SKY')
    expect(projectForTags(options.projects, ['vip'])).toBeNull()
    expect(projectTagNames(options.projects).sort()).toEqual(['p-galleria', 'p-plain', 'p-sky'])
  })
})

describe('parseReferral', () => {
  it('keeps the known fields only', () => {
    expect(
      parseReferral({ source_id: '998877', source_type: 'ad', headline: ' Sky ', ctwa_clid: 'abc', evil: { x: 1 } }),
    ).toEqual({ source_id: '998877', source_type: 'ad', headline: 'Sky', ctwa_clid: 'abc' })
  })
  it('ignores empty or non-ad referrals', () => {
    expect(parseReferral(undefined)).toBeNull()
    expect(parseReferral({ ctwa_clid: 'abc' })).toBeNull()
  })
})
