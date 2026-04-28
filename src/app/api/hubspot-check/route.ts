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

// 受注ステージ
const WON_STAGES = new Set([
  '1009228167', // 事業開発パイプライン 受注
  '1016011424', // もう1つのパイプライン 受注
]);

// 掲載プランで対象外にする値
const ACTIVE_PLANS = new Set(['プレミアムプラン', 'ベーシックプラン', 'ライトプラン']);

interface DealInfo {
  exists: boolean;
  ownerName: string;
  createdAt: string | null;
  dealStage: string;
  shouldExclude: boolean; // 受注済み or 有料プラン利用中
  excludeReason: string;
  listingPlan: string; // 掲載プラン
  kintoneCreatedAt: string | null;
}

interface CompanyInfo {
  id: string;
  plan: string;
  kintoneCreatedAt: string | null;
}

async function searchCompanies(
  query: string,
  token: string
): Promise<CompanyInfo[]> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/companies/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      properties: ['name', 'num_associated_deals', 'domain', 'plan', 'created_date_kintone'],
      limit: 10,
    }),
  });

  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || [])
    .filter((c: { properties: Record<string, string> }) =>
      parseInt(c.properties.num_associated_deals || '0') > 0
    )
    .map((c: { id: string; properties: Record<string, string> }) => ({
      id: c.id,
      plan: c.properties.plan || '',
      kintoneCreatedAt: c.properties.created_date_kintone || null,
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

async function searchContactIds(
  query: string,
  token: string
): Promise<string[]> {
  // search APIで検索
  const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      properties: ['firstname', 'lastname', 'email'],
      limit: 10,
    }),
  });

  if (res.ok) {
    const data = await res.json();
    const ids = (data.results || []).map((r: { id: string }) => r.id);
    if (ids.length > 0) return ids;
  }

  return [];
}

async function lookupContactByEmail(
  email: string,
  token: string
): Promise<string | null> {
  const res = await fetch(
    `${HUBSPOT_API}/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.id || null;
}

async function getDealsForContact(
  contactId: string,
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
          propertyName: 'associations.contact',
          operator: 'EQ',
          value: contactId,
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

function pickBestDeal(
  deals: { dealname: string; hubspot_owner_id: string; createdate: string; dealstage: string }[],
  ownerMap: Map<string, string>,
  companyPlan: string = '',
  kintoneCreatedAt: string | null = null
): DealInfo | null {
  if (deals.length === 0) return null;
  // Prefer qualified stage deal, otherwise use the most recent deal
  const qualifiedDeal = deals.find(d => QUALIFIED_STAGES.has(d.dealstage));
  const best = qualifiedDeal || deals[0]; // deals are sorted by createdate DESC

  // Check exclusion: any deal ever reached 受注, or active plan
  const hasWonDeal = deals.some(d => WON_STAGES.has(d.dealstage));
  const hasActivePlan = ACTIVE_PLANS.has(companyPlan);
  const shouldExclude = hasWonDeal || hasActivePlan;
  const excludeReason = hasWonDeal && hasActivePlan
    ? '受注済み・有料プラン利用中'
    : hasWonDeal ? '受注済み' : hasActivePlan ? '有料プラン利用中' : '';

  return {
    exists: true,
    ownerName: ownerMap.get(best.hubspot_owner_id) || '',
    createdAt: best.createdate || null,
    dealStage: best.dealstage,
    shouldExclude,
    excludeReason,
    listingPlan: companyPlan,
    kintoneCreatedAt,
  };
}

async function findDealForCompanies(
  companies: CompanyInfo[],
  token: string,
  ownerMap: Map<string, string>
): Promise<DealInfo | null> {
  for (const company of companies) {
    const deals = await getDealsForCompany(company.id, token);
    const result = pickBestDeal(deals, ownerMap, company.plan, company.kintoneCreatedAt);
    if (result) return result;
  }
  return null;
}

async function checkCompanyDeal(
  companyName: string,
  homepage: string,
  email: string,
  contactName: string,
  token: string,
  ownerMap: Map<string, string>
): Promise<DealInfo> {
  const noDeal: DealInfo = { exists: false, ownerName: '', createdAt: null, dealStage: '', shouldExclude: false, excludeReason: '', listingPlan: '', kintoneCreatedAt: null };

  // 1. 会社名で検索
  let companies = await searchCompanies(companyName, token);

  // 2. ドメインで検索
  if (companies.length === 0) {
    const domain = extractDomain(homepage);
    if (domain) {
      companies = await searchCompanies(domain, token);
    }
  }

  // 会社の有料プランチェック（取引がなくてもプランで除外判定する）
  const companyPlan = companies.length > 0 ? companies[0].plan : '';
  const companyKintoneCreatedAt = companies.length > 0 ? companies[0].kintoneCreatedAt : null;
  if (!companies.length && companyPlan === '' ) {
    // no companies found, continue to contact search
  }

  // 会社が見つかった場合、商談チェック
  if (companies.length > 0) {
    const result = await findDealForCompanies(companies, token, ownerMap);
    if (result) return result;

    // 取引なしでもプランがある場合は除外対象
    if (ACTIVE_PLANS.has(companyPlan)) {
      return { ...noDeal, shouldExclude: true, excludeReason: '有料プラン利用中', listingPlan: companyPlan, kintoneCreatedAt: companyKintoneCreatedAt };
    }
  }

  // 3. メールアドレスでコンタクト検索 → コンタクトに紐づく商談を直接検索
  if (email) {
    const directContactId = await lookupContactByEmail(email, token);
    const contactIds = directContactId ? [directContactId] : await searchContactIds(email, token);
    for (const contactId of contactIds) {
      const deals = await getDealsForContact(contactId, token);
      const result = pickBestDeal(deals, ownerMap, companyPlan);
      if (result) return result;
    }
  }

  // 4. 担当者名でコンタクト検索 → コンタクトに紐づく商談を直接検索
  if (contactName) {
    const contactIds = await searchContactIds(contactName, token);
    for (const contactId of contactIds) {
      const deals = await getDealsForContact(contactId, token);
      const result = pickBestDeal(deals, ownerMap, companyPlan);
      if (result) return result;
    }
  }

  return { ...noDeal, listingPlan: companyPlan, kintoneCreatedAt: companyKintoneCreatedAt };
}

export async function POST(request: NextRequest) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN未設定' }, { status: 500 });
  }

  const { lead_id, company_name, homepage, email, contact_name } = await request.json();

  if (!lead_id || !company_name) {
    return NextResponse.json({ error: 'lead_id and company_name required' }, { status: 400 });
  }

  try {
    const ownerMap = await buildOwnerMap(token);
    const dealInfo = await checkCompanyDeal(company_name, homepage || '', email || '', contact_name || '', token, ownerMap);
    const now = new Date().toISOString();

    const supabase = createAdminClient();
    const updateData: Record<string, unknown> = {
      hs_deal_exists: dealInfo.exists,
      hs_checked_at: now,
      hs_deal_owner: dealInfo.ownerName,
      hs_deal_created_at: dealInfo.createdAt,
      hs_listing_plan: dealInfo.listingPlan,
      ...(dealInfo.kintoneCreatedAt !== null && { kintone_created_at: dealInfo.kintoneCreatedAt }),
    };

    // 受注済みまたは有料プラン利用中の場合、自動的にステータスを対象外に
    if (dealInfo.shouldExclude) {
      updateData.status = 'excluded';
      updateData.memo = dealInfo.excludeReason;
    }

    await supabase
      .from('leads')
      .update(updateData)
      .eq('id', lead_id);

    return NextResponse.json({
      deal_exists: dealInfo.exists,
      checked_at: now,
      deal_owner: dealInfo.ownerName,
      deal_created_at: dealInfo.createdAt,
      should_exclude: dealInfo.shouldExclude,
      exclude_reason: dealInfo.excludeReason,
      listing_plan: dealInfo.listingPlan,
      kintone_created_at: dealInfo.kintoneCreatedAt,
    });
  } catch (error) {
    console.error('HubSpot check error:', error);
    return NextResponse.json({ error: 'HubSpotチェックに失敗しました' }, { status: 500 });
  }
}
