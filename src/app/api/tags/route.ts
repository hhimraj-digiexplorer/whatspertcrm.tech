import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/tags — the account's tags with their groups, for pickers
 * (flow builder conditions, set-tag nodes, entry conditions).
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data, error } = await ctx.supabase
      .from('tags')
      .select('id, name, color, group_name')
      .eq('account_id', ctx.accountId)
      .order('name')
    if (error) throw error
    return NextResponse.json({ tags: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}
