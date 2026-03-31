import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const HUBSPOT_API = 'https://api.hubapi.com';

interface HubSpotEmail {
  subject: string;
  bodyPreview: string;
  direction: string;
  timestamp: string;
}

async function fetchHubSpotHistory(companyName: string, email: string): Promise<HubSpotEmail[]> {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) return [];

  try {
    // Search by contact email first
    let contactId: number | null = null;
    if (email) {
      const res = await fetch(
        `${HUBSPOT_API}/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        contactId = data.id ? Number(data.id) : null;
      }
    }

    // Get email IDs from associations
    let emailIds: string[] = [];
    if (contactId) {
      const assocRes = await fetch(
        `${HUBSPOT_API}/crm/v3/objects/contacts/${contactId}/associations/emails`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (assocRes.ok) {
        const data = await assocRes.json();
        emailIds = (data.results || []).map((r: Record<string, unknown>) => String(r.id || '')).filter((id: string) => id);
      }
    }

    // Fallback: search by company
    if (emailIds.length === 0 && companyName) {
      const compRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/companies/search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: companyName, properties: ['name'], limit: 5 }),
      });
      if (compRes.ok) {
        const data = await compRes.json();
        const companyId = data.results?.[0]?.id ? Number(data.results[0].id) : null;
        if (companyId) {
          const assocRes = await fetch(
            `${HUBSPOT_API}/crm/v3/objects/companies/${companyId}/associations/emails`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (assocRes.ok) {
            const data = await assocRes.json();
            emailIds = (data.results || []).map((r: Record<string, unknown>) => String(r.id || '')).filter((id: string) => id);
          }
        }
      }
    }

    if (emailIds.length === 0) return [];

    // Fetch email details (up to 20 most recent)
    const batch = emailIds.slice(0, 20);
    const searchRes = await fetch(`${HUBSPOT_API}/crm/v3/objects/emails/search`, {
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
        properties: ['hs_email_subject', 'hs_email_text', 'hs_email_direction', 'hs_timestamp'],
        limit: 20,
      }),
    });

    if (!searchRes.ok) return [];

    const searchData = await searchRes.json();
    const emails: HubSpotEmail[] = (searchData.results || []).map((r: { properties: Record<string, string> }) => ({
      subject: r.properties.hs_email_subject || '(件名なし)',
      bodyPreview: (r.properties.hs_email_text || '').slice(0, 500),
      direction: (r.properties.hs_email_direction || '').includes('INCOMING') ? '相手→自社' : '自社→相手',
      timestamp: r.properties.hs_timestamp || '',
    }));

    // Sort by timestamp descending, return latest 10
    emails.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return emails.slice(0, 10);
  } catch {
    return [];
  }
}

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

1. マッチング（有料会員向け）: 海外ビジネスの問い合わせをサポート企業へ紹介。成果報酬型でリード送客。平均10社/月、最高30社/月のリード提供実績。
2. プロモーション: 商談獲得をゴールとしたセミナー集客、リード獲得、資料ダウンロード等の促進施策。
3. 海外ビジネスEXPO: リード獲得・商談獲得を目指す展示会・セミナー登壇サービス（オフライン4回・オンライン1回/年）。
4. 政府・自治体案件: 自治体の海外展開支援事業にて域内企業へのマッチング等を実施。

【会員属性（＝貴社が獲得できるリードの質）】
- 会社規模: 50名以下63%、中小企業が中心だが大手企業（1000名以上）も約10%
- 役職: 代表者33%、役員10%、部長・課長22% → 約7割が決裁権者
- 業種: 卸売・小売25%、製造21%、IT・通信15%、サービス14%

【提案の核心】
このメールの目的は「貴社のサービスを、海外進出を検討している2.8万社の企業に届けませんか」という有料サービスの提案です。
- 協業・業務提携・情報交換の打診ではない
- 「Digimaに有料でご掲載いただくことで、御社の営業課題（リード獲得・認知拡大）を解決できます」という提案
- 具体的には: サポート企業としてご登録 → 御社の事業紹介ページ掲載 → 会員企業からの問い合わせを御社へ送客
`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lead, template_type } = body;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY が設定されていません。.env.local に追加してください。' },
        { status: 500 }
      );
    }

    const client = new Anthropic({ apiKey });

    const leadInfo = `
【送信先リード情報】
- 会社名: ${lead.company_name || '不明'}
- 担当者名: ${lead.contact_name || '不明'}
- 業種: ${lead.industry || '不明'}
- 企業規模: ${lead.company_size || '不明'}
- 海外展開への関心: ${lead.overseas_interest || '不明'}
- 対象国・地域: ${lead.target_countries || '不明'}
- 問い合わせ内容: ${lead.inquiry_content || 'なし'}
- HP: ${lead.homepage || 'なし'}
- メモ: ${lead.memo || 'なし'}
`;

    const meetingLink = 'https://meetings-na2.hubspot.com/yuto-hiramatsu/mailmtg';

    const templateInstructions: Record<string, string> = {
      initial: `初回アプローチメール（有料サービス提案）:
- 相手企業の業種・HP情報・問い合わせ内容から、その企業が海外進出支援で抱えていそうなリード獲得・認知拡大の課題を具体的に仮説立てする
- Digimaの有料サービス（サポート企業掲載）を導入することで、その課題がどう解決されるかを具体的な数字（会員2.8万社、決裁権者7割、業種構成等）を使って説明する
- 「協業」「提携」「情報交換」のニュアンスは一切出さない。あくまで「弊社サービスのご導入をご提案したい」というトーンで書く
- 「貴社のサービスを、海外進出を検討している企業へ届けるお手伝いができると考えております」という文脈で書く
- 末尾に「具体的なサービス内容や料金体系について、一度ご説明の機会をいただければ幸いです。」と添え、日程調整リンクを記載: ${meetingLink}
- 200〜300文字程度のメール本文`,
      followup: `フォローアップメール（有料サービス提案の追客）:
- 以前の接触を踏まえた内容
- 相手企業のサービスに対して、Digimaに有料掲載することで獲得できるリードの質（会員属性・業種構成）がなぜマッチするか具体的に説明する
- 新しい情報や価値を提供（導入企業の成果事例、直近のセミナー開催予定、市場動向など）
- 「サービスの詳細資料をお送りすることも可能です」など、次のステップを明確に提示する
- 末尾に日程調整リンクを記載: ${meetingLink}
- 150〜250文字程度のメール本文`,
      appointment: `アポイント依頼メール（サービス説明の場を設定）:
- 相手企業のリード獲得・認知拡大の課題を仮説立てし、Digimaの有料サービスがその解決策になることを提示する
- Digimaに有料掲載することで、その企業にとってどんなリードが獲得できるか、会員属性や業種データを根拠に説明する
- 面談のゴールは「サービス内容・料金体系のご説明と、貴社の課題に合わせたプランのご提案」であることを明示する
- 「協業のご相談」「情報交換」ではなく「サービスのご紹介・ご提案」というトーンを徹底する
- 末尾に日程調整リンクを記載: ${meetingLink}
- 200〜300文字程度のメール本文`,
      reapproach: `過去問い合わせ企業への再アプローチメール（有料サービス提案）:
- 冒頭で「以前はDigima〜出島〜へお問い合わせいただきありがとうございました。」と感謝を述べる（「先日」は絶対に使わず「以前」を使う。問い合わせから時間が経っている前提）
- 以前の問い合わせ内容や関心領域に触れ、覚えていることを示す
- 相手企業のサービスに対して、Digimaに有料でご掲載いただくことで獲得できるリードの質（海外進出検討企業2.8万社、決裁権者7割など）を具体的に説明する
- 「その後、海外展開支援のリード獲得についてご検討状況はいかがでしょうか」など、サービス導入に繋がる形でヒアリングする
- 「改めてサービス内容と料金体系をご説明させていただければと考えております」と面談を提案
- 末尾に日程調整リンクを記載: ${meetingLink}
- 押し売り感は出さないが、有料サービスの提案であることは明確にする
- 200〜300文字程度のメール本文`,
    };

    const instruction = templateInstructions[template_type] || templateInstructions.initial;

    // Fetch HubSpot email history for context
    const emailHistory = await fetchHubSpotHistory(lead.company_name || '', lead.email || '');

    let historyContext = '';
    if (emailHistory.length > 0) {
      const historyLines = emailHistory.map((e, i) =>
        `${i + 1}. [${e.timestamp ? new Date(e.timestamp).toLocaleDateString('ja-JP') : '日付不明'}] ${e.direction} | 件名: ${e.subject}\n   内容: ${e.bodyPreview}`
      ).join('\n');

      historyContext = `
【過去のやりとり履歴（HubSpot）】
この企業とは既にメールのやりとりがあります。以下の履歴を踏まえてメールを作成してください。
${historyLines}

【履歴を踏まえた作成ルール】
- 過去のやりとりの内容・文脈を自然に反映させる（「以前ご案内させていただきました〜」「その後ご検討状況は〜」等）
- 前回の話題やテーマとの一貫性を保つ
- 既に伝えた情報を繰り返さず、新しい価値・切り口を提供する
- 相手が返信している場合、その内容に対する応答を含める
- 挨拶は初回ではないので「お世話になっております。」を使う
`;
    }

    const prompt = `${DIGIMA_CONTEXT}

${leadInfo}
${historyContext}
【作成するメールの種類】
${instruction}

【メールの構造（必ずこの順序で書くこと）】
1. 宛名: 「{会社名}\n{担当者名}様」（担当者名が不明な場合は「ご担当者様」）
2. 挨拶: 「お世話になっております。」（初回の場合は「突然のご連絡失礼いたします。」）
3. 名乗り: 「株式会社Resorzの平松と申します。」
4. 本題: メールの種類に応じた内容
5. 締め: 「何卒、よろしくお願いいたします。」

【ルール】
- 丁寧なビジネスメールの文体・敬語を徹底する
- これは有料サービスの営業提案メールである。「協業」「提携」「情報交換」「ご一緒に」等の表現は絶対に使わない
- 「弊社サービスのご導入」「ご掲載」「サービスのご提案」「リード獲得のご支援」等、有料サービスの提案であることが伝わる表現を使う
- ただし押し売り感は出さない。相手企業の課題を仮説立てし、その解決策としてサービスを提案する姿勢で書く
- 相手企業のHP情報・業種・問い合わせ内容を読み解き、その企業に刺さる具体的な提案を含める
- Digimaの会員属性・業種構成・PV数などの数字を、相手にとって意味のある形で引用する（全部羅列しない、刺さるものを選ぶ）
- 「先日」は使わない（問い合わせから時間が経っている前提のため「以前」を使う）
- 件名は「サービスのご案内」「リード獲得のご提案」等、有料サービスの提案であることが分かる内容にする。「協業」「ご相談」は件名にも使わない
- 件名と本文を分けて出力する
- 署名は含めない（後で追加する）

以下の形式で出力してください:
件名: （ここに件名）

（ここに本文）`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';

    if (!text || text.trim().length === 0) {
      return NextResponse.json(
        { error: 'メール生成に失敗しました（空のレスポンス）。再度お試しください。' },
        { status: 500 }
      );
    }

    // Parse subject and body
    let subject = '';
    let emailBody = text;

    const subjectMatch = text.match(/^件名[:：]\s*(.+?)(?:\n|$)/m);
    if (subjectMatch) {
      subject = subjectMatch[1].trim();
      emailBody = text.slice(subjectMatch.index! + subjectMatch[0].length).trim();
    }

    if (!subject) {
      subject = `【Digima〜出島〜】リード獲得サービスのご案内 - ${lead.company_name || ''}`;
    }

    return NextResponse.json({
      subject,
      body: emailBody,
      hasHistory: emailHistory.length > 0,
      historyCount: emailHistory.length,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Email generation error:', errorMessage);
    return NextResponse.json(
      { error: `メール生成でエラーが発生しました: ${errorMessage}` },
      { status: 500 }
    );
  }
}
