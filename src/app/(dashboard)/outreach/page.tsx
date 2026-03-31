'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { createClient } from '@/lib/supabase';
import { LEAD_SOURCE_LABELS, LEAD_SOURCE_COLORS } from '@/lib/types';
import type { LeadSource } from '@/lib/types';

interface QueueItem {
  id: string;
  lead_id: string;
  subject: string;
  body: string;
  template_type: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  error_message: string | null;
  leads: {
    company_name: string;
    contact_name: string;
    email: string;
    lead_source: string;
    inquiry_content: string;
    homepage: string;
  } | null;
}

interface EmailActivity {
  id: string;
  subject: string;
  bodyPreview: string;
  direction: 'INCOMING' | 'OUTGOING';
  from: string;
  to: string;
  timestamp: string;
}

const supabase = createClient();

function OutreachPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState('');
  const [remainingLeads, setRemainingLeads] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'sent' | 'skipped' | 'failed'>('pending');
  const [userId, setUserId] = useState<string>('');
  // Period filter for stats
  const [statsFrom, setStatsFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [statsTo, setStatsTo] = useState(() => new Date().toISOString().split('T')[0]);
  // Activity sidebar
  const [activityCompany, setActivityCompany] = useState<string>('');
  const [activityEmail, setActivityEmail] = useState<string>('');
  const [activities, setActivities] = useState<EmailActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [showActivitySidebar, setShowActivitySidebar] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('email_queue')
      .select('*, leads(company_name, contact_name, email, lead_source, inquiry_content, homepage)')
      .order('created_at', { ascending: false });

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data } = await query.limit(200);
    setItems((data as QueueItem[]) || []);
    setLoading(false);
  }, [filter]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateProgress('メール生成中...');
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          template_type: 'reapproach',
          limit: 50,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setGenerateProgress(`エラー: ${data.error}`);
      } else {
        setGenerateProgress(`${data.generated}件生成完了`);
        setRemainingLeads(data.remaining ?? null);
        loadItems();
      }
    } catch (e) {
      setGenerateProgress(`エラー: ${e instanceof Error ? e.message : String(e)}`);
    }
    setTimeout(() => { setGenerating(false); setGenerateProgress(''); }, 3000);
  };

  const updateStatus = async (id: string, status: string) => {
    await fetch('/api/outreach', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i));
  };

  const excludeLead = async (item: QueueItem) => {
    // Update lead status to excluded
    await supabase.from('leads').update({ status: 'excluded' }).eq('id', item.lead_id);
    // Delete from queue
    await fetch('/api/outreach', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, status: 'skipped' }),
    });
    // Remove from UI
    setItems(prev => prev.filter(i => i.id !== item.id));
  };

  const approveAll = async () => {
    const pendingItems = items.filter(i => i.status === 'pending');
    for (const item of pendingItems) {
      await updateStatus(item.id, 'approved');
    }
  };

  const saveEdit = async (id: string) => {
    await fetch('/api/outreach', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'pending', subject: editSubject, body: editBody }),
    });
    setItems(prev => prev.map(i => i.id === id ? { ...i, subject: editSubject, body: editBody } : i));
    setEditingId(null);
  };

  const handleSendApproved = async () => {
    const approvedItems = items.filter(i => i.status === 'approved');
    if (approvedItems.length === 0) return;
    if (!confirm(`${approvedItems.length}件のメールを送信しますか？`)) return;

    setSending(true);
    setSendProgress(`0 / ${approvedItems.length} 送信中...`);

    // Send in batches of 10
    const batchSize = 10;
    let totalSent = 0;
    let totalFailed = 0;

    for (let i = 0; i < approvedItems.length; i += batchSize) {
      const batch = approvedItems.slice(i, i + batchSize);
      const ids = batch.map(item => item.id);

      try {
        const res = await fetch('/api/outreach/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ queue_ids: ids, user_id: userId }),
        });
        const data = await res.json();
        totalSent += data.sent || 0;
        totalFailed += data.failed || 0;
      } catch {
        totalFailed += batch.length;
      }

      setSendProgress(`${totalSent + totalFailed} / ${approvedItems.length} 送信中...`);
    }

    setSendProgress(`完了: ${totalSent}件送信 / ${totalFailed}件失敗`);
    loadItems();
    setTimeout(() => { setSending(false); setSendProgress(''); }, 5000);
  };

  const openActivity = async (companyName: string, email: string) => {
    setActivityCompany(companyName);
    setActivityEmail(email);
    setShowActivitySidebar(true);
    setActivityLoading(true);
    setActivities([]);
    try {
      const params = new URLSearchParams();
      if (companyName) params.set('company', companyName);
      if (email) params.set('email', email);
      const res = await fetch(`/api/hubspot-activities?${params}`);
      const data = await res.json();
      setActivities(data.activities || []);
    } catch {
      setActivities([]);
    }
    setActivityLoading(false);
  };

  const counts = {
    pending: items.filter(i => i.status === 'pending').length,
    approved: items.filter(i => i.status === 'approved').length,
    sent: items.filter(i => i.status === 'sent').length,
    skipped: items.filter(i => i.status === 'skipped').length,
    failed: items.filter(i => i.status === 'failed').length,
  };

  // Stats: tab counts + period sent count + sent source breakdown
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});
  const [periodSentCount, setPeriodSentCount] = useState(0);
  const [sentSourceBreakdown, setSentSourceBreakdown] = useState<Record<string, number>>({});

  // Tab counts + remaining leads (refresh on items change)
  useEffect(() => {
    (async () => {
      const { count: pending } = await supabase.from('email_queue').select('*', { count: 'exact', head: true }).eq('status', 'pending');
      const { count: approved } = await supabase.from('email_queue').select('*', { count: 'exact', head: true }).eq('status', 'approved');
      const { count: sent } = await supabase.from('email_queue').select('*', { count: 'exact', head: true }).eq('status', 'sent');
      const { count: failed } = await supabase.from('email_queue').select('*', { count: 'exact', head: true }).eq('status', 'failed');
      setTabCounts({ pending: pending || 0, approved: approved || 0, sent: sent || 0, failed: failed || 0 });

      // Count remaining eligible leads
      const { data: eligible } = await supabase
        .from('leads')
        .select('id')
        .not('status', 'in', '("dnc","duplicate","excluded")')
        .not('email', 'eq', '')
        .not('email', 'is', null);
      const { data: queued } = await supabase
        .from('email_queue')
        .select('lead_id')
        .in('status', ['pending', 'approved', 'sent']);
      const queuedIds = new Set((queued || []).map(e => e.lead_id));
      const remaining = (eligible || []).filter(l => !queuedIds.has(l.id)).length;
      setRemainingLeads(remaining);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const [pendingSourceBreakdown, setPendingSourceBreakdown] = useState<Record<string, number>>({});

  // Period stats + source breakdowns (refresh on date range change or items change)
  useEffect(() => {
    (async () => {
      const fromDate = new Date(statsFrom);
      fromDate.setHours(0, 0, 0, 0);
      const toDate = new Date(statsTo);
      toDate.setHours(23, 59, 59, 999);

      // Sent count in period
      const { count } = await supabase
        .from('email_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'sent')
        .gte('sent_at', fromDate.toISOString())
        .lte('sent_at', toDate.toISOString());
      setPeriodSentCount(count || 0);

      // Sent source breakdown in period
      const { data: sentWithLeads } = await supabase
        .from('email_queue')
        .select('leads(lead_source)')
        .eq('status', 'sent')
        .gte('sent_at', fromDate.toISOString())
        .lte('sent_at', toDate.toISOString());
      const sentBreakdown: Record<string, number> = {};
      for (const item of (sentWithLeads || [])) {
        const src = (item.leads as unknown as { lead_source: string } | null)?.lead_source || '';
        const label = LEAD_SOURCE_LABELS[src as LeadSource] || src || '未設定';
        sentBreakdown[label] = (sentBreakdown[label] || 0) + 1;
      }
      setSentSourceBreakdown(sentBreakdown);

      // Pending/approved source breakdown
      const { data: pendingWithLeads } = await supabase
        .from('email_queue')
        .select('leads(lead_source)')
        .in('status', ['pending', 'approved']);
      const pendBreakdown: Record<string, number> = {};
      for (const item of (pendingWithLeads || [])) {
        const src = (item.leads as unknown as { lead_source: string } | null)?.lead_source || '';
        const label = LEAD_SOURCE_LABELS[src as LeadSource] || src || '未設定';
        pendBreakdown[label] = (pendBreakdown[label] || 0) + 1;
      }
      setPendingSourceBreakdown(pendBreakdown);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsFrom, statsTo, items]);

  return (
    <div className={`space-y-4 transition-all duration-200 ${showActivitySidebar ? 'mr-[420px]' : ''}`}>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">メール送信管理</h1>
        <div className="flex items-center gap-3">
          {remainingLeads !== null && (
            <span className="text-sm text-gray-500">
              残り <span className="font-semibold text-gray-800">{remainingLeads}件</span> 生成可能
            </span>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 bg-slate-800 text-white text-sm rounded-lg hover:bg-slate-700 disabled:opacity-50"
          >
            {generating ? generateProgress : 'メール自動生成'}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="space-y-3">
        {/* Status tabs */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { key: 'pending', label: '未確認', color: 'bg-yellow-50 border-yellow-200 text-yellow-800' },
            { key: 'approved', label: '承認済', color: 'bg-blue-50 border-blue-200 text-blue-800' },
            { key: 'sent', label: '送信済', color: 'bg-green-50 border-green-200 text-green-800' },
            { key: 'all', label: '全件', color: 'bg-gray-50 border-gray-200 text-gray-800' },
          ].map(({ key, label, color }) => (
            <button
              key={key}
              onClick={() => setFilter(key as typeof filter)}
              className={`p-2 rounded-lg border text-center transition-all ${color} ${filter === key ? 'ring-2 ring-offset-1 ring-slate-400' : 'hover:shadow-sm'}`}
            >
              <div className="text-xl font-bold">{key === 'all' ? Object.values(tabCounts).reduce((a, b) => a + b, 0) : (tabCounts[key] ?? 0)}</div>
              <div className="text-[10px] mt-0.5">{label}</div>
            </button>
          ))}
        </div>

        {/* Period stats + source breakdown */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">送信実績</h3>
            <div className="flex items-center gap-2 text-sm">
              <input
                type="date"
                value={statsFrom}
                onChange={(e) => setStatsFrom(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="text-gray-400">〜</span>
              <input
                type="date"
                value={statsTo}
                onChange={(e) => setStatsTo(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="flex gap-1 ml-2">
                {[
                  { label: '今日', fn: () => { const t = new Date().toISOString().split('T')[0]; setStatsFrom(t); setStatsTo(t); } },
                  { label: '今週', fn: () => { const n = new Date(); const s = new Date(n); s.setDate(n.getDate() - n.getDay()); setStatsFrom(s.toISOString().split('T')[0]); setStatsTo(n.toISOString().split('T')[0]); } },
                  { label: '今月', fn: () => { const n = new Date(); setStatsFrom(new Date(n.getFullYear(), n.getMonth(), 1).toISOString().split('T')[0]); setStatsTo(n.toISOString().split('T')[0]); } },
                ].map(({ label, fn }) => (
                  <button key={label} onClick={fn} className="px-2 py-0.5 text-xs border border-gray-300 rounded hover:bg-gray-50">{label}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {/* Total count */}
            <div>
              <div className="text-3xl font-bold text-gray-800">{periodSentCount}</div>
              <div className="text-xs text-gray-400">件送信</div>
            </div>

            {/* Sent source breakdown */}
            <div>
              <h4 className="text-xs font-medium text-gray-500 mb-1.5">送信済み 経路内訳</h4>
              {Object.keys(sentSourceBreakdown).length === 0 ? (
                <p className="text-xs text-gray-400">この期間の実績なし</p>
              ) : (
                <div className="space-y-1">
                  {Object.entries(sentSourceBreakdown)
                    .sort(([, a], [, b]) => b - a)
                    .map(([source, count]) => {
                      const total = Object.values(sentSourceBreakdown).reduce((a, b) => a + b, 0);
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={source} className="flex items-center gap-2 text-xs">
                          <span className="w-36 text-gray-600 break-words leading-tight">{source}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2">
                            <div className="bg-green-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-gray-500 whitespace-nowrap">{count}件</span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Pending source breakdown */}
            <div>
              <h4 className="text-xs font-medium text-gray-500 mb-1.5">送信待ち 経路内訳</h4>
              {Object.keys(pendingSourceBreakdown).length === 0 ? (
                <p className="text-xs text-gray-400">送信待ちなし</p>
              ) : (
                <div className="space-y-1">
                  {Object.entries(pendingSourceBreakdown)
                    .sort(([, a], [, b]) => b - a)
                    .map(([source, count]) => {
                      const total = Object.values(pendingSourceBreakdown).reduce((a, b) => a + b, 0);
                      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                      return (
                        <div key={source} className="flex items-center gap-2 text-xs">
                          <span className="w-36 text-gray-600 break-words leading-tight">{source}</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-2">
                            <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-gray-500 whitespace-nowrap">{count}件</span>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions bar */}
      {filter === 'pending' && counts.pending > 0 && (
        <div className="flex items-center gap-3 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
          <span className="text-sm text-yellow-800">{counts.pending}件の未確認メールがあります</span>
          <button
            onClick={approveAll}
            className="ml-auto px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
          >
            全て承認
          </button>
        </div>
      )}
      {filter === 'approved' && counts.approved > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
          <span className="text-sm text-blue-800">{counts.approved}件の送信待ちメールがあります</span>
          <button
            onClick={handleSendApproved}
            disabled={sending}
            className="ml-auto px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
          >
            {sending ? sendProgress : '一括送信'}
          </button>
        </div>
      )}

      {/* Queue list */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <p className="text-gray-500">読み込み中...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <p className="text-gray-500">メールキューが空です</p>
            <p className="text-xs text-gray-400">「失注案件メール生成」ボタンで生成してください</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => {
              const lead = item.leads;
              const isExpanded = expandedId === item.id;
              const isEditing = editingId === item.id;

              return (
                <div key={item.id} className="px-4 py-3">
                  {/* Header row */}
                  <div className="flex items-center gap-3">
                    {/* Status badge */}
                    <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                      item.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      item.status === 'approved' ? 'bg-blue-100 text-blue-800' :
                      item.status === 'sent' ? 'bg-green-100 text-green-800' :
                      item.status === 'failed' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {item.status === 'pending' ? '未確認' :
                       item.status === 'approved' ? '承認済' :
                       item.status === 'sent' ? '送信済' :
                       item.status === 'failed' ? '失敗' : 'スキップ'}
                    </span>

                    {/* Company info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-800">{lead?.company_name || '不明'}</span>
                        {lead?.contact_name && <span className="text-xs text-gray-500">{lead.contact_name}</span>}
                        {lead?.email && <span className="text-xs text-gray-400">{lead.email}</span>}
                        {lead?.lead_source && (
                          <span className={`px-1.5 py-0.5 rounded-full text-xs ${LEAD_SOURCE_COLORS[(lead.lead_source || '') as LeadSource] || 'bg-gray-100'}`}>
                            {LEAD_SOURCE_LABELS[(lead.lead_source || '') as LeadSource] || lead.lead_source}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 truncate mt-0.5">
                        件名: {item.subject}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => openActivity(lead?.company_name || '', lead?.email || '')}
                        className="px-2 py-1 text-xs text-gray-500 border border-gray-200 rounded hover:bg-gray-50"
                        title="HubSpotメール履歴"
                      >
                        履歴
                      </button>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded"
                        title="プレビュー"
                      >
                        <svg className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {(item.status === 'pending' || item.status === 'failed') && (
                        <>
                          <button
                            onClick={() => updateStatus(item.id, 'approved')}
                            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            承認
                          </button>
                          <button
                            onClick={() => excludeLead(item)}
                            className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                          >
                            対象外
                          </button>
                          <button
                            onClick={() => { setEditingId(item.id); setEditSubject(item.subject); setEditBody(item.body); setExpandedId(item.id); }}
                            className="px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                          >
                            編集
                          </button>
                        </>
                      )}
                      {item.status === 'approved' && (
                        <button
                          onClick={() => updateStatus(item.id, 'pending')}
                          className="px-2 py-1 text-xs bg-yellow-200 text-yellow-800 rounded hover:bg-yellow-300"
                        >
                          取消
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="mt-3 ml-8 space-y-2">
                      {lead?.inquiry_content && (
                        <div className="text-xs text-gray-500 bg-gray-50 rounded px-3 py-2">
                          問い合わせ: {lead.inquiry_content}
                        </div>
                      )}
                      {isEditing ? (
                        <div className="space-y-2">
                          <input
                            value={editSubject}
                            onChange={(e) => setEditSubject(e.target.value)}
                            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="件名"
                          />
                          <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded text-sm h-48 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEdit(item.id)}
                              className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                            >
                              保存
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300"
                            >
                              キャンセル
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
                          <div className="text-sm font-medium text-gray-700">件名: {item.subject}</div>
                          <pre className="text-sm text-gray-600 whitespace-pre-wrap font-sans leading-relaxed">{item.body}</pre>
                        </div>
                      )}
                      {item.error_message && (
                        <div className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">
                          エラー: {item.error_message}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Activity Sidebar */}
      {showActivitySidebar && (
        <div className="fixed top-0 right-0 w-[420px] h-full border-l border-gray-200 bg-white shadow-lg overflow-hidden flex flex-col z-50">
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-800 truncate">{activityCompany}</h2>
              <p className="text-xs text-gray-500">{activityEmail || 'HubSpotメール履歴'}</p>
            </div>
            <button onClick={() => setShowActivitySidebar(false)} className="text-gray-400 hover:text-gray-600 flex-shrink-0 ml-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {activityLoading ? (
              <div className="flex items-center justify-center h-40">
                <p className="text-sm text-gray-500">読み込み中...</p>
              </div>
            ) : activities.length === 0 ? (
              <div className="flex items-center justify-center h-40">
                <p className="text-sm text-gray-400">メール履歴がありません</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {activities.map((act) => (
                  <div key={act.id} className="px-4 py-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${
                        act.direction === 'OUTGOING' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {act.direction === 'OUTGOING' ? '送信' : '受信'}
                      </span>
                      <span className="text-xs text-gray-400">
                        {act.timestamp ? new Date(act.timestamp).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-gray-800">{act.subject}</div>
                    <div className="text-xs text-gray-500">
                      {act.direction === 'OUTGOING' ? `To: ${act.to}` : `From: ${act.from}`}
                    </div>
                    {act.bodyPreview && (
                      <div className="text-xs text-gray-400 line-clamp-3">{act.bodyPreview}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function OutreachPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><p className="text-gray-500">読み込み中...</p></div>}>
      <OutreachPage />
    </Suspense>
  );
}
