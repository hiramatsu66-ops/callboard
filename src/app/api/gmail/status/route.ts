import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ connected: false });
  }

  const { data } = await supabase
    .from('gmail_tokens')
    .select('email')
    .eq('user_id', user.id)
    .single();

  return NextResponse.json({
    connected: !!data,
    email: data?.email || null,
  });
}
