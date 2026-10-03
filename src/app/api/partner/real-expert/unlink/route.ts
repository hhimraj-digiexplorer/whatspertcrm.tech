import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { readPartnerRequest } from '@/lib/partner/server'

/**
 * POST /api/partner/real-expert/unlink  (signed)  Body: { ref }
 * Disconnects the workspace: the sync stops and its queue is dropped.
 * The Whatspert account, its chats and its users are kept.
 */
export async function POST(request: Request) {
  const read = await readPartnerRequest(request)
  if (read instanceof NextResponse) return read
  const { error } = await supabaseAdmin().from('crm_integrations').delete().eq('partner_ref', read.body.ref as string)
  if (error) return NextResponse.json({ error: 'Could not unlink.' }, { status: 500 })
  return NextResponse.json({ success: true })
}
