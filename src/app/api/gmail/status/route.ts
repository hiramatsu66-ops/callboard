import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');

  if (!userId) {
    return NextResponse.json({ connected: false });
  }

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('gmail_tokens')
    .select('email')
    .eq('user_id', userId)
    .single();

  return NextResponse.json({
    connected: !!data,
    email: data?.email || null,
  });
}
