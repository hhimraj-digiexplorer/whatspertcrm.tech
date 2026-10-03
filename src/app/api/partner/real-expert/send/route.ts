import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { toInternationalDigits } from '@/lib/integrations/real-expert/config'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import { sendMessageToConversation, SendMessageError, validateSendMessageParams } from '@/lib/whatsapp/send-message'
import { requireEntitledPartner, readPartnerRequest } from '@/lib/partner/server'

/**
 * POST /api/partner/real-expert/send  (signed)
 * Body: { ref, lead_id, phone, country_code?, name?, text?,
 *         template?: { name, language?, variables?: string[] } }
 *
 * Send a WhatsApp message to a lead from Real Expert. Free text only
 * works inside the 24-hour window; otherwise send an approved template.
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

  const tpl = b.template && typeof b.template === 'object' ? (b.template as Record<string, unknown>) : null
  const text = typeof b.text === 'string' ? b.text.trim().slice(0, 4096) : ''
  const params = tpl
    ? {
        messageType: 'template',
        templateName: typeof tpl.name === 'string' ? tpl.name : null,
        templateLanguage: typeof tpl.language === 'string' ? tpl.language : null,
        templateParams: Array.isArray(tpl.variables) ? tpl.variables.map((v) => String(v ?? '')) : [],
      }
    : { messageType: 'text', contentText: text }

  try {
    validateSendMessageParams(params)
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : null
    const resolved = await resolveConversationByPhone(db, accountId, `+${digits}`, name || null)
    // The contact is this Real Expert lead: link it so the sync doesn't
    // push it back as a new lead.
    const leadId = typeof b.lead_id === 'string' || typeof b.lead_id === 'number' ? String(b.lead_id) : null
    if (leadId) {
      await db.from('crm_contact_links').upsert(
        {
          integration_id: gate.integration.id,
          contact_id: resolved.contactId,
          account_id: accountId,
          external_id: leadId,
          origin: 'real_expert',
        },
        { onConflict: 'integration_id,contact_id' },
      )
      await db
        .from('crm_sync_queue')
        .delete()
        .eq('integration_id', gate.integration.id)
        .eq('kind', 'lead')
        .eq('entity_id', resolved.contactId)
        .eq('status', 'pending')
    }
    const sent = await sendMessageToConversation(db, accountId, { conversationId: resolved.conversationId, ...params })
    return NextResponse.json({
      message_id: sent.messageId,
      whatsapp_message_id: sent.whatsappMessageId,
      conversation_id: resolved.conversationId,
    })
  } catch (err) {
    if (err instanceof SendMessageError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[partner/send] failed:', err)
    return NextResponse.json({ error: 'Could not send the message.' }, { status: 500 })
  }
}
