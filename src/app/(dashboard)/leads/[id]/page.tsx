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
  PRIORITY_COLORS,
  INDUSTRY_OPTIONS,
  COMPANY_SIZE_OPTIONS,
  OVERSEAS_INTEREST_OPTIONS,
} from '@/lib/types';

const supabase = createClient();

export default function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [lead, setLead] = useState<Lead | null>(null);
  const [callLogs, setCallLogs] = useState<CallLog[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'info' | 'history' | 'hubspot'>('info');

  // Call recording
  const [memo, setMemo] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [recording, setRecording] = useState(false);

  // Edit form
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    company_name: '',
    phone: '',
    contact_name: '',
    email: '',
    homepage: '',
    status: '' as LeadStatus,
    priority: '' as string,
    assigned_to: '' as string | null,
    memo: '',
    industry: '',
    company_size: '',
    overseas_interest: '',
    target_countries: '',
    inquiry_content: '',
    lead_source: '',
  });
  const [saving, setSaving] = useState(false);

  // HubSpot emails
  const [hsEmails, setHsEmails] = useState<{ id: string; subject: string; bodyPreview: string; direction: string; timestamp: string }[]>([]);
  const [hsEmailLoading, setHsEmailLoading] = useState(false);

  const loadLead = useCallback(async () => {
    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('id', id)
      .single();
    if (data) {
      setLead(data);
      setNextDate(data.next_activity_date || '');
      setEditForm({
        company_name: data.company_name,
        phone: data.phone,
        contact_name: data.contact_name || '',
        email: data.email || '',
        homepage: data.homepage || '',
        status: data.status,
        priority: data.priority || '',
        assigned_to: data.assigned_to,
        memo: data.memo || '',
        industry: data.industry || '',
        company_size: data.company_size || '',
        overseas_interest: data.overseas_interest || '',
        target_countries: data.target_countries || '',
        inquiry_content: data.inquiry_content || '',
        lead_source: data.lead_source || '',
      });
    }
  }, [id]);

  const loadCallLogs = useCallback(async () => {
    const { data } = await supabase
      .from('call_logs')
      .select('*')
      .eq('lead_id', id)
      .order('called_at', { ascending: false });
    setCallLogs(data || []);
  }, [id]);

  const loadProfiles = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*');
    setProfiles(data || []);
  }, []);

  useEffect(() => {
    const init = async () => {
      await Promise.all([loadLead(), loadCallLogs(), loadProfiles()]);
      setLoading(false);
    };
    init();
  }, [loadLead, loadCallLogs, loadProfiles]);

  const loadHsEmails = useCallback(async () => {
    if (!lead) return;
    setHsEmailLoading(true);
    try {
      const params = new URLSearchParams();
      if (lead.company_name) params.set('company', lead.company_name);
      if (lead.email) params.set('email', lead.email);
      const res = await fetch(`/api/hubspot-activities?${params}`);
      const data = await res.json();
      setHsEmails(data.activities || []);
    } catch { /* ignore */ }
    setHsEmailLoading(false);
  }, [lead]);

  useEffect(() => {
    if (activeTab === 'hubspot' && lead) {
      loadHsEmails();
    }
  }, [activeTab, lead, loadHsEmails]);

  const handleRecordCall = async (result: CallResult) => {
    if (recording) return;
    setRecording(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRecording(false); return; }

    await supabase.from('call_logs').insert({
      lead_id: id,
      caller_id: user.id,
      result,
      memo,
      activity_type: result === 'email_sent' ? 'email' : 'call',
    });

    let newStatus: LeadStatus = lead?.status || 'new';
    if (result === 'appointment') newStatus = 'appointment';
    else if (result === 'connected') newStatus = 'contacted';
    else if (result === 'invalid') newStatus = 'excluded';
    else if (result === 'rejected') newStatus = 'dnc';
    else if (newStatus === 'new') newStatus = 'calling';

    await supabase
      .from('leads')
      .update({ status: newStatus, next_activity_date: nextDate || null })
      .eq('id', id);

    setMemo('');
    await Promise.all([loadLead(), loadCallLogs()]);
    setRecording(false);
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    await supabase
      .from('leads')
      .update({
        company_name: editForm.company_name,
        phone: editForm.phone,
        contact_name: editForm.contact_name,
        email: editForm.email,
        homepage: editForm.homepage,
        status: editForm.status,
        priority: editForm.priority || null,
        assigned_to: editForm.assigned_to || null,
        memo: editForm.memo,
        industry: editForm.industry,
        company_size: editForm.company_size,
        overseas_interest: editForm.overseas_interest,
        target_countries: editForm.target_countries,
        inquiry_content: editForm.inquiry_content,
        lead_source: editForm.lead_source,
      })
      .eq('id', id);
    setEditing(false);
    setSaving(false);
    loadLead();
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

  const assignedProfile = profiles.find(p => p.id === lead.assigned_to);

  return (
    <div className="flex flex-col h-full">
      {/* Top fixed header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4 flex-shrink-0">
        <button
          onClick={() => router.push('/leads')}
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-gray-800 truncate">{lead.company_name}</h1>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <a
              href={`tel:${lead.phone}`}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              {lead.phone}
            </a>
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${LEAD_STATUS_COLORS[lead.status]}`}>
              {LEAD_STATUS_LABELS[lead.status]}
            </span>
            {lead.priority && (
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[lead.priority] || 'bg-gray-100 text-gray-800'}`}>
                優先度: {lead.priority}
              </span>
            )}
            {lead.hs_deal_exists !== null && lead.hs_deal_exists !== undefined && (
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${lead.hs_deal_exists ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                HubSpot: {lead.hs_deal_exists ? `商談あり${lead.hs_deal_owner ? ` (${lead.hs_deal_owner})` : ''}` : '商談なし'}
              </span>
            )}
            <span className="text-xs text-gray-400">担当: {assignedProfile?.name || '未割当'}</span>
          </div>
        </div>
      </div>

      {/* Body: 2-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column: call recording (sticky) */}
        <div className="w-80 flex-shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
          <div className="p-4 space-y-4">
            <div>
              <h2 className="text-xs font-semibold text-gray-700 mb-2">架電結果を記録</h2>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="通話メモ..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none mb-2"
              />
              <div className="mb-3">
                <label className="block text-xs text-gray-500 mb-1">次回架電予定日</label>
                <input
                  type="date"
                  value={nextDate}
                  onChange={(e) => setNextDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>
              <p className="text-[10px] text-gray-400 mb-1">架電</p>
              <div className="grid grid-cols-2 gap-1.5 mb-2">
                {(Object.keys(CALL_RESULT_LABELS) as CallResult[]).filter(r => r !== 'email_sent').map((result) => (
                  <button
                    key={result}
                    onClick={() => handleRecordCall(result)}
                    disabled={recording}
                    className={`py-2 px-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${CALL_RESULT_COLORS[result]}`}
                  >
                    {CALL_RESULT_LABELS[result]}
                  </button>
                ))}
              </div>
              <button
                onClick={() => handleRecordCall('email_sent')}
                disabled={recording}
                className={`w-full py-2 px-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${CALL_RESULT_COLORS.email_sent}`}
              >
                {CALL_RESULT_LABELS.email_sent}
              </button>
            </div>

            {/* Quick status */}
            <div>
              <h2 className="text-xs font-semibold text-gray-700 mb-2">ステータス変更</h2>
              <select
                value={lead.status}
                onChange={async (e) => {
                  await supabase.from('leads').update({ status: e.target.value as LeadStatus }).eq('id', id);
                  loadLead();
                }}
                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
              >
                {Object.entries(LEAD_STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Right column: tabs */}
        <div className="flex-1 overflow-y-auto">
          {/* Tab bar */}
          <div className="border-b border-gray-200 bg-white px-6 flex gap-0">
            {[
              { key: 'info', label: '企業情報' },
              { key: 'history', label: `履歴 (${callLogs.length})` },
              { key: 'hubspot', label: 'HubSpot' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-slate-800 text-slate-800'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="p-6">
            {/* 企業情報 tab */}
            {activeTab === 'info' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-gray-800">企業情報</h2>
                  <button
                    onClick={() => setEditing(!editing)}
                    className="text-xs px-3 py-1 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    {editing ? 'キャンセル' : '編集'}
                  </button>
                </div>

                {editing ? (
                  <div className="space-y-3">
                    {[
                      { key: 'company_name', label: '会社名', type: 'text' },
                      { key: 'phone', label: '電話番号', type: 'text' },
                      { key: 'contact_name', label: '担当者名', type: 'text' },
                      { key: 'email', label: 'メール', type: 'email' },
                      { key: 'homepage', label: 'HP', type: 'url' },
                    ].map(field => (
                      <div key={field.key}>
                        <label className="block text-xs text-gray-500 mb-1">{field.label}</label>
                        <input
                          type={field.type}
                          value={(editForm as Record<string, string>)[field.key] || ''}
                          onChange={(e) => setEditForm({ ...editForm, [field.key]: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                        />
                      </div>
                    ))}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">問い合わせ内容</label>
                      <textarea
                        value={editForm.inquiry_content}
                        onChange={(e) => setEditForm({ ...editForm, inquiry_content: e.target.value })}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">業種</label>
                      <select
                        value={editForm.industry}
                        onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                      >
                        <option value="">選択してください</option>
                        {INDUSTRY_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">企業規模</label>
                      <select
                        value={editForm.company_size}
                        onChange={(e) => setEditForm({ ...editForm, company_size: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                      >
                        <option value="">選択してください</option>
                        {COMPANY_SIZE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">海外展開への関心</label>
                      <select
                        value={editForm.overseas_interest}
                        onChange={(e) => setEditForm({ ...editForm, overseas_interest: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
                      >
                        <option value="">選択してください</option>
                        {OVERSEAS_INTEREST_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">メモ</label>
                      <textarea
                        value={editForm.memo}
                        onChange={(e) => setEditForm({ ...editForm, memo: e.target.value })}
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
                  <div className="grid grid-cols-2 gap-4">
                    <InfoRow label="会社名" value={lead.company_name} />
                    <InfoRow label="電話番号" value={lead.phone} />
                    <InfoRow label="担当者名" value={lead.contact_name || '-'} />
                    <InfoRow label="メール" value={lead.email || '-'} />
                    <div>
                      <p className="text-xs text-gray-400">HP</p>
                      {lead.homepage ? (
                        <a href={lead.homepage.startsWith('http') ? lead.homepage : `https://${lead.homepage}`} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline mt-0.5 block truncate">
                          {lead.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      ) : <p className="text-sm text-gray-800 mt-0.5">-</p>}
                    </div>
                    <InfoRow label="業種" value={lead.industry || '-'} />
                    <InfoRow label="企業規模" value={lead.company_size || '-'} />
                    <InfoRow label="海外展開への関心" value={lead.overseas_interest || '-'} />
                    <InfoRow label="対象国・地域" value={lead.target_countries || '-'} />
                    <InfoRow label="担当者" value={assignedProfile?.name || '未割当'} />
                    {lead.inquiry_content && (
                      <div className="col-span-2">
                        <InfoRow label="問い合わせ内容" value={lead.inquiry_content} />
                      </div>
                    )}
                    {lead.memo && (
                      <div className="col-span-2">
                        <InfoRow label="メモ" value={lead.memo} />
                      </div>
                    )}
                    <InfoRow label="作成日" value={new Date(lead.created_at).toLocaleDateString('ja-JP')} />
                  </div>
                )}
              </div>
            )}

            {/* 履歴 tab */}
            {activeTab === 'history' && (
              <div>
                <h2 className="text-sm font-semibold text-gray-800 mb-4">架電・メール履歴</h2>
                {callLogs.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-8">まだ履歴がありません</p>
                ) : (
                  <div className="space-y-4">
                    {callLogs.map((log, idx) => (
                      <div key={log.id} className={`flex items-start gap-3 border-l-2 pl-4 py-1 ${idx < 5 ? 'border-slate-400' : 'border-gray-200'}`}>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${CALL_RESULT_COLORS[log.result].replace(/hover:\S+/g, '')}`}>
                              {CALL_RESULT_LABELS[log.result]}
                            </span>
                            <span className="text-xs text-gray-400">{log.profiles?.name || ''}</span>
                          </div>
                          {log.memo && <p className="text-sm text-gray-600 mt-1">{log.memo}</p>}
                        </div>
                        <span className="text-xs text-gray-400 whitespace-nowrap">
                          {new Date(log.called_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* HubSpot tab */}
            {activeTab === 'hubspot' && (
              <div>
                <h2 className="text-sm font-semibold text-gray-800 mb-4">HubSpot情報</h2>
                <div className="space-y-3 mb-6">
                  <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="text-xs text-gray-500">商談ステータス</p>
                    <p className="text-sm font-medium mt-0.5">
                      {lead.hs_deal_exists === true ? (
                        <span className="text-red-600">商談あり</span>
                      ) : lead.hs_deal_exists === false ? (
                        <span className="text-green-600">商談なし</span>
                      ) : '未確認'}
                    </p>
                    {lead.hs_deal_owner && <p className="text-xs text-gray-600 mt-1">担当: {lead.hs_deal_owner}</p>}
                    {lead.hs_deal_created_at && <p className="text-xs text-gray-600">取引作成日: {new Date(lead.hs_deal_created_at).toLocaleDateString('ja-JP')}</p>}
                    {lead.hs_listing_plan && <p className="text-xs text-gray-600">掲載プラン: {lead.hs_listing_plan}</p>}
                    {lead.hs_checked_at && <p className="text-[10px] text-gray-400 mt-1">最終チェック: {new Date(lead.hs_checked_at).toLocaleString('ja-JP')}</p>}
                  </div>
                </div>

                <h3 className="text-xs font-semibold text-gray-700 mb-3">メール履歴</h3>
                {hsEmailLoading ? (
                  <p className="text-sm text-gray-400">読み込み中...</p>
                ) : hsEmails.length === 0 ? (
                  <p className="text-sm text-gray-400">HubSpotのメール履歴がありません</p>
                ) : (
                  <div className="space-y-3">
                    {hsEmails.map(email => (
                      <div key={email.id} className="border border-gray-200 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-gray-800">{email.subject || '(件名なし)'}</p>
                          <span className="text-xs text-gray-400 whitespace-nowrap">
                            {new Date(email.timestamp).toLocaleDateString('ja-JP')}
                          </span>
                        </div>
                        {email.bodyPreview && (
                          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{email.bodyPreview}</p>
                        )}
                        <span className={`mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded ${email.direction === 'OUTGOING' ? 'bg-blue-50 text-blue-600' : 'bg-green-50 text-green-600'}`}>
                          {email.direction === 'OUTGOING' ? '送信' : '受信'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
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
      <p className="text-sm text-gray-800 mt-0.5 break-words">{value}</p>
    </div>
  );
}
