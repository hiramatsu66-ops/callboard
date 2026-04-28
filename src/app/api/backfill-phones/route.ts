import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

const HUBSPOT_API = 'https://api.hubapi.com';

async function getContactPhone(email: string, token: string): Promise<string | null> {
  const res = await fetch(
    `${HUBSPOT_API}/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email&properties=phone`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.properties?.phone || null;
}

export async function POST() {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN未設定' }, { status: 500 });
  }

  const supabase = createAdminClient();

  // 電話番号が空でメールがあるリードを全件取得
  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, company_name, email')
    .or('phone.is.null,phone.eq.')
    .not('email', 'is', null)
    .neq('email', '');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!leads || leads.length === 0) {
    return NextResponse.json({ message: '対象リードなし', updated: 0, skipped: 0 });
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
    // HubSpotのレートリミット対策
    await new Promise(r => setTimeout(r, 100));
  }

  return NextResponse.json({
    total: leads.length,
    updated,
    skipped,
    results,
  });
}
