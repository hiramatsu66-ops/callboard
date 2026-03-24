import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const DIGIMA_CONTEXT = `
あなたは株式会社Resorzの営業担当です。「Digima〜出島〜」というサービスを提案するメールを作成します。

【Digima〜出島〜とは】
日本企業の海外進出を支援する、海外ビジネスに特化したBtoBメディア・プラットフォームです。
- ミッション: 「グローバル市場で成功する日本企業を10,000社つくる」
- 運営: 株式会社Resorz（2009年創業）
- 月間50万PV、会員数2.8万人（海外進出を検討している企業）、月間問い合わせ100件以上

【サポート企業向け4つのサービス】
1. マッチング: 海外ビジネスの問い合わせをサポート企業へ紹介。成果報酬型でリード送客。平均10社/月、最高30社/月のリード提供。
2. プロモーション: 商談獲得をゴールとしたセミナー集客、リード獲得、資料ダウンロード等の促進施策。
3. 海外ビジネスEXPO: リード獲得・商談獲得を目指す展示会・セミナー登壇サービス（オフライン4回・オンライン1回/年）。
4. 政府・自治体案件: 自治体の海外展開支援事業にて域内企業へのマッチング等を実施。

【会員属性】
- 会社規模: 50名以下63%、中小企業が中心だが大手企業（1000名以上）も約10%
- 役職: 代表者33%、役員10%、部長・課長22% → 約7割が決裁権者
- 業種: 卸売・小売25%、製造21%、IT・通信15%、サービス14%

【サポート企業にとってのメリット】
- 海外進出を検討中の質の高いリードを安定的に獲得できる
- 情報収集段階のリードに早期にアプローチできる
- 月間50万PVのメディアで自社サービスの認知を拡大できる
- 自社事業紹介ページ、サービス資料掲載、セミナー掲載、ノウハウ記事掲載で多面的にアプローチ可能
- フリープランから始められる（サービス資料1件掲載無料）
`;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lead, template_type } = body;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY が設定されていません。.env.local に追加してください。' },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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

    const templateInstructions: Record<string, string> = {
      initial: `初回アプローチメール:
- 相手企業の業種や海外展開への関心に触れ、共感を示す
- Digima〜出島〜がどのように役立つか簡潔に説明
- 具体的なアクション（無料相談、資料送付など）を提案
- 200〜300文字程度のメール本文`,
      followup: `フォローアップメール:
- 以前の接触を踏まえた内容
- 新しい情報や価値を提供（セミナー案内、事例紹介など）
- 再度のアポイント打診
- 150〜250文字程度のメール本文`,
      appointment: `アポイント依頼メール:
- 具体的な面談の提案
- 相手にとっての面談メリットを明記
- 候補日時の提示を促す形
- 200〜300文字程度のメール本文`,
      reapproach: `過去問い合わせ企業への再アプローチメール:
- 以前お問い合わせいただいたことへの感謝を述べる
- 前回の問い合わせ内容や関心領域に触れ、覚えていることを示す
- 前回からの新しい情報（新サービス、成功事例、セミナー、市場動向など）を提供し、再度興味を持ってもらう
- 「その後、海外展開のご検討状況はいかがでしょうか」など、現在の状況を自然にヒアリングする
- 短時間の情報交換（15〜30分のオンライン面談など）を提案し、ハードルを下げる
- 押し売り感を出さず、相手の課題解決を軸にする
- 200〜300文字程度のメール本文`,
    };

    const instruction = templateInstructions[template_type] || templateInstructions.initial;

    const prompt = `${DIGIMA_CONTEXT}

${leadInfo}

【作成するメールの種類】
${instruction}

【ルール】
- ビジネスメールとして自然な日本語で書く
- 押し売り感を出さず、相手の課題解決を軸にする
- 相手企業の業種や状況に合わせた具体的な提案を含める
- 件名と本文を分けて出力する
- 署名は含めない（後で追加する）

以下の形式で出力してください:
件名: （ここに件名）

（ここに本文）`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Parse subject and body
    let subject = '';
    let emailBody = text;

    const subjectMatch = text.match(/^件名[:：]\s*(.+?)(?:\n|$)/m);
    if (subjectMatch) {
      subject = subjectMatch[1].trim();
      emailBody = text.slice(subjectMatch.index! + subjectMatch[0].length).trim();
    }

    return NextResponse.json({ subject, body: emailBody });
  } catch (error) {
    console.error('Email generation error:', error);
    return NextResponse.json(
      { error: 'メール生成に失敗しました。しばらくしてから再度お試しください。' },
      { status: 500 }
    );
  }
}
