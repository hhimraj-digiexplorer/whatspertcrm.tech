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

    const rows = (data ?? []) as { total_count: number }[];
    return NextResponse.json({
      accounts: rows.map(({ total_count: _total, ...rest }) => rest),
      total: rows[0]?.total_count ?? 0,
      page,
      pageSize: PAGE_SIZE,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
