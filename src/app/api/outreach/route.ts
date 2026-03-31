import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import Anthropic from '@anthropic-ai/sdk';

const DIGIMA_CONTEXT = `
あなたは株式会社Resorzの営業担当です。「Digima〜出島〜」という有料サービスへの掲載・参画を提案するメールを作成します。
これは協業・提携の打診ではなく、相手企業に対して「有料サービスを導入しませんか」という営業提案です。

【Digima〜出島〜とは】
日本企業の海外進出を支援する、海外ビジネスに特化したBtoBメディア・プラットフォームです。
- ミッション: 「グローバル市場で成功する日本企業を10,000社つくる」
- 運営: 株式会社Resorz（2009年創業）
- 月間50万PV、会員数2.8万人（海外進出を検討している企業）、月間問い合わせ100件以上

【有料サービスの内容（サポート企業向け）】
Digimaに「サポート企業」として有料掲載いただくことで、海外進出を検討中の企業からのリード（問い合わせ）を継続的に獲得できるサービスです。
1. マッチング: 海外ビジネスの問い合わせをサポート企業へ紹介。平均10社/月のリード提供実績。
2. プロモーション: セミナー集客、リード獲得、資料ダウンロード等の促進施策。
3. 海外ビジネスEXPO: 展示会・セミナー登壇サービス。

【会員属性】
- 会社規模: 50名以下63%、大手企業（1000名以上）約10%
- 役職: 代表者33%、役員10%、部長・課長22% → 約7割が決裁権者
- 業種: 卸売・小売25%、製造21%、IT・通信15%、サービス14%
`;

const MEETING_LINK = 'https://meetings-na2.hubspot.com/yuto-hiramatsu/mailmtg';

function buildPrompt(lead: Record<string, string>, templateType: string): string {
  const leadInfo = `
【送信先リード情報】
- 会社名: ${lead.company_name || '不明'}
- 担当者名: ${lead.contact_name || '不明'}
- 業種: ${lead.industry || '不明'}
- 問い合わせ内容: ${lead.inquiry_content || 'なし'}
- HP: ${lead.homepage || 'なし'}
- メモ: ${lead.memo || 'なし'}
`;

  const templates: Record<string, string> = {
    reapproach: `過去問い合わせ企業への再アプローチメール:
- 冒頭で「以前はDigima〜出島〜へお問い合わせいただきありがとうございました。」と感謝
- 以前の問い合わせ内容や関心領域に触れる
- Digimaに有料掲載で獲得できるリードの質を具体的に説明
- 「改めてサービス内容と料金体系をご説明させていただければ」と面談提案
- 末尾に日程調整リンク: ${MEETING_LINK}
- 200〜300文字程度`,
    initial: `初回アプローチメール:
- 相手企業の課題を仮説立てし、Digimaの有料サービスで解決できることを提案
- 具体的な数字（会員2.8万社、決裁権者7割等）を使って説明
- 末尾に日程調整リンク: ${MEETING_LINK}
- 200〜300文字程度`,
  };

  return `${DIGIMA_CONTEXT}
${leadInfo}

【作成するメール】
${templates[templateType] || templates.reapproach}

【構造】
1. 宛名: 「{会社名}\\n{担当者名}様」（不明なら「ご担当者様」）
2. 挨拶 → 名乗り「株式会社Resorzの平松と申します。」 → 本題 → 締め

【ルール】
- 丁寧なビジネスメール文体
- 「協業」「提携」「情報交換」は絶対使わない
- 「先日」は使わず「以前」を使う
- 署名は含めない

以下の形式で出力:
件名: （ここに件名）

（ここに本文）`;
}

// POST: Generate email queue for selected leads
export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY未設定' }, { status: 500 });
  }

  const { action, lead_source, template_type, limit: maxLeads } = await request.json();

  if (action === 'generate') {
    const supabase = createAdminClient();
    const client = new Anthropic({ apiKey });

    // Fetch leads - exclude dnc/duplicate/excluded
    let query = supabase
      .from('leads')
      .select('*')
      .not('status', 'in', '("dnc","duplicate","excluded")');

    if (lead_source) {
      query = query.eq('lead_source', lead_source);
    }

    // Require email address, sort by priority A>B>C>empty then by created_at
    const { data: leads, error: queryError } = await query
      .not('email', 'eq', '')
      .not('email', 'is', null)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(maxLeads || 50);

    if (queryError) {
      return NextResponse.json({ error: `DB検索エラー: ${queryError.message}`, generated: 0 });
    }

    if (!leads || leads.length === 0) {
      // Count total leads to help debug
      const { count: totalLeads } = await supabase.from('leads').select('*', { count: 'exact', head: true });
      const { count: withEmail } = await supabase.from('leads').select('*', { count: 'exact', head: true }).not('email', 'eq', '').not('email', 'is', null);
      return NextResponse.json({
        error: `対象のリードが見つかりません（全${totalLeads}件中メールあり${withEmail}件）`,
        generated: 0
      });
    }

    // Check which leads already have pending/approved emails
    const leadIds = leads.map(l => l.id);
    const { data: existing } = await supabase
      .from('email_queue')
      .select('lead_id')
      .in('lead_id', leadIds)
      .in('status', ['pending', 'approved']);

    const existingIds = new Set((existing || []).map(e => e.lead_id));
    const newLeads = leads.filter(l => !existingIds.has(l.id));

    if (newLeads.length === 0) {
      return NextResponse.json({ message: '全て生成済みです', generated: 0 });
    }

    const tType = template_type || 'reapproach';
    let generated = 0;
    const errors: string[] = [];

    for (const lead of newLeads) {
      try {
        const prompt = buildPrompt(lead, tType);
        const message = await client.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        });

        const text = message.content[0].type === 'text' ? message.content[0].text : '';
        let subject = '';
        let emailBody = text;

        const subjectMatch = text.match(/^件名[:：]\s*(.+?)(?:\n|$)/m);
        if (subjectMatch) {
          subject = subjectMatch[1].trim();
          emailBody = text.slice(subjectMatch.index! + subjectMatch[0].length).trim();
        }
        if (!subject) {
          subject = `【Digima〜出島〜】リード獲得サービスのご案内 - ${lead.company_name}`;
        }

        await supabase.from('email_queue').insert({
          lead_id: lead.id,
          subject,
          body: emailBody,
          template_type: tType,
          status: 'pending',
        });

        generated++;
      } catch (e) {
        errors.push(`${lead.company_name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Count remaining eligible leads
    let countQuery = supabase
      .from('leads')
      .select('id', { count: 'exact', head: false })
      .not('status', 'in', '("dnc","duplicate","excluded")')
      .not('email', 'eq', '')
      .not('email', 'is', null);
    if (lead_source) countQuery = countQuery.eq('lead_source', lead_source);
    const { data: allEligible } = await countQuery;

    const { data: allQueued } = await supabase
      .from('email_queue')
      .select('lead_id')
      .in('status', ['pending', 'approved', 'sent']);
    const queuedIds = new Set((allQueued || []).map(e => e.lead_id));
    const remaining = (allEligible || []).filter(l => !queuedIds.has(l.id)).length - generated;

    return NextResponse.json({ generated, total: newLeads.length, remaining: Math.max(0, remaining), errors });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// PATCH: Update queue item status
export async function PATCH(request: NextRequest) {
  const { id, status, subject, body } = await request.json();
  const supabase = createAdminClient();

  const updateData: Record<string, unknown> = { status };
  if (subject !== undefined) updateData.subject = subject;
  if (body !== undefined) updateData.body = body;

  const { error } = await supabase
    .from('email_queue')
    .update(updateData)
    .eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

// DELETE: Clear queue items
export async function DELETE(request: NextRequest) {
  const { status } = await request.json();
  const supabase = createAdminClient();

  let query = supabase.from('email_queue').delete();
  if (status) {
    query = query.eq('status', status);
  }
  await query.neq('status', 'sent'); // Never delete sent records

  return NextResponse.json({ success: true });
}
