import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdminEmail } from '@/lib/admin/super-admin';

// GET /api/admin/me — whether to show the "Platform admin" link.
// Never errors: anyone signed in simply gets false.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isSuperAdmin = Boolean(
    user?.email && user.email_confirmed_at && isSuperAdminEmail(user.email),
  );
  return NextResponse.json({ isSuperAdmin });
}
