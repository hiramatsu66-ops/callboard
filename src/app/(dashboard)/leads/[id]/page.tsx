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
} from '@/lib/types';

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
    status: '' as LeadStatus,
    assigned_to: '' as string | null,
    memo: '',
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const router = useRouter();
  const supabase = createClient();

  const loadLead = useCallback(async () => {
    const { data } = await supabase
      .from('leads')
      .select('*, profiles(*)')
      .eq('id', id)
      .single();

    if (data) {
      setLead(data);
      setEditForm({
        company_name: data.company_name,
        phone: data.phone,
        contact_name: data.contact_name || '',
        status: data.status,
        assigned_to: data.assigned_to,
        memo: data.memo || '',
      });
    }
  }, [id, supabase]);

  const loadCallLogs = useCallback(async () => {
    const { data } = await supabase
      .from('call_logs')
      .select('*, profiles(*)')
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

    // Update lead status based on result
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
        status: editForm.status,
        assigned_to: editForm.assigned_to || null,
        memo: editForm.memo,
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

        {/* Call Recording & History */}
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
