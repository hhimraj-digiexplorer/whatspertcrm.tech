import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { findExistingContact } from '@/lib/contacts/dedupe'
import { toInternationalDigits } from '@/lib/integrations/real-expert/config'
import { requireEntitledPartner, readPartnerRequest } from '@/lib/partner/server'

/** Customer-service window: free-form replies only within 24h of the last inbound message. */
const WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * POST /api/partner/real-expert/chat  (signed)
 * Body: { ref, phone, country_code?, limit? }
 *
 * The WhatsApp chat with one phone number, for the panel on a Real
 * Expert lead page: the latest messages (oldest first), whether a
 * free-form reply is allowed, and the approved templates to start a
 * conversation with.
 */
export async function POST(request: Request) {
  const read = await readPartnerRequest(request)
  if (read instanceof NextResponse) return read
  const b = read.body
  const db = supabaseAdmin()

  const gate = await requireEntitledPartner(db, b.ref as string)
  if (gate instanceof NextResponse) return gate
  const accountId = gate.integration.account_id

  const digits = toInternationalDigits(b.phone, typeof b.country_code === 'string' ? b.country_code : '91')
  if (!digits) return NextResponse.json({ error: 'The lead has no valid phone number.' }, { status: 400 })
  const limit = Math.min(Math.max(Number(b.limit) || 50, 1), 200)

  const [{ data: templates }, { data: wa }] = await Promise.all([
    db
      .from('message_templates')
      .select('name, language, body_text, category')
      .eq('account_id', accountId)
      .eq('status', 'APPROVED')
      .order('name'),
    db.from('whatsapp_config').select('status').eq('account_id', accountId).maybeSingle(),
  ])

  const contact = await findExistingContact(db, accountId, digits)
  let conversationId: string | null = null
  let messages: Record<string, unknown>[] = []
  if (contact) {
    const { data: conv } = await db
      .from('conversations')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    conversationId = (conv?.id as string | undefined) ?? null
    if (conversationId) {
      const { data } = await db
        .from('messages')
        .select('id, sender_type, content_type, content_text, media_url, template_name, status, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit)
      messages = (data ?? []).reverse()
    }
  }

  const lastInbound = [...messages].reverse().find((m) => m.sender_type === 'customer')
  const windowOpen =
    !!lastInbound && Date.now() - new Date(lastInbound.created_at as string).getTime() < WINDOW_MS

  return NextResponse.json({
    phone: `+${digits}`,
    whatsapp_connected: wa?.status === 'connected',
    contact: contact ? { id: contact.id, name: contact.name ?? null } : null,
    conversation_id: conversationId,
    window_open: windowOpen,
    messages,
    templates: templates ?? [],
  })
}
