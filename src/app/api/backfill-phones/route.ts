import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

const HUBSPOT_API = 'https://api.hubapi.com';
const BATCH_SIZE = 30;

async function getContactPhone(email: string, token: string): Promise<string | null> {
  const res = await fetch(
    `${HUBSPOT_API}/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email&properties=phone`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.properties?.phone || null;
}

export async function POST(request: NextRequest) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN未設定' }, { status: 500 });
  }

  const { offset = 0 } = await request.json().catch(() => ({ offset: 0 }));
  const supabase = createAdminClient();

  // 全件数を取得
  const { count } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .not('email', 'is', null)
    .neq('email', '');

  // offsetからBATCH_SIZE件取得
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, company_name, email')
    .not('email', 'is', null)
    .neq('email', '')
    .order('created_at')
    .range(offset, offset + BATCH_SIZE - 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!leads || leads.length === 0) {
    return NextResponse.json({ done: true, total: count ?? 0, updated: 0, skipped: 0, next_offset: null });
  }

  let updated = 0;
  let skipped = 0;
  const results: { company: string; phone: string }[] = [];

  for (const lead of leads) {
    try {
      const phone = await getContactPhone(lead.email, token);
      if (phone) {
        await supabase.from('leads').update({ phone }).eq('id', lead.id);
        updated++;
        results.push({ company: lead.company_name, phone });
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
    await new Promise(r => setTimeout(r, 80));
  }

  const next_offset = offset + leads.length;
  const done = next_offset >= (count ?? 0);

  return NextResponse.json({
    done,
    total: count ?? 0,
    processed: next_offset,
    updated,
    skipped,
    next_offset: done ? null : next_offset,
    results,
  });
}
