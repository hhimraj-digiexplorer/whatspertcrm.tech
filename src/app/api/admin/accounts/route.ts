import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdmin } from '@/lib/admin/super-admin';
import { supabaseAdmin } from '@/lib/automations/admin-client';

const STATUSES = new Set(['trialing', 'active', 'past_due', 'cancelled', 'expired', 'suspended']);
const PAGE_SIZE = 50;

// GET /api/admin/accounts?q=&status=&page= — every client account.
export async function GET(request: Request) {
  try {
    await requireSuperAdmin();
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
    const status = url.searchParams.get('status') ?? '';
    const page = Math.max(0, Number.parseInt(url.searchParams.get('page') ?? '0', 10) || 0);

    const { data, error } = await supabaseAdmin().rpc('admin_list_accounts', {
      search: q || null,
      status_filter: STATUSES.has(status) ? status : null,
      page_size: PAGE_SIZE,
      page_offset: page * PAGE_SIZE,
    });
    if (error) throw error;

    const rows = (data ?? []) as { total_count: number; account_id: string }[];
    // AI Agents settings live on account_billing; merge them in.
    const ids = rows.map((r) => r.account_id);
    const ai = new Map<string, Record<string, unknown>>();
    if (ids.length > 0) {
      const { data: aiRows, error: aiErr } = await supabaseAdmin()
        .from('account_billing')
        .select('account_id, ai_access, ai_key_source, ai_platform_fee_inr, ai_platform_conversation_limit, max_whatsapp_numbers_override')
        .in('account_id', ids);
      if (aiErr) throw aiErr;
      for (const r of aiRows ?? []) ai.set(r.account_id as string, r);
    }
    return NextResponse.json({
      accounts: rows.map(({ total_count: _total, ...rest }) => ({
        ...rest,
        ai_access: ai.get(rest.account_id)?.ai_access ?? 'plan',
        ai_key_source: ai.get(rest.account_id)?.ai_key_source ?? 'client',
        ai_platform_fee_inr: ai.get(rest.account_id)?.ai_platform_fee_inr ?? 1000,
        ai_platform_conversation_limit: ai.get(rest.account_id)?.ai_platform_conversation_limit ?? 2500,
        max_whatsapp_numbers_override: ai.get(rest.account_id)?.max_whatsapp_numbers_override ?? null,
      })),
      total: rows[0]?.total_count ?? 0,
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
