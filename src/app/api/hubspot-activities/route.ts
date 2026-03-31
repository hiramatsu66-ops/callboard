import { NextRequest, NextResponse } from 'next/server';

const HUBSPOT_API = 'https://api.hubapi.com';

interface EmailActivity {
  id: string;
  subject: string;
  bodyPreview: string;
  direction: string;
  from: string;
  to: string;
  timestamp: string;
}

async function searchCompanyId(name: string, token: string): Promise<number | null> {
  const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/companies/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: name, properties: ['name'], limit: 5 }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.results?.[0]?.id ? Number(data.results[0].id) : null;
}

async function searchContactId(email: string, token: string): Promise<number | null> {
  const res = await fetch(
    `${HUBSPOT_API}/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.ok) {
    const data = await res.json();
    return data.id ? Number(data.id) : null;
  }
  return null;
}

async function getAssociatedEmailIds(objectType: string, objectId: number, token: string): Promise<string[]> {
  // Try v3 associations first
  const res = await fetch(
    `${HUBSPOT_API}/crm/v3/objects/${objectType}/${objectId}/associations/emails`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.ok) {
    const data = await res.json();
    // v3 format: { results: [{ id: "123", type: "..." }] }
    const ids = (data.results || []).map((r: Record<string, unknown>) => String(r.id || r.toObjectId || ''));
    return ids.filter((id: string) => id && id !== 'undefined');
  }

  // Try v4 as fallback
  const v4Res = await fetch(
    `${HUBSPOT_API}/crm/v4/objects/${objectType}/${objectId}/associations/emails`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (v4Res.ok) {
    const data = await v4Res.json();
    // v4 format: { results: [{ toObjectId: 123 }] }
    return (data.results || []).map((r: Record<string, unknown>) => String(r.toObjectId || r.id || ''));
  }

  return [];
}

function parseEmails(results: { id: string; properties: Record<string, string> }[]): EmailActivity[] {
  return results.map(r => ({
    id: r.id,
    subject: r.properties.hs_email_subject || '(件名なし)',
    bodyPreview: (r.properties.hs_email_text || '').slice(0, 300),
    direction: r.properties.hs_email_direction === 'INCOMING_EMAIL' ? 'INCOMING' : 'OUTGOING',
    from: r.properties.hs_email_sender_email || '',
    to: r.properties.hs_email_to_email || '',
    timestamp: r.properties.hs_timestamp || '',
  }));
}

async function fetchEmails(objectType: string, objectId: number, token: string): Promise<EmailActivity[]> {
  const emailIds = await getAssociatedEmailIds(objectType, objectId, token);
  if (emailIds.length === 0) return [];

  // Use search API with hs_object_id filter (doesn't require crm.objects.emails.read scope)
  const results: EmailActivity[] = [];

  // Search in batches of 10 IDs
  for (let i = 0; i < emailIds.length && i < 50; i += 10) {
    const batch = emailIds.slice(i, i + 10);
    const res = await fetch(`${HUBSPOT_API}/crm/v3/objects/emails/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: 'hs_object_id',
            operator: 'IN',
            values: batch,
          }],
        }],
        properties: ['hs_email_subject', 'hs_email_text', 'hs_email_direction', 'hs_email_sender_email', 'hs_email_to_email', 'hs_timestamp'],
        limit: 10,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      for (const r of (data.results || [])) {
        const dir = r.properties.hs_email_direction || '';
        results.push({
          id: r.id,
          subject: r.properties.hs_email_subject || '(件名なし)',
          bodyPreview: (r.properties.hs_email_text || '').slice(0, 300),
          direction: dir.includes('INCOMING') ? 'INCOMING' : 'OUTGOING',
          from: r.properties.hs_email_sender_email || '',
          to: r.properties.hs_email_to_email || '',
          timestamp: r.properties.hs_timestamp || '',
        });
      }
    }
  }

  return results;
}

export async function GET(request: NextRequest) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'HUBSPOT_TOKEN未設定' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const companyName = searchParams.get('company');
  const email = searchParams.get('email');

  if (!companyName && !email) {
    return NextResponse.json({ error: 'company or email required' }, { status: 400 });
  }

  const activities: EmailActivity[] = [];
  const seenIds = new Set<string>();
  const debug: Record<string, unknown> = { companyName, email };

  // Search by contact email first
  if (email) {
    const contactId = await searchContactId(email, token);
    debug.contactId = contactId;
    if (contactId) {
      const assocIds = await getAssociatedEmailIds('contacts', contactId, token);
      debug.contactAssocIds = assocIds;
      // Also get raw association response for debug
      const rawAssocRes = await fetch(
        `${HUBSPOT_API}/crm/v3/objects/contacts/${contactId}/associations/emails`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (rawAssocRes.ok) {
        const rawAssocData = await rawAssocRes.json();
        debug.rawAssocSample = rawAssocData.results?.slice(0, 2);
      }

      // Try fetching first email directly for debug
      const testAssocIds = await getAssociatedEmailIds('contacts', contactId, token);
      if (testAssocIds.length > 0) {
        const testRes = await fetch(
          `${HUBSPOT_API}/crm/v3/objects/emails/${testAssocIds[0]}?properties=hs_email_subject`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        debug.testEmailFetch = { status: testRes.status, ok: testRes.ok };
        if (!testRes.ok) {
          debug.testEmailError = await testRes.text().catch(() => 'parse error');
        }
      }

      const emails = await fetchEmails('contacts', contactId, token);
      debug.contactEmailCount = emails.length;
      for (const e of emails) {
        if (!seenIds.has(e.id)) { activities.push(e); seenIds.add(e.id); }
      }
    }
  }

  // Also search by company
  if (companyName && activities.length === 0) {
    const companyId = await searchCompanyId(companyName, token);
    debug.companyId = companyId;
    if (companyId) {
      const emails = await fetchEmails('companies', companyId, token);
      debug.companyEmailCount = emails.length;
      for (const e of emails) {
        if (!seenIds.has(e.id)) { activities.push(e); seenIds.add(e.id); }
      }
    }
  }

  activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return NextResponse.json({ activities, debug: { ...debug, count: activities.length } });
}
