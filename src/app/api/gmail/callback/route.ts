import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getOAuth2Client } from '@/lib/gmail';
import { google } from 'googleapis';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state'); // user_id

  if (!code || !state) {
    return NextResponse.redirect(new URL('/leads?gmail_error=missing_params', request.url));
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get Gmail email address
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    const supabase = createAdminClient();
    const { error } = await supabase.from('gmail_tokens').upsert({
      user_id: state,
      email: userInfo.email || '',
      access_token: tokens.access_token || '',
      refresh_token: tokens.refresh_token || '',
      expiry_date: tokens.expiry_date || 0,
    });

    if (error) {
      console.error('Failed to save Gmail tokens:', error);
      return NextResponse.redirect(new URL('/leads?gmail_error=save_failed', request.url));
    }

    return NextResponse.redirect(new URL('/leads?gmail_connected=true', request.url));
  } catch (error) {
    console.error('Gmail OAuth callback error:', error);
    return NextResponse.redirect(new URL('/leads?gmail_error=auth_failed', request.url));
  }
}
