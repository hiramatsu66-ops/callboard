import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { email, name, role } = await req.json();

  if (!email) {
    return NextResponse.json({ error: 'メールアドレスが必要です' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://callboard-eosin.vercel.app';
  const assignedRole = role === 'manager' ? 'manager' : 'caller';

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    data: { name: name || email },
    redirectTo: `${siteUrl}/auth/callback`,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // プロフィールのroleを更新（トリガーでcallerとして作成されるため上書き）
  if (data.user?.id) {
    await supabase
      .from('profiles')
      .update({ role: assignedRole, name: name || email })
      .eq('id', data.user.id);
  }

  return NextResponse.json({ success: true });
}
