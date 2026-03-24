import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

const HUBSPOT_API = 'https://api.hubapi.com';

async function searchCompanies(
  query: string,
  token: string
): Promise<{ id: string; name: string; numDeals: number; domain: string }[]> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/companies/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      properties: ['name', 'num_associated_deals', 'domain'],
      limit: 10,
    }),
  });

  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map((c: { id: string; properties: Record<string, string> }) => ({
    id: c.id,
    name: c.properties.name || '',
    numDeals: parseInt(c.properties.num_associated_deals || '0'),
    domain: c.properties.domain || '',
  }));
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function checkCompanyDeal(
  companyName: string,
  homepage: string,
  token: string
): Promise<boolean> {
  // 1. Search by company name
  const byName = await searchCompanies(companyName, token);
  if (byName.some(c => c.numDeals > 0)) return true;

  // 2. If homepage provided, also try domain search
  const domain = extractDomain(homepage);
  if (domain) {
    const byDomain = await searchCompanies(domain, token);
    if (byDomain.some(c => c.numDeals > 0)) return true;
  }

  return false;
}

export async function POST(request: NextRequest) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN未設定' }, { status: 500 });
  }

  const { lead_id, company_name, homepage } = await request.json();

  if (!lead_id || !company_name) {
    return NextResponse.json({ error: 'lead_id and company_name required' }, { status: 400 });
  }

  try {
    const dealExists = await checkCompanyDeal(company_name, homepage || '', token);
    const now = new Date().toISOString();

    const supabase = createAdminClient();
    await supabase
      .from('leads')
      .update({ hs_deal_exists: dealExists, hs_checked_at: now })
      .eq('id', lead_id);

    return NextResponse.json({ deal_exists: dealExists, checked_at: now });
  } catch (error) {
    console.error('HubSpot check error:', error);
    return NextResponse.json({ error: 'HubSpotチェックに失敗しました' }, { status: 500 });
  }
}
