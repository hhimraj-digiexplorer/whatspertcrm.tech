import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { drainCrmQueue } from '@/lib/integrations/real-expert/sync'

/**
 * GET /api/integrations/cron — push queued CRM updates for every
 * account (retries included). Run it every few minutes with the
 * `x-cron-secret` header set to AUTOMATION_CRON_SECRET, like the
 * automations cron.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = Buffer.from(request.headers.get('x-cron-secret') ?? '')
  const expectedBuf = Buffer.from(expected)
  if (supplied.length !== expectedBuf.length || !timingSafeEqual(supplied, expectedBuf)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await drainCrmQueue(supabaseAdmin(), { limit: 200 })
  return NextResponse.json(result)
}
