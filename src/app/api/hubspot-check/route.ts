import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

const HUBSPOT_API = 'https://api.hubapi.com';

async function hubspotFetch(path: string, token: string) {
  const res = await fetch(`${HUBSPOT_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

async function checkCompanyDeal(companyName: string, token: string): Promise<boolean> {
  // Search company by name
  const searchRes = await hubspotFetch(
    `/crm/v3/objects/companies/search`,
    token
  );
  // Use POST for search
  const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/companies/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: 'name',
          operator: 'CONTAINS_TOKEN',
          value: companyName,
        }],
      }],
      properties: ['name', 'num_associated_deals'],
      limit: 5,
    }),
  });

  if (!res.ok) {
    // Fallback: try exact match with query search
    const fallbackRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/companies/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: companyName,
        properties: ['name', 'num_associated_deals'],
        limit: 5,
      }),
    });
    if (!fallbackRes.ok) return false;
    const fallbackData = await fallbackRes.json();
    return fallbackData.results?.some(
      (c: { properties: { num_associated_deals?: string } }) =>
        parseInt(c.properties.num_associated_deals || '0') > 0
    ) ?? false;
  }

  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    // No exact match found, try query search
    const fallbackRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/companies/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: companyName,
        properties: ['name', 'num_associated_deals'],
        limit: 5,
      }),
    });
    if (!fallbackRes.ok) return false;
    const fallbackData = await fallbackRes.json();
    return fallbackData.results?.some(
      (c: { properties: { num_associated_deals?: string } }) =>
        parseInt(c.properties.num_associated_deals || '0') > 0
    ) ?? false;
  }

  return data.results.some(
    (c: { properties: { num_associated_deals?: string } }) =>
      parseInt(c.properties.num_associated_deals || '0') > 0
  );
}

// Single lead check
export async function POST(request: NextRequest) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN未設定' }, { status: 500 });
  }

  const { lead_id, company_name } = await request.json();

  if (!lead_id || !company_name) {
    return NextResponse.json({ error: 'lead_id and company_name required' }, { status: 400 });
  }

  try {
    const dealExists = await checkCompanyDeal(company_name, token);
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
