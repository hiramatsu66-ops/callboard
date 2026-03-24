import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { getOAuth2Client, buildRawEmail } from '@/lib/gmail';
import { google } from 'googleapis';

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { to, subject, body } = await request.json();

  if (!to || !subject || !body) {
    return NextResponse.json({ error: '宛先、件名、本文は必須です' }, { status: 400 });
  }

  // Get stored tokens
  const { data: tokenData } = await supabase
    .from('gmail_tokens')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!tokenData) {
    return NextResponse.json({ error: 'Gmail未連携です。先にGmail連携を行ってください。' }, { status: 400 });
  }

  try {
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry_date: tokenData.expiry_date,
    });

    // Auto-refresh token if expired
    oauth2Client.on('tokens', async (tokens) => {
      const updateData: Record<string, unknown> = {};
      if (tokens.access_token) updateData.access_token = tokens.access_token;
      if (tokens.expiry_date) updateData.expiry_date = tokens.expiry_date;
      if (Object.keys(updateData).length > 0) {
        await supabase
          .from('gmail_tokens')
          .update(updateData)
          .eq('user_id', user.id);
      }
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const raw = buildRawEmail({ to, from: tokenData.email, subject, body });

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    return NextResponse.json({ success: true, from: tokenData.email });
  } catch (error: unknown) {
    console.error('Gmail send error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Token expired/revoked
    if (message.includes('invalid_grant') || message.includes('Token has been expired or revoked')) {
      await supabase.from('gmail_tokens').delete().eq('user_id', user.id);
      return NextResponse.json({ error: 'Gmail連携の有効期限が切れました。再連携してください。', reauth: true }, { status: 401 });
    }

    return NextResponse.json({ error: 'メール送信に失敗しました' }, { status: 500 });
  }
}
