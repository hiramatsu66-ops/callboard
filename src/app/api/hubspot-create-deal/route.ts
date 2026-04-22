import { NextRequest, NextResponse } from 'next/server';

const HUBSPOT_API = 'https://api.hubapi.com';

export async function POST(req: NextRequest) {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'HubSpot token not configured' }, { status: 500 });
  }

  const pipelineId = process.env.HUBSPOT_PIPELINE_ID;
  const dealStageId = process.env.HUBSPOT_APPOINT_STAGE_ID;

  if (!pipelineId || !dealStageId) {
    return NextResponse.json({ error: 'HubSpot pipeline/stage not configured' }, { status: 500 });
  }

  const body = await req.json();
  const { company_name, email, contact_name, homepage } = body;

  if (!company_name) {
    return NextResponse.json({ error: 'company_name is required' }, { status: 400 });
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Close date: 30 days from today
  const closeDate = new Date();
  closeDate.setDate(closeDate.getDate() + 30);
  const closeDateStr = closeDate.toISOString().split('T')[0];

  // Try to find existing contact/company in HubSpot for association
  let contactId: string | null = null;
  let companyId: string | null = null;

  if (email) {
    try {
      const contactRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/contacts/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
          limit: 1,
        }),
      });
      if (contactRes.ok) {
        const contactData = await contactRes.json();
        if (contactData.results?.length > 0) {
          contactId = contactData.results[0].id;
        }
      }
    } catch { /* ignore */ }
  }

  if (!companyId && company_name) {
    try {
      const companyRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/companies/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: 'name', operator: 'EQ', value: company_name }] }],
          limit: 1,
        }),
      });
      if (companyRes.ok) {
        const companyData = await companyRes.json();
        if (companyData.results?.length > 0) {
          companyId = companyData.results[0].id;
        }
      }
    } catch { /* ignore */ }
  }

  if (!companyId && homepage) {
    try {
      const domain = homepage.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const companyRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/companies/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }] }],
          limit: 1,
        }),
      });
      if (companyRes.ok) {
        const companyData = await companyRes.json();
        if (companyData.results?.length > 0) {
          companyId = companyData.results[0].id;
        }
      }
    } catch { /* ignore */ }
  }

  // Create the deal
  const dealName = `[アポ] ${company_name}`;
  const dealRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/deals`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      properties: {
        dealname: dealName,
        pipeline: pipelineId,
        dealstage: dealStageId,
        closedate: closeDateStr,
      },
    }),
  });

  if (!dealRes.ok) {
    const errData = await dealRes.json();
    return NextResponse.json({ error: errData.message || 'Failed to create deal' }, { status: 500 });
  }

  const deal = await dealRes.json();
  const dealId = deal.id;

  // Associate with contact/company if found
  const associationPromises: Promise<unknown>[] = [];

  if (contactId) {
    associationPromises.push(
      fetch(`${HUBSPOT_API}/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/deal_to_contact`, {
        method: 'PUT',
        headers,
      }).catch(() => {})
    );
  }

  if (companyId) {
    associationPromises.push(
      fetch(`${HUBSPOT_API}/crm/v3/objects/deals/${dealId}/associations/companies/${companyId}/deal_to_company`, {
        method: 'PUT',
        headers,
      }).catch(() => {})
    );
  }

  await Promise.all(associationPromises);

  return NextResponse.json({
    success: true,
    deal_id: dealId,
    deal_name: dealName,
    contact_id: contactId,
    company_id: companyId,
  });
}
