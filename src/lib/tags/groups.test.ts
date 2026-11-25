import { describe, expect, it } from 'vitest'
import { isTagGroupTest, normaliseGroupName, passesGroupTest, sameGroup } from './groups'

describe('tag groups', () => {
  it('counts tags in a group for each test', () => {
    expect([0, 1, 2].map((n) => passesGroupTest(n, 'none'))).toEqual([true, false, false])
    expect([0, 1, 2].map((n) => passesGroupTest(n, 'any'))).toEqual([false, true, true])
    expect([0, 1, 2].map((n) => passesGroupTest(n, 'one'))).toEqual([false, true, false])
    expect([0, 1, 2].map((n) => passesGroupTest(n, 'more_than_one'))).toEqual([false, false, true])
  })
  it('matches group names case-insensitively and ignores blanks', () => {
    expect(sameGroup('Project', ' project ')).toBe(true)
    expect(sameGroup('Project', null)).toBe(false)
    expect(sameGroup('', '')).toBe(false)
  })
  it('normalises group names', () => {
    expect(normaliseGroupName('  Project   A ')).toBe('Project A')
    expect(normaliseGroupName('   ')).toBeNull()
    expect(normaliseGroupName('x'.repeat(60))).toHaveLength(40)
  })
  it('knows its tests', () => {
    expect(isTagGroupTest('more_than_one')).toBe(true)
    expect(isTagGroupTest('two')).toBe(false)
  })
})
