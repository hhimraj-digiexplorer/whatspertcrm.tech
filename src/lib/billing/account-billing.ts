// ============================================================
// Server helpers shared by the billing routes and the super-admin
// API: usage counts, the public plan list, and writing a patch.
// Service-role only.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { planFeatures, type Plan } from './plans';
import { broadcastUsageThisMonth } from './server';
import type { BillingPatch } from './apply';

export interface AccountUsage {
  contacts: number;
  members: number;
  broadcastsThisMonth: number;
}

async function countRows(
  db: SupabaseClient,
  table: 'contacts' | 'profiles',
  accountId: string,
): Promise<number> {
  const { count } = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId);
  return count ?? 0;
}

export async function loadUsage(accountId: string): Promise<AccountUsage> {
  const db = supabaseAdmin();
  const [contacts, members, broadcastsThisMonth] = await Promise.all([
    countRows(db, 'contacts', accountId),
    countRows(db, 'profiles', accountId),
    broadcastUsageThisMonth(accountId),
  ]);
  return { contacts, members, broadcastsThisMonth };
}

/** All plans, sorted for display. `publicOnly` hides trial/custom plans. */
export async function loadPlans({ publicOnly }: { publicOnly: boolean }): Promise<Plan[]> {
  let query = supabaseAdmin().from('plans').select('*').order('sort_order');
  if (publicOnly) query = query.eq('is_public', true);
  const { data, error } = await query;
  if (error) throw new Error(`loadPlans: ${error.message}`);
  return (data ?? []).map((row) => ({ ...(row as Plan), features: planFeatures(row.features) }));
}

export async function knownPlanIds(): Promise<Set<string>> {
  const { data } = await supabaseAdmin().from('plans').select('id');
  return new Set((data ?? []).map((r) => r.id as string));
}

export async function writeBillingPatch(accountId: string, patch: BillingPatch): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('account_billing')
    .update(patch)
    .eq('account_id', accountId);
  if (error) throw new Error(`writeBillingPatch: ${error.message}`);
}
