// ============================================================
// Super-admin (platform operator) access.
//
// Operators are listed by email in SUPER_ADMIN_EMAILS (comma-separated).
// They can see and manage every client account from /admin. Kept out
// of the database on purpose: no row a tenant could ever write grants
// platform access, and revoking someone is a redeploy-free env change
// on most hosts.
// ============================================================

import { createClient } from '@/lib/supabase/server';
import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';

export function superAdminEmails(raw = process.env.SUPER_ADMIN_EMAILS): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isSuperAdminEmail(email: string | null | undefined, raw?: string): boolean {
  return !!email && superAdminEmails(raw).has(email.trim().toLowerCase());
}

export interface SuperAdminContext {
  userId: string;
  email: string;
}

/**
 * The signed-in user, if they are a platform operator with a confirmed
 * email. Throws 401 without a session, 403 otherwise — callers map
 * both with toErrorResponse.
 */
export async function requireSuperAdmin(): Promise<SuperAdminContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();
  // An unconfirmed address proves nothing about who owns it.
  if (!user.email || !user.email_confirmed_at || !isSuperAdminEmail(user.email)) {
    throw new ForbiddenError();
  }
  return { userId: user.id, email: user.email };
}
