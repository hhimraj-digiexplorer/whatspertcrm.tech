import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdmin } from '@/lib/admin/super-admin';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { loadPlans } from '@/lib/billing/account-billing';

const ID_RE = /^[a-z0-9_]{2,32}$/;

function intOrNull(v: unknown, field: string, min: number): number | null {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new RangeError(`${field} must be a whole number ≥ ${min}, or empty for unlimited`);
  return n;
}

function money(v: unknown, field: string): number {
  const n = Number(v ?? 0);
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`${field} must be whole rupees ≥ 0`);
  return n;
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

/** Validate a plan from the editor into a DB row. */
function toRow(body: Record<string, unknown>) {
  const features = Array.isArray(body.features)
    ? body.features.filter((f): f is string => typeof f === 'string' && f.trim() !== '').map((f) => f.trim().slice(0, 120)).slice(0, 20)
    : [];
  return {
    name: text(body.name, 60) ?? (() => { throw new RangeError('name is required'); })(),
    description: text(body.description, 300) ?? '',
    price_monthly_inr: money(body.price_monthly_inr, 'price_monthly_inr'),
    price_yearly_inr: money(body.price_yearly_inr, 'price_yearly_inr'),
    razorpay_plan_id_monthly: text(body.razorpay_plan_id_monthly, 64),
    razorpay_plan_id_yearly: text(body.razorpay_plan_id_yearly, 64),
    max_members: intOrNull(body.max_members, 'max_members', 1),
    max_contacts: intOrNull(body.max_contacts, 'max_contacts', 0),
    max_broadcast_recipients_per_month: intOrNull(body.max_broadcast_recipients_per_month, 'max_broadcast_recipients_per_month', 0),
    ai_enabled: body.ai_enabled !== false,
    flows_enabled: body.flows_enabled !== false,
    api_enabled: body.api_enabled !== false,
    is_public: body.is_public !== false,
    sort_order: Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    features,
  };
}

// GET /api/admin/plans — every plan, including hidden ones.
export async function GET() {
  try {
    await requireSuperAdmin();
    return NextResponse.json({ plans: await loadPlans({ publicOnly: false }) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// PUT /api/admin/plans — create or update one plan (keyed by id).
export async function PUT(request: Request) {
  try {
    const admin = await requireSuperAdmin();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!body || !ID_RE.test(id)) {
      return NextResponse.json({ error: 'Plan id must be 2–32 lowercase letters, digits or _' }, { status: 400 });
    }
    let row;
    try {
      row = toRow(body);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    const { error } = await supabaseAdmin().from('plans').upsert({ id, ...row }, { onConflict: 'id' });
    if (error) throw error;
    console.info('[admin] plan saved', { by: admin.email, plan: id });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
