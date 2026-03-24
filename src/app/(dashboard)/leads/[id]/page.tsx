'use client';

import { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import type { Lead, CallLog, CallResult, Profile, LeadStatus } from '@/lib/types';
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_COLORS,
  CALL_RESULT_LABELS,
  CALL_RESULT_COLORS,
  INDUSTRY_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  OVERSEAS_INTEREST_OPTIONS,
} from '@/lib/types';

type EmailTemplateType = 'initial' | 'followup' | 'appointment';

const EMAIL_TEMPLATE_LABELS: Record<EmailTemplateType, string> = {
  initial: '初回アプローチ',
  followup: 'フォローアップ',
  appointment: 'アポイント依頼',
};

export default function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [lead, setLead] = useState<Lead | null>(null);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [memo, setMemo] = useState('');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    company_name: '',
    phone: '',
    contact_name: '',
    homepage: '',
    status: '' as LeadStatus,
    assigned_to: '' as string | null,
    memo: '',
    industry: '',
    company_size: '',
    overseas_interest: '',
    target_countries: '',
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // AI Email state
  const [emailTemplateType, setEmailTemplateType] = useState<EmailTemplateType>('initial');
  const [generatedSubject, setGeneratedSubject] = useState('');
  const [generatedBody, setGeneratedBody] = useState('');
  const [generating, setGenerating] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [copied, setCopied] = useState(false);

  const router = useRouter();
  const supabase = createClient();

  const loadLead = useCallback(async () => {
    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .single();

    if (data) {
      setLead(data);
      setEditForm({
        company_name: data.company_name,
        phone: data.phone,
        contact_name: data.contact_name || '',
        homepage: data.homepage || '',
        status: data.status,
        assigned_to: data.assigned_to,
        memo: data.memo || '',
        industry: data.industry || '',
        company_size: data.company_size || '',
        overseas_interest: data.overseas_interest || '',
        target_countries: data.target_countries || '',
      });
    }
  }, [id, supabase]);

  const loadCallLogs = useCallback(async () => {
    const { data } = await supabase
      .from('call_logs')
      .select('*')
      .eq('lead_id', id)
      .order('called_at', { ascending: false });

    setCallLogs(data || []);
  }, [id, supabase]);

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*');
    setProfiles(data || []);
  }, [supabase]);

  useEffect(() => {
    const init = async () => {
      await Promise.all([loadLead(), loadCallLogs(), loadProfiles()]);
      setLoading(false);
    };
    init();
  }, [loadLead, loadCallLogs, loadProfiles]);

  const handleRecordCall = async (result: CallResult) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('call_logs').insert({
      lead_id: id,
      caller_id: user.id,
      result,
      memo,
    });

    let newStatus: LeadStatus = lead?.status || 'new';
    if (result === 'appointment') {
      newStatus = 'appointment';
    } else if (result === 'connected') {
      newStatus = 'contacted';
    } else if (result === 'invalid') {
      newStatus = 'excluded';
    } else if (result === 'rejected') {
      newStatus = 'dnc';
    } else if (newStatus === 'new') {
      newStatus = 'calling';
    }

    await supabase
      .from('leads')
      .update({ status: newStatus })
      .eq('id', id);

    setMemo('');
    loadLead();
    loadCallLogs();
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    await supabase
      .from('leads')
      .update({
        company_name: editForm.company_name,
        phone: editForm.phone,
        contact_name: editForm.contact_name,
        homepage: editForm.homepage,
        status: editForm.status,
        assigned_to: editForm.assigned_to || null,
        memo: editForm.memo,
        industry: editForm.industry,
        company_size: editForm.company_size,
        overseas_interest: editForm.overseas_interest,
        target_countries: editForm.target_countries,
      })
      .eq('id', id);

    setEditing(false);
    setSaving(false);
    loadLead();
  };

  const handleGenerateEmail = async () => {
    if (!lead) return;
    setGenerating(true);
    setEmailError('');
    setGeneratedSubject('');
    setGeneratedBody('');

    try {
      const res = await fetch('/api/generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead: {
            company_name: lead.company_name,
            contact_name: lead.contact_name,
            industry: lead.industry,
            company_size: lead.company_size,
            overseas_interest: lead.overseas_interest,
            target_countries: lead.target_countries,
            inquiry_content: lead.inquiry_content,
            homepage: lead.homepage,
            memo: lead.memo,
          },
          template_type: emailTemplateType,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setEmailError(data.error || 'エラーが発生しました');
        return;
      }

      setGeneratedSubject(data.subject);
      setGeneratedBody(data.body);
    } catch {
      setEmailError('通信エラーが発生しました');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyEmail = async () => {
    const fullEmail = `件名: ${generatedSubject}\n\n${generatedBody}`;
    await navigator.clipboard.writeText(fullEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">リードが見つかりません</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push('/leads')}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-800">
            {lead.company_name}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${LEAD_STATUS_COLORS[lead.status]}`}
            >
              {LEAD_STATUS_LABELS[lead.status]}
            </span>
            <span className="text-sm text-gray-400">
              担当: {lead.profiles?.name || '未割当'}
            </span>
          </div>
        </div>
        <button
          onClick={() => setEditing(!editing)}
          className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          {editing ? 'キャンセル' : '編集'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Lead Info */}
        <div className="col-span-1 space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">
              リード情報
            </h2>
            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    会社名
                  </label>
                  <input
                    type="text"
                    value={editForm.company_name}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        company_name: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    電話番号
                  </label>
                  <input
                    type="text"
                    value={editForm.phone}
                    onChange={(e) =>
                      setEditForm({ ...editForm, phone: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    担当者名
                  </label>
                  <input
                    type="text"
                    value={editForm.contact_name}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        contact_name: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    HP
                  </label>
                  <input
                    type="url"
                    value={editForm.homepage}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        homepage: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="https://example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    業種
                  </label>
                  <select
                    value={editForm.industry}
                    onChange={(e) =>
                      setEditForm({ ...editForm, industry: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                  >
                    <option value="">選択してください</option>
                    {INDUSTRY_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    企業規模
                  </label>
                  <select
                    value={editForm.company_size}
                    onChange={(e) =>
                      setEditForm({ ...editForm, company_size: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                  >
                    <option value="">選択してください</option>
                    {COMPANY_SIZE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    海外展開への関心
                  </label>
                  <select
                    value={editForm.overseas_interest}
                    onChange={(e) =>
                      setEditForm({ ...editForm, overseas_interest: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                  >
                    <option value="">選択してください</option>
                    {OVERSEAS_INTEREST_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    対象国・地域
                  </label>
                  <input
                    type="text"
                    value={editForm.target_countries}
                    onChange={(e) =>
                      setEditForm({ ...editForm, target_countries: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="例: 東南アジア、アメリカ"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    ステータス
                  </label>
                  <select
                    value={editForm.status}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        status: e.target.value as LeadStatus,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                  >
                    {Object.entries(LEAD_STATUS_LABELS).map(
                      ([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      )
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    架電担当
                  </label>
                  <select
                    value={editForm.assigned_to || ''}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        assigned_to: e.target.value || null,
                      })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                  >
                    <option value="">未割当</option>
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">
                    メモ
                  </label>
                  <textarea
                    value={editForm.memo}
                    onChange={(e) =>
                      setEditForm({ ...editForm, memo: e.target.value })
                    }
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none"
                  />
                </div>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="w-full py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <InfoRow label="会社名" value={lead.company_name} />
                <InfoRow label="電話番号" value={lead.phone} />
                <InfoRow
                  label="担当者名"
                  value={lead.contact_name || '-'}
                />
                <div>
                  <p className="text-xs text-gray-400">HP</p>
                  {lead.homepage ? (
                    <a
                      href={lead.homepage.startsWith('http') ? lead.homepage : `https://${lead.homepage}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline mt-0.5 block"
                    >
                      {lead.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </a>
                  ) : (
                    <p className="text-sm text-gray-800 mt-0.5">-</p>
                  )}
                </div>
                <InfoRow label="業種" value={lead.industry || '-'} />
                <InfoRow label="企業規模" value={lead.company_size || '-'} />
                <InfoRow label="海外展開への関心" value={lead.overseas_interest || '-'} />
                <InfoRow label="対象国・地域" value={lead.target_countries || '-'} />
                <InfoRow
                  label="架電担当"
                  value={lead.profiles?.name || '未割当'}
                />
                <InfoRow
                  label="メモ"
                  value={lead.memo || '-'}
                />
                <InfoRow
                  label="作成日"
                  value={new Date(lead.created_at).toLocaleDateString(
                    'ja-JP'
                  )}
                />
              </div>
            )}
          </div>
        </div>

        {/* Call Recording, AI Email & History */}
        <div className="col-span-2 space-y-6">
          {/* Call Result Recording */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">
              架電結果を記録
            </h2>
            <div className="grid grid-cols-6 gap-2 mb-4">
              {(Object.keys(CALL_RESULT_LABELS) as CallResult[]).map(
                (result) => (
                  <button
                    key={result}
                    onClick={() => handleRecordCall(result)}
                    className={`py-3 px-2 rounded-lg text-sm font-medium transition-colors ${CALL_RESULT_COLORS[result]}`}
                  >
                    {CALL_RESULT_LABELS[result]}
                  </button>
                )
              )}
            </div>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="通話メモを入力..."
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none"
            />
          </div>

          {/* AI Email Generation */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                AI メール生成
              </h2>
              <div className="flex bg-gray-100 rounded-lg overflow-hidden">
                {(Object.keys(EMAIL_TEMPLATE_LABELS) as EmailTemplateType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setEmailTemplateType(type)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      emailTemplateType === type
                        ? 'bg-slate-800 text-white'
                        : 'text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {EMAIL_TEMPLATE_LABELS[type]}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleGenerateEmail}
              disabled={generating}
              className="w-full py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-medium rounded-lg hover:from-amber-600 hover:to-orange-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  生成中...
                </span>
              ) : (
                `${EMAIL_TEMPLATE_LABELS[emailTemplateType]}メールを生成`
              )}
            </button>

            {emailError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {emailError}
              </div>
            )}

            {generatedSubject && (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">件名</label>
                  <input
                    type="text"
                    value={generatedSubject}
                    onChange={(e) => setGeneratedSubject(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">本文</label>
                  <textarea
                    value={generatedBody}
                    onChange={(e) => setGeneratedBody(e.target.value)}
                    rows={10}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCopyEmail}
                    className="flex-1 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors"
                  >
                    {copied ? 'コピーしました!' : 'クリップボードにコピー'}
                  </button>
                  <button
                    onClick={handleGenerateEmail}
                    disabled={generating}
                    className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    再生成
                  </button>
                </div>
                {lead.email && (
                  <a
                    href={`mailto:${lead.email}?subject=${encodeURIComponent(generatedSubject)}&body=${encodeURIComponent(generatedBody)}`}
                    className="block w-full py-2 text-center bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    メールアプリで開く
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Call History */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">
              架電履歴
            </h2>
            {callLogs.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">
                まだ架電履歴がありません
              </p>
            ) : (
              <div className="space-y-4">
                {callLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 border-l-2 border-gray-200 pl-4 py-1"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            CALL_RESULT_COLORS[log.result].replace(
                              /hover:\S+/g,
                              ''
                            )
                          }`}
                        >
                          {CALL_RESULT_LABELS[log.result]}
                        </span>
                        <span className="text-xs text-gray-400">
                          {log.profiles?.name}
                        </span>
                      </div>
                      {log.memo && (
                        <p className="text-sm text-gray-600 mt-1">
                          {log.memo}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {new Date(log.called_at).toLocaleString('ja-JP', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}
