import { describe, expect, it } from 'vitest'
import { pickSendingNumber, resolveBroadcastNumber, workspaceNumberLimit } from './workspace-numbers'

type Rows = Record<string, Record<string, unknown>[]>

/** Tiny fake of the supabase query builder: eq filters + maybeSingle. */
function fakeDb(rows: Rows, opts: { throwOn?: string } = {}) {
  return {
    from(table: string) {
      if (opts.throwOn === table) throw new Error('boom')
      const filters: [string, unknown][] = []
      const chain = {
        select: () => chain,
        eq: (k: string, v: unknown) => {
          filters.push([k, v])
          return chain
        },
        maybeSingle: async () => ({
          data: (rows[table] ?? []).find((r) => filters.every(([k, v]) => r[k] === v)) ?? null,
          error: null,
        }),
      }
      return chain
    },
  } as never
}

const base: Rows = {
  conversations: [
    { id: 'c-extra', account_id: 'a1', phone_number_id: '333' },
    { id: 'c-gone', account_id: 'a1', phone_number_id: '444' },
    { id: 'c-none', account_id: 'a1', phone_number_id: null },
  ],
  whatsapp_numbers: [
    { account_id: 'a1', phone_number_id: '333', status: 'active' },
    { account_id: 'a1', phone_number_id: '555', status: 'disabled' },
  ],
}

describe('pickSendingNumber', () => {
  const pick = (conversationId: string | null, db = fakeDb(base)) =>
    pickSendingNumber(db, { accountId: 'a1', primaryPhoneNumberId: '111', conversationId })

  it('replies from the conversation’s extra number', async () => {
    expect(await pick('c-extra')).toBe('333')
  })
  it('falls back to the primary for no number, a removed number, or no conversation', async () => {
    expect(await pick('c-none')).toBe('111')
    expect(await pick('c-gone')).toBe('111')
    expect(await pick(null)).toBe('111')
    expect(await pick('missing')).toBe('111')
  })
  it('fails safe to the primary when the lookup errors', async () => {
    expect(await pick('c-extra', fakeDb(base, { throwOn: 'conversations' }))).toBe('111')
  })
})

describe('resolveBroadcastNumber', () => {
  const resolve = (requested: string | null) =>
    resolveBroadcastNumber(fakeDb(base), { accountId: 'a1', primaryPhoneNumberId: '111', requested })
  it('uses an active extra number, otherwise the primary', async () => {
    expect(await resolve('333')).toBe('333')
    expect(await resolve('555')).toBe('111') // disabled
    expect(await resolve('999')).toBe('111') // not ours
    expect(await resolve(null)).toBe('111')
  })
})

describe('workspaceNumberLimit', () => {
  it('prefers the account override, then the plan, then 1', async () => {
    const db = (row: Record<string, unknown> | null) => fakeDb({ account_billing: row ? [{ account_id: 'a1', ...row }] : [] })
    expect(await workspaceNumberLimit(db({ max_whatsapp_numbers_override: 3, plan: { max_whatsapp_numbers: 5 } }), 'a1')).toBe(3)
    expect(await workspaceNumberLimit(db({ max_whatsapp_numbers_override: null, plan: { max_whatsapp_numbers: 5 } }), 'a1')).toBe(5)
    expect(await workspaceNumberLimit(db(null), 'a1')).toBe(1)
  })
})
