import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

const HUBSPOT_API = 'https://api.hubapi.com';

interface HubSpotContact {
  id: string;
  properties: {
    firstname?: string;
    lastname?: string;
    email?: string;
    phone?: string;
    company?: string;
    created_date_kintone?: string;
    customer_attributes?: string;
    jobtitle?: string;
  };
}

async function fetchContacts(
  token: string,
  after?: string
): Promise<{ results: HubSpotContact[]; nextAfter: string | null }> {
  // 直近2ヶ月
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  const dateStr = twoMonthsAgo.toISOString().split('T')[0]; // e.g. "2026-01-31"

  const body: Record<string, unknown> = {
    filterGroups: [{
      filters: [
        { propertyName: 'customer_attributes', operator: 'EQ', value: '支援企業' },
        { propertyName: 'created_date_kintone', operator: 'GTE', value: dateStr },
      ],
    }],
    properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'created_date_kintone', 'customer_attributes', 'jobtitle'],
    sorts: [{ propertyName: 'created_date_kintone', direction: 'DESCENDING' }],
    limit: 100,
  };

  if (after) {
    body.after = after;
  }

  const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot API error: ${res.status} ${text}`);
  }

  const data = await res.json();
  return {
    results: data.results || [],
    nextAfter: data.paging?.next?.after || null,
  };
}

// GET: プレビュー（件数確認）
export async function GET() {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN未設定' }, { status: 500 });
  }

  try {
    const { results } = await fetchContacts(token);
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);

    // 既存リードのメールを取得
    const supabase = createAdminClient();
    const { data: existingLeads } = await supabase
      .from('leads')
      .select('email')
      .not('email', 'eq', '')
      .not('email', 'is', null);
    const existingEmails = new Set((existingLeads || []).map(l => l.email?.toLowerCase()));

    const newContacts = results.filter(c => {
      const email = c.properties.email?.toLowerCase();
      return email && !existingEmails.has(email);
    });

    return NextResponse.json({
      total_hubspot: results.length,
      already_exists: results.length - newContacts.length,
      new_contacts: newContacts.length,
      sample: newContacts.slice(0, 5).map(c => ({
        company: c.properties.company,
        name: `${c.properties.lastname || ''}${c.properties.firstname || ''}`,
        email: c.properties.email,
        kintone_date: c.properties.created_date_kintone,
      })),
      date_from: twoMonthsAgo.toISOString().split('T')[0],
    });
  } catch (error) {
    console.error('HubSpot import preview error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST: インポート実行
export async function POST(request: NextRequest) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN未設定' }, { status: 500 });
  }

  const { max_pages } = await request.json().catch(() => ({ max_pages: 10 }));
  const maxPages = Math.min(max_pages || 10, 50); // 最大50ページ(5000件)

  try {
    const supabase = createAdminClient();

    // 既存リードのメールを取得
    const { data: existingLeads } = await supabase
      .from('leads')
      .select('email')
      .not('email', 'eq', '')
      .not('email', 'is', null);
    const existingEmails = new Set((existingLeads || []).map(l => l.email?.toLowerCase()));

    let imported = 0;
    let skipped = 0;
    let after: string | null = null;

    for (let page = 0; page < maxPages; page++) {
      const { results, nextAfter } = await fetchContacts(token, after || undefined);
      if (results.length === 0) break;

      const newLeads = results
        .filter(c => {
          const email = c.properties.email?.toLowerCase();
          if (!email || existingEmails.has(email)) {
            skipped++;
            return false;
          }
          existingEmails.add(email); // 同バッチ内の重複防止
          return true;
        })
        .map(c => ({
          company_name: c.properties.company || '不明',
          contact_name: `${c.properties.lastname || ''}${c.properties.firstname || ''}`.trim() || '',
          email: c.properties.email || '',
          phone: c.properties.phone || '',
          lead_source: 'digima_registration',
          status: 'new',
          memo: `kintone作成: ${c.properties.created_date_kintone || '不明'}`,
        }));

      if (newLeads.length > 0) {
        const { error } = await supabase.from('leads').insert(newLeads);
        if (error) {
          console.error('Insert error:', error);
        } else {
          imported += newLeads.length;
        }
      }

      if (!nextAfter) break;
      after = nextAfter;
    }

    return NextResponse.json({ imported, skipped, pages_processed: Math.min(maxPages, 50) });
  } catch (error) {
    console.error('HubSpot import error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
