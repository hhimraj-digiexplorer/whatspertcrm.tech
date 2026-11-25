import { describe, expect, it } from 'vitest'
import { blocksAutoMessages, OPT_OUT_GRACE_MS, optOutIntent } from './opt-out'

describe('optOutIntent', () => {
  it('recognises a plain STOP in any case and with punctuation', () => {
    for (const t of ['STOP', 'stop', 'Stop!', ' stop. ', 'Unsubscribe', 'opt out', 'OPT-OUT', 'band karo', 'बंद करो']) {
      expect(optOutIntent(t)).toBe('opt_out')
    }
  })
  it('recognises START / subscribe as opting back in', () => {
    for (const t of ['START', 'start', 'Subscribe', 'opt in']) expect(optOutIntent(t)).toBe('opt_in')
  })
  it('ignores sentences that merely contain the word', () => {
    for (const t of ['stop calling me after 6pm', "don't stop", 'when does the offer stop?', 'start date of possession', '', null]) {
      expect(optOutIntent(t as string)).toBeNull()
    }
  })
})

describe('blocksAutoMessages', () => {
  const now = Date.parse('2026-11-25T10:00:00Z')
  it('never blocks a contact who did not opt out', () => {
    expect(blocksAutoMessages(null, now)).toBe(false)
  })
  it('lets the immediate confirmation through, then blocks', () => {
    expect(blocksAutoMessages(new Date(now - 10_000).toISOString(), now)).toBe(false)
    expect(blocksAutoMessages(new Date(now - OPT_OUT_GRACE_MS - 1).toISOString(), now)).toBe(true)
  })
  it('blocks when the time is unreadable (fail closed)', () => {
    expect(blocksAutoMessages('not-a-date', now)).toBe(true)
  })
})
