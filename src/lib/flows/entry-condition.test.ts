import { describe, expect, it } from 'vitest'
import { inboundText, parseEntryCondition, passesEntryCondition } from './entry-condition'

const tags = (...pairs: [string, string | null][]) => pairs.map(([id, group_name]) => ({ id, group_name }))

describe('flow entry conditions', () => {
  it('reads valid conditions and drops malformed ones', () => {
    expect(parseEntryCondition({ kind: 'tag', tag_id: ' t1 ' })).toEqual({ kind: 'tag', tag_id: 't1' })
    expect(parseEntryCondition({ kind: 'tag', tag_id: 't1', negate: true })).toEqual({ kind: 'tag', tag_id: 't1', negate: true })
    expect(parseEntryCondition({ kind: 'tag_group', group: 'Project', test: 'bogus' })).toEqual({
      kind: 'tag_group',
      group: 'Project',
      test: 'any',
    })
    expect(parseEntryCondition({ kind: 'tag', tag_id: '' })).toBeNull()
    expect(parseEntryCondition({ kind: 'nope' })).toBeNull()
    expect(parseEntryCondition(null)).toBeNull()
  })

  it('no condition lets everyone in', () => {
    expect(passesEntryCondition(null, [])).toBe(true)
  })

  it('tag / not tag', () => {
    const t = tags(['p-a', 'Project'])
    expect(passesEntryCondition({ kind: 'tag', tag_id: 'p-a' }, t)).toBe(true)
    expect(passesEntryCondition({ kind: 'tag', tag_id: 'p-b' }, t)).toBe(false)
    expect(passesEntryCondition({ kind: 'tag', tag_id: 'p-a', negate: true }, t)).toBe(false)
  })

  it('acceptance test 4: a contact with no project tag gets the picker', () => {
    const picker = { kind: 'tag_group' as const, group: 'Project', test: 'none' as const }
    expect(passesEntryCondition(picker, tags(['vip', null]))).toBe(true)
    expect(passesEntryCondition(picker, tags(['p-a', 'Project']))).toBe(false)
  })

  it('detects more than one project without one condition per pair', () => {
    const many = { kind: 'tag_group' as const, group: 'project', test: 'more_than_one' as const }
    expect(passesEntryCondition(many, tags(['p-a', 'Project'], ['p-b', 'Project']))).toBe(true)
    expect(passesEntryCondition(many, tags(['p-a', 'Project'], ['hot', 'Stage']))).toBe(false)
  })

  it('message text for typed text and taps', () => {
    expect(inboundText({ kind: 'text', text: 'GAL price' })).toBe('GAL price')
    expect(inboundText({ kind: 'interactive_reply', reply_title: 'Galleria' })).toBe('Galleria')
  })
})
