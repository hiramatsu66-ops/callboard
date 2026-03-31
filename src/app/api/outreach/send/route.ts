import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getOAuth2Client, buildRawEmail } from '@/lib/gmail';
import { google } from 'googleapis';

export async function POST(request: NextRequest) {
  const { queue_ids, user_id } = await request.json();

  if (!user_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Get Gmail tokens
  const { data: tokenData } = await supabase
    .from('gmail_tokens')
    .select('*')
    .eq('user_id', user_id)
    .single();

  if (!tokenData) {
    return NextResponse.json({ error: 'Gmail未連携です' }, { status: 400 });
  }

  // Get queue items with lead info
  const { data: items } = await supabase
    .from('email_queue')
    .select('*, leads(email, company_name, contact_name)')
    .in('id', queue_ids)
    .eq('status', 'approved');

  if (!items || items.length === 0) {
    return NextResponse.json({ error: '送信対象がありません' }, { status: 400 });
  }

  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    expiry_date: tokenData.expiry_date,
  });

  oauth2Client.on('tokens', async (tokens) => {
    const updateData: Record<string, unknown> = {};
    if (tokens.access_token) updateData.access_token = tokens.access_token;
    if (tokens.expiry_date) updateData.expiry_date = tokens.expiry_date;
    if (Object.keys(updateData).length > 0) {
      await supabase.from('gmail_tokens').update(updateData).eq('user_id', user_id);
    }
  });

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const now = new Date().toISOString();

  let sent = 0;
  let failed = 0;

  for (const item of items) {
    const lead = item.leads as { email: string; company_name: string; contact_name: string } | null;
    if (!lead?.email) {
      await supabase.from('email_queue').update({ status: 'failed', error_message: 'メールアドレスなし' }).eq('id', item.id);
      failed++;
      continue;
    }

    try {
      const raw = buildRawEmail({
        to: lead.email,
        from: tokenData.email,
        subject: item.subject,
        body: item.body,
      });

      await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });

      await supabase.from('email_queue').update({ status: 'sent', sent_at: now }).eq('id', item.id);

      // Log as email activity
      await supabase.from('call_logs').insert({
        lead_id: item.lead_id,
        caller_id: user_id,
        result: 'email_sent',
        memo: `件名: ${item.subject}`,
        activity_type: 'email',
      });

      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabase.from('email_queue').update({ status: 'failed', error_message: msg }).eq('id', item.id);
      failed++;
    }
  }

  return NextResponse.json({ sent, failed, total: items.length });
}
