import { NextRequest, NextResponse } from 'next/server';
import { getAuthUrl } from '@/lib/gmail';

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user_id');
  const debug = request.nextUrl.searchParams.get('debug');

  if (!userId) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  }

  const url = getAuthUrl(userId);

  if (debug) {
    return NextResponse.json({
      url,
      client_id: process.env.GOOGLE_CLIENT_ID ? 'set' : 'NOT SET',
      redirect_uri: process.env.GOOGLE_REDIRECT_URI || 'NOT SET',
    });
  }

  return NextResponse.redirect(url);
}
