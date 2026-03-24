import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

async function fetchPageContent(url: string): Promise<string> {
  try {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    const res = await fetch(fullUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return '';
    const html = await res.text();
    // Extract text content, strip tags
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.substring(0, 3000);
  } catch {
    return '';
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY未設定' }, { status: 500 });
  }

  const { lead } = await request.json();

  let hpContent = '';
  if (lead.homepage) {
    hpContent = await fetchPageContent(lead.homepage);
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `あなたはDigima〜出島〜の営業担当です。Digima〜出島〜は日本企業の海外進出を支援するBtoBプラットフォームで、サポート企業（海外進出支援を行う企業）に対して有料のプロモーションサービス（広告出稿、セミナー集客、リード獲得など）を販売しています。

以下のリード情報から、このリードが有料会員になる可能性を判定してください。

【判定基準】
A: 有料サービス（広告出稿・セミナー集客・リード獲得）に興味がある、予算がありそう、具体的な施策を相談している、海外進出支援を事業として行っている企業
B: 興味はありそうだが具体性に欠ける、資料請求のみ、情報収集段階、海外関連の事業はあるが支援業ではない
C: 無料利用のみの意向、営業お断り、自社サービスの売り込み、相互リンク依頼、海外進出と無関係な事業

【リード情報】
- 会社名: ${lead.company_name || '不明'}
- 問い合わせ内容: ${lead.inquiry_content || 'なし'}
- 流入経路: ${lead.lead_source || '不明'}
- HP: ${lead.homepage || 'なし'}
${hpContent ? `- HP内容（抜粋）: ${hpContent.substring(0, 2000)}` : ''}

以下の形式で回答してください:
優先度: (A/B/C)
理由: (1-2文で簡潔に)`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const priorityMatch = text.match(/優先度[:：]\s*([ABCabc])/);
    const reasonMatch = text.match(/理由[:：]\s*(.+)/);

    const priority = priorityMatch ? priorityMatch[1].toUpperCase() : 'B';
    const reason = reasonMatch ? reasonMatch[1].trim() : '';

    return NextResponse.json({ priority, reason });
  } catch (error) {
    console.error('Priority classification error:', error);
    return NextResponse.json({ error: '判定に失敗しました' }, { status: 500 });
  }
}
