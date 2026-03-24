import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

const HUBSPOT_API = 'https://api.hubapi.com';

// 「関心喚起」以降のステージ（関心喚起を含む）
// 事業開発パイプライン
// コンシェルジュ等の別パイプライン
const QUALIFIED_STAGES = new Set([
  // 事業開発パイプライン (688416257)
  '1008569742', // 関心喚起
  '1008569743', // 課題の合意
  '1008569744', // D納得獲得
  '1008569745', // C納得獲得
  '1008569746', // B購買環境整備
  '1009228166', // A申込書送付
  '1009228167', // 受注
  // もう1つのパイプライン
  '1016011420', // 関心喚起
  '1016011421', // 課題の合意
  '1016011422', // D納得獲得（商談化）
  '1016011423', // C納得獲得
  '1016107028', // B購買環境整備
  '1016107029', // A申込書送付
  '1016011424', // 受注
]);

interface DealInfo {
  exists: boolean;
  ownerName: string;
  createdAt: string | null;
  dealStage: string;
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

async function getDealsForCompany(
  companyId: string,
  token: string
): Promise<{ dealname: string; hubspot_owner_id: string; createdate: string; dealstage: string }[]> {
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
      properties: ['dealname', 'hubspot_owner_id', 'createdate', 'dealstage'],
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      limit: 20,
    }),
  });

  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map((r: { properties: Record<string, string> }) => r.properties);
}

async function buildOwnerMap(token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let after: string | undefined;

  for (let i = 0; i < 10; i++) {
    const url = new URL(`${HUBSPOT_API}/crm/v3/owners`);
    url.searchParams.set('limit', '100');
    if (after) url.searchParams.set('after', after);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) break;
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
  const noDeal: DealInfo = { exists: false, ownerName: '', createdAt: null, dealStage: '' };

  let companyIds = await searchCompanyIds(companyName, token);

  if (companyIds.length === 0) {
    const domain = extractDomain(homepage);
    if (domain) {
      companyIds = await searchCompanyIds(domain, token);
    }
  }

  if (companyIds.length === 0) return noDeal;

  // Check all deals for qualified stage
  for (const companyId of companyIds) {
    const deals = await getDealsForCompany(companyId, token);
    // Find the latest deal that has passed 関心喚起
    const qualifiedDeal = deals.find(d => QUALIFIED_STAGES.has(d.dealstage));
    if (qualifiedDeal) {
      return {
        exists: true,
        ownerName: ownerMap.get(qualifiedDeal.hubspot_owner_id) || '',
        createdAt: qualifiedDeal.createdate || null,
        dealStage: qualifiedDeal.dealstage,
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
    const dealInfo = await checkCompanyDeal(company_name, homepage || '', token, ownerMap);
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
    });
  } catch (error) {
    console.error('HubSpot check error:', error);
    return NextResponse.json({ error: 'HubSpotチェックに失敗しました' }, { status: 500 });
  }
}
