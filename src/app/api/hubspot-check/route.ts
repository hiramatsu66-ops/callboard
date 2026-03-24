import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

const HUBSPOT_API = 'https://api.hubapi.com';

interface DealInfo {
  exists: boolean;
  ownerName: string;
  createdAt: string | null;
}

async function searchCompanyIds(
  query: string,
  token: string
): Promise<string[]> {
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
  return (data.results || [])
    .filter((c: { properties: Record<string, string> }) =>
      parseInt(c.properties.num_associated_deals || '0') > 0
    )
    .map((c: { id: string }) => c.id);
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

async function getLatestDealForCompany(
  companyId: string,
  token: string
): Promise<{ dealname: string; hubspot_owner_id: string; createdate: string } | null> {
  // Use CRM Search with company association filter
  const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filterGroups: [{
        filters: [{
          propertyName: 'associations.company',
          operator: 'EQ',
          value: companyId,
        }],
      }],
      properties: ['dealname', 'hubspot_owner_id', 'createdate'],
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      limit: 1,
    }),
  });

  if (!res.ok) {
    console.error('Deal search failed:', res.status, await res.text().catch(() => ''));
    return null;
  }
  const data = await res.json();
  if (!data.results || data.results.length === 0) return null;
  return data.results[0].properties;
}

async function buildOwnerMap(token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let after: string | undefined;

  // Paginate through all owners
  for (let i = 0; i < 10; i++) {
    const url = new URL(`${HUBSPOT_API}/crm/v3/owners`);
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error('Owners API failed:', res.status);
      break;
    }
    const data = await res.json();
    for (const owner of data.results || []) {
      const last = owner.lastName || '';
      const first = owner.firstName || '';
      const name = `${last}${first}`.trim() || owner.email || '';
      if (name) map.set(owner.id, name);
    }
    if (!data.paging?.next?.after) break;
    after = data.paging.next.after;
  }

  return map;
}

async function checkCompanyDeal(
  companyName: string,
  homepage: string,
  token: string,
  ownerMap: Map<string, string>
): Promise<DealInfo> {
  const noDeal: DealInfo = { exists: false, ownerName: '', createdAt: null };

  // Search by company name
  let companyIds = await searchCompanyIds(companyName, token);

  // Fallback: search by domain
  if (companyIds.length === 0) {
    const domain = extractDomain(homepage);
    if (domain) {
      companyIds = await searchCompanyIds(domain, token);
    }
  }

  if (companyIds.length === 0) return noDeal;

  // Get latest deal from matched companies
  for (const companyId of companyIds) {
    const deal = await getLatestDealForCompany(companyId, token);
    if (deal) {
      const ownerName = ownerMap.get(deal.hubspot_owner_id) || '';
      return {
        exists: true,
        ownerName,
        createdAt: deal.createdate || null,
      };
    }
  }

  return noDeal;
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
    const ownerMap = await buildOwnerMap(token);
    const companyIds = await searchCompanyIds(company_name, token);
    let deal = null;
    let rawDealData = null;
    for (const cid of companyIds) {
      deal = await getLatestDealForCompany(cid, token);
      if (deal) { rawDealData = { companyId: cid, deal }; break; }
    }
    // Domain fallback
    if (!deal) {
      const domain = extractDomain(homepage || '');
      if (domain) {
        const domainIds = await searchCompanyIds(domain, token);
        for (const cid of domainIds) {
          deal = await getLatestDealForCompany(cid, token);
          if (deal) { rawDealData = { companyId: cid, deal, viaDomain: true }; break; }
        }
      }
    }

    const ownerName = deal ? (ownerMap.get(deal.hubspot_owner_id) || '') : '';
    const dealInfo: DealInfo = {
      exists: !!deal,
      ownerName,
      createdAt: deal?.createdate || null,
    };
    const now = new Date().toISOString();

    const supabase = createAdminClient();
    await supabase
      .from('leads')
      .update({
        hs_deal_exists: dealInfo.exists,
        hs_checked_at: now,
        hs_deal_owner: dealInfo.ownerName,
        hs_deal_created_at: dealInfo.createdAt,
      })
      .eq('id', lead_id);

    return NextResponse.json({
      deal_exists: dealInfo.exists,
      checked_at: now,
      deal_owner: dealInfo.ownerName,
      deal_created_at: dealInfo.createdAt,
      _debug: {
        ownerMapSize: ownerMap.size,
        ownerMapSample: Object.fromEntries([...ownerMap.entries()].slice(0, 3)),
        companyIds,
        rawDealData,
        hubspot_owner_id: deal?.hubspot_owner_id,
        ownerLookupResult: deal ? ownerMap.get(deal.hubspot_owner_id) : null,
      },
    });
  } catch (error) {
    console.error('HubSpot check error:', error);
    return NextResponse.json({ error: 'HubSpotチェックに失敗しました' }, { status: 500 });
  }
}
