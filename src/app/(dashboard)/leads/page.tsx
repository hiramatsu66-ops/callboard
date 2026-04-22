'use client';

import { useEffect, useState, useCallback, useMemo, memo, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import type {
  Lead,
  LeadStatus,
  CallResult,
  CallLog,
  Profile,
  EmailTemplate,
} from '@/lib/types';
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_COLORS,
  CALL_RESULT_LABELS,
  CALL_RESULT_COLORS,
  PRIORITY_OPTIONS,
  PRIORITY_COLORS,
  LEAD_SOURCE_LABELS,
  LEAD_SOURCE_COLORS,
} from '@/lib/types';
import type { LeadSource } from '@/lib/types';
import Papa from 'papaparse';

const PAGE_SIZE = 50;
const supabase = createClient();

const DEFAULT_COLUMN_ORDER = [
  'company_name', 'contact_name', 'phone', 'email', 'homepage',
  'lead_source', 'inquiry_date', 'inquiry_content', 'hs_listing_plan',
  'hs_deal_exists', 'hs_deal_owner', 'hs_deal_created_at', 'priority', 'status',
  'next_activity_date', 'assigned_to', 'call_count', 'memo',
];

const COLUMN_LABELS: Record<string, string> = {
  company_name: '会社名',
  contact_name: '担当者名',
  phone: '電話番号',
  email: 'メール',
  homepage: 'HP',
  lead_source: '流入経路',
  inquiry_date: '問い合わせ日',
  inquiry_content: '問い合わせ内容',
  hs_listing_plan: '掲載プラン',
  hs_deal_exists: '商談',
  hs_deal_owner: '商談担当',
  hs_deal_created_at: '取引作成日',
  priority: '優先度',
  status: 'ステータス',
  next_activity_date: '次回予定',
  assigned_to: '担当',
  call_count: '架電回数',
  memo: 'メモ',
};

export default function LeadsPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><p className="text-gray-500">読み込み中...</p></div>}>
      <LeadsPage />
    </Suspense>
  );
}

function LeadsPage() {
  const searchParams = useSearchParams();

  const tableRef = useRef<HTMLDivElement>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [todayCount, setTodayCount] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [callCounts, setCallCounts] = useState<Record<string, number>>({});
  const [viewMode, setViewMode] = useState<'all' | 'today'>(() => searchParams.get('view') === 'today' ? 'today' : 'all');
  const [page, setPage] = useState(() => Number(searchParams.get('page') || '0'));
  const [search, setSearch] = useState(() => searchParams.get('q') || '');
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('q') || '');
  // Column filters: key = column name, value = Set of selected values (include mode)
  // Special values: '__unset__' for empty/null, '__unassigned__' for null assigned_to
  const [columnFilters, setColumnFilters] = useState<Record<string, Set<string>>>(() => {
    const filters: Record<string, Set<string>> = {};
    // Migrate from legacy URL params
    const status = searchParams.get('status');
    if (status && status !== 'all') filters.status = new Set([status]);
    const assigned = searchParams.get('assigned');
    if (assigned && assigned !== 'all') filters.assigned_to = new Set([assigned]);
    // New column filter URL params: cf_<column>=val1,val2
    for (const [key, val] of searchParams.entries()) {
      if (key.startsWith('cf_') && val) {
        filters[key.slice(3)] = new Set(val.split(','));
      }
    }
    return filters;
  });
  const [openFilterColumn, setOpenFilterColumn] = useState<string | null>(null);
  const [excludeDeal, setExcludeDeal] = useState<boolean>(() => searchParams.get('excludeDeal') === '1');
  const [excludeHasNextActivity, setExcludeHasNextActivity] = useState<boolean>(() => searchParams.get('excludeNextAct') === '1');
  const [loading, setLoading] = useState(true);
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [csvColumnMapping, setCsvColumnMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ company_name: '', phone: '', contact_name: '', email: '', homepage: '', lead_source: '', inquiry_date: '', inquiry_content: '', memo: '' });
  const [showMailPanel, setShowMailPanel] = useState(false);
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Partial<EmailTemplate> | null>(null);
  const [adding, setAdding] = useState(false);

  // Sidebar state
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [sidebarCallLogs, setSidebarCallLogs] = useState<CallLog[]>([]);
  const [activityMemo, setActivityMemo] = useState('');
  const [nextActivityDate, setNextActivityDate] = useState('');
  const [sidebarLoading, setSidebarLoading] = useState(false);

  // AI Email state
  const [aiEmailTemplateType, setAiEmailTemplateType] = useState<'initial' | 'followup' | 'appointment' | 'reapproach'>('initial');
  const [aiGeneratedSubject, setAiGeneratedSubject] = useState('');
  const [aiGeneratedBody, setAiGeneratedBody] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiEmailError, setAiEmailError] = useState('');
  const [aiCopied, setAiCopied] = useState(false);
  const [aiSending, setAiSending] = useState(false);
  const [aiSent, setAiSent] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [classifyReason, setClassifyReason] = useState('');
  const [bulkClassifying, setBulkClassifying] = useState(false);
  const [bulkClassifyProgress, setBulkClassifyProgress] = useState('');
  const [bulkHsChecking, setBulkHsChecking] = useState(false);
  const [bulkHsProgress, setBulkHsProgress] = useState('');
  const [hsChecking, setHsChecking] = useState(false);

  // Gmail state
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState('');

  // HubSpot email history
  const [hsEmailHistory, setHsEmailHistory] = useState<{ id: string; subject: string; bodyPreview: string; direction: string; from: string; to: string; timestamp: string }[]>([]);
  const [hsEmailLoading, setHsEmailLoading] = useState(false);
  const [showHsEmails, setShowHsEmails] = useState(false);

  // Edit call log state
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editLogResult, setEditLogResult] = useState<CallResult>('no_answer');
  const [editLogMemo, setEditLogMemo] = useState('');

  // Auto re-surface: preview next activity date when no_answer selected
  const [autoNextDatePreview, setAutoNextDatePreview] = useState<string | null>(null);

  // Toast notifications
  const [toasts, setToasts] = useState<{ id: number; message: string; type: 'success' | 'error' | 'info' }[]>([]);
  const toastIdRef = useRef(0);
  const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  // No-answer auto-exclude threshold (default 5)
  const NO_ANSWER_EXCLUDE_THRESHOLD = 5;

  // Inline edit state: { leadId-field: value }
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editCellValue, setEditCellValue] = useState('');

  // Column order state (persisted to localStorage)
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      // カラム構成が変わったらlocalStorageをリセット
      const COLUMN_VERSION = '3'; // カラム追加時にインクリメント
      const savedVersion = localStorage.getItem('callboard-column-version');
      if (savedVersion !== COLUMN_VERSION) {
        localStorage.removeItem('callboard-column-order');
        localStorage.removeItem('callboard-hidden-columns');
        localStorage.setItem('callboard-column-version', COLUMN_VERSION);
        return DEFAULT_COLUMN_ORDER;
      }
      const saved = localStorage.getItem('callboard-column-order');
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as string[];
          const allCols = new Set(DEFAULT_COLUMN_ORDER);
          const validSaved = parsed.filter(k => allCols.has(k));
          const missing = DEFAULT_COLUMN_ORDER.filter(k => !validSaved.includes(k));
          return [...validSaved, ...missing];
        } catch { /* fall through */ }
      }
    }
    return DEFAULT_COLUMN_ORDER;
  });
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('callboard-hidden-columns');
      if (saved) {
        try { return new Set(JSON.parse(saved) as string[]); } catch { /* fall through */ }
      }
    }
    return new Set();
  });
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const dragColumnRef = useRef<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Bulk email state
  const [showBulkEmailModal, setShowBulkEmailModal] = useState(false);
  const [bulkEmails, setBulkEmails] = useState<{ lead: Lead; subject: string; body: string; selected: boolean }[]>([]);
  const [bulkEmailGenerating, setBulkEmailGenerating] = useState(false);
  const [bulkEmailGenerateProgress, setBulkEmailGenerateProgress] = useState('');
  const [bulkEmailSending, setBulkEmailSending] = useState(false);
  const [bulkEmailSendProgress, setBulkEmailSendProgress] = useState('');
  const [bulkEmailTemplateType, setBulkEmailTemplateType] = useState<'initial' | 'followup' | 'appointment' | 'reapproach'>('reapproach');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAssignTo, setBulkAssignTo] = useState('');
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkLeadSource, setBulkLeadSource] = useState('');
  const [selectAllPages, setSelectAllPages] = useState(false);
  const [sortColumn, setSortColumn] = useState<string>(() => searchParams.get('sort') || 'created_at');
  const [sortAscending, setSortAscending] = useState(() => searchParams.get('asc') === '1');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Sync filters to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (viewMode === 'today') params.set('view', 'today');
    if (debouncedSearch) params.set('q', debouncedSearch);
    for (const [col, vals] of Object.entries(columnFilters)) {
      if (vals.size > 0) params.set(`cf_${col}`, Array.from(vals).join(','));
    }
    if (excludeDeal) params.set('excludeDeal', '1');
    if (excludeHasNextActivity) params.set('excludeNextAct', '1');
    if (sortColumn !== 'created_at') params.set('sort', sortColumn);
    if (sortAscending) params.set('asc', '1');
    if (page > 0) params.set('page', String(page));
    const qs = params.toString();
    const newUrl = qs ? `/leads?${qs}` : '/leads';
    window.history.replaceState(null, '', newUrl);
  }, [viewMode, debouncedSearch, columnFilters, excludeDeal, excludeHasNextActivity, sortColumn, sortAscending, page]);

  // Load Gmail connection status and current user
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setCurrentUserId(user.id);
      fetch(`/api/gmail/status?user_id=${user.id}`)
        .then((res) => res.json())
        .then((data) => {
          setGmailConnected(data.connected);
          setGmailEmail(data.email || '');
        })
        .catch(() => {});
    });
  }, []);

  // Apply column filters + common filters to any supabase query
  const applyFilters = useCallback(<T extends { or: Function; eq: Function; is: Function; in: Function }>(query: T): T => {
    if (debouncedSearch) {
      query = query.or(
        `company_name.ilike.%${debouncedSearch}%,contact_name.ilike.%${debouncedSearch}%,phone.ilike.%${debouncedSearch}%`
      ) as T;
    }
    for (const [col, vals] of Object.entries(columnFilters)) {
      if (vals.size === 0) continue;
      if (col === 'assigned_to') {
        if (vals.has('__unassigned__') && vals.size === 1) {
          query = query.is('assigned_to', null) as T;
        } else {
          const ids = Array.from(vals).filter(v => v !== '__unassigned__');
          const parts: string[] = ids.map(id => `assigned_to.eq.${id}`);
          if (vals.has('__unassigned__')) parts.push('assigned_to.is.null');
          query = query.or(parts.join(',')) as T;
        }
      } else if (col === 'lead_source') {
        const sources = Array.from(vals);
        const hasEmpty = sources.includes('');
        const nonEmpty = sources.filter(s => s !== '');
        if (!hasEmpty && nonEmpty.length === 1) {
          query = query.eq('lead_source', nonEmpty[0]) as T;
        } else if (!hasEmpty) {
          query = query.in('lead_source', nonEmpty) as T;
        } else {
          // Need .or() to combine eq values with is.null
          const parts: string[] = nonEmpty.map(s => `lead_source.eq.${s}`);
          parts.push('lead_source.is.null');
          parts.push('lead_source.eq.');
          query = query.or(parts.join(',')) as T;
        }
      } else if (col === 'hs_listing_plan') {
        const plans = Array.from(vals);
        const hasEmpty = plans.includes('');
        const nonEmpty = plans.filter(s => s !== '');
        if (!hasEmpty && nonEmpty.length === 1) {
          query = query.eq('hs_listing_plan', nonEmpty[0]) as T;
        } else if (!hasEmpty) {
          query = query.in('hs_listing_plan', nonEmpty) as T;
        } else {
          const parts: string[] = nonEmpty.map(s => `hs_listing_plan.eq.${s}`);
          parts.push('hs_listing_plan.is.null');
          parts.push('hs_listing_plan.eq.');
          query = query.or(parts.join(',')) as T;
        }
      } else if (col === 'hs_deal_exists') {
        const values = Array.from(vals);
        if (values.length === 1) {
          if (values[0] === 'true') {
            query = query.eq('hs_deal_exists', true) as T;
          } else {
            query = query.or('hs_deal_exists.is.null,hs_deal_exists.eq.false') as T;
          }
        }
        // If both selected, no filter needed
      } else {
        // status, priority, etc.
        const values = Array.from(vals);
        if (values.length === 1) {
          query = query.eq(col, values[0]) as T;
        } else {
          query = query.in(col, values) as T;
        }
      }
    }
    if (excludeDeal) {
      query = query.or('hs_deal_exists.is.null,hs_deal_exists.eq.false') as T;
    }
    if (excludeHasNextActivity) {
      query = query.is('next_activity_date', null) as T;
    }
    return query;
  }, [debouncedSearch, columnFilters, excludeDeal, excludeHasNextActivity]);

  // Apply today view filter to a query
  const applyTodayFilter = useCallback(<T extends { or: Function; eq: Function; lte: Function; is: Function; in: Function }>(query: T, userId: string): T => {
    const today = new Date().toISOString().split('T')[0];
    // (next_activity_date <= today AND assigned_to = userId)
    // OR (next_activity_date is null AND status in ('new','calling') AND assigned_to = userId)
    query = query.eq('assigned_to', userId) as T;
    query = query.or(
      `next_activity_date.lte.${today},and(next_activity_date.is.null,status.in.(new,calling))`
    ) as T;
    return query;
  }, []);

  const loadLeads = useCallback(async () => {
    try {
      setLoading(true);

      // Load today's count for badge
      if (currentUserId) {
        const today = new Date().toISOString().split('T')[0];
        const { count: tc } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('assigned_to', currentUserId)
          .or(`next_activity_date.lte.${today},and(next_activity_date.is.null,status.in.(new,calling))`);
        setTodayCount(tc || 0);
      }

      let query = supabase
        .from('leads')
        .select('*', { count: 'exact' });

      query = applyFilters(query);

      if (viewMode === 'today' && currentUserId) {
        query = applyTodayFilter(query, currentUserId) as typeof query;
      }

      // For call_count sort, we need to handle it client-side since it's a computed field
      const effectiveSortColumn = sortColumn === 'call_count' ? 'created_at' : sortColumn;
      const { data, count } = await query
        .order(effectiveSortColumn, { ascending: sortAscending })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const loadedLeads = data || [];
      setTotalCount(count || 0);

      // Fetch call counts for loaded leads
      let counts: Record<string, number> = {};
      if (loadedLeads.length > 0) {
        const leadIds = loadedLeads.map(l => l.id);
        const { data: logData } = await supabase
          .from('call_logs')
          .select('lead_id')
          .in('lead_id', leadIds)
          .eq('activity_type', 'call');
        for (const row of (logData || [])) {
          counts[row.lead_id] = (counts[row.lead_id] || 0) + 1;
        }
        setCallCounts(counts);
      }

      // Client-side sort by call_count if needed
      if (sortColumn === 'call_count') {
        loadedLeads.sort((a, b) => {
          const ca = counts[a.id] || 0;
          const cb = counts[b.id] || 0;
          return sortAscending ? ca - cb : cb - ca;
        });
      }
      setLeads(loadedLeads);
    } catch (err) {
      console.error('Load leads error:', err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, applyFilters, sortColumn, sortAscending, viewMode, currentUserId, applyTodayFilter]);

  useEffect(() => {
    const loadProfiles = async () => {
      const { data } = await supabase.from('profiles').select('*');
      setProfiles(data || []);
    };
    loadProfiles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTemplates = useCallback(async () => {
    const { data } = await supabase.from('email_templates').select('*').order('created_at');
    setEmailTemplates(data || []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  // Sidebar: load call logs for selected lead
  const loadHsEmails = useCallback(async (lead: Lead) => {
    setHsEmailLoading(true);
    setHsEmailHistory([]);
    try {
      const params = new URLSearchParams();
      if (lead.company_name) params.set('company', lead.company_name);
      if (lead.email) params.set('email', lead.email);
      const res = await fetch(`/api/hubspot-activities?${params}`);
      const data = await res.json();
      setHsEmailHistory(data.activities || []);
    } catch { /* ignore */ }
    setHsEmailLoading(false);
  }, []);

  const loadSidebarData = useCallback(async (lead: Lead) => {
    setSidebarLoading(true);
    setShowHsEmails(false);
    setHsEmailHistory([]);
    const { data } = await supabase
      .from('call_logs')
      .select('*')
      .eq('lead_id', lead.id)
      .order('called_at', { ascending: false });
    setSidebarCallLogs(data || []);
    setNextActivityDate(lead.next_activity_date || '');
    setActivityMemo('');
    setSidebarLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectLead = (lead: Lead) => {
    if (selectedLead?.id === lead.id) {
      setSelectedLead(null);
      return;
    }
    setSelectedLead(lead);
    setShowMailPanel(false);
    loadSidebarData(lead);
  };

  // Add N business days to a date (skip weekends)
  const addBusinessDays = (date: Date, days: number): Date => {
    const result = new Date(date);
    let added = 0;
    while (added < days) {
      result.setDate(result.getDate() + 1);
      const dow = result.getDay();
      if (dow !== 0 && dow !== 6) added++; // skip Sun=0, Sat=6
    }
    return result;
  };

  // Compute auto next_activity_date for no_answer based on count
  const computeNoAnswerNextDate = (noAnswerCount: number): string => {
    const today = new Date();
    const daysToAdd = noAnswerCount <= 1 ? 1 : noAnswerCount === 2 ? 2 : 3;
    const nextDate = addBusinessDays(today, daysToAdd);
    return nextDate.toISOString().split('T')[0];
  };

  // Preview auto next date when hovering/focusing no_answer button
  const handleNoAnswerHover = async () => {
    if (!selectedLead) return;
    const { count } = await supabase
      .from('call_logs')
      .select('*', { count: 'exact', head: true })
      .eq('lead_id', selectedLead.id)
      .eq('result', 'no_answer');
    const nextCount = (count || 0) + 1; // this will be the new count after saving
    const autoDate = computeNoAnswerNextDate(nextCount);
    setAutoNextDatePreview(autoDate);
  };

  const handleRecordActivity = async (result: CallResult) => {
    if (!selectedLead) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const isEmail = result === 'email_sent';

    // For no_answer: compute auto next activity date and check threshold
    let effectiveNextDate = nextActivityDate || null;
    let noAnswerCount = 0;
    if (result === 'no_answer') {
      const { count } = await supabase
        .from('call_logs')
        .select('*', { count: 'exact', head: true })
        .eq('lead_id', selectedLead.id)
        .eq('result', 'no_answer');
      noAnswerCount = (count || 0) + 1;
      const autoDate = computeNoAnswerNextDate(noAnswerCount);
      // Only use auto date if user hasn't manually set a date (or auto preview matches)
      if (!nextActivityDate || nextActivityDate === autoNextDatePreview) {
        effectiveNextDate = autoDate;
      }
    }

    await supabase.from('call_logs').insert({
      lead_id: selectedLead.id,
      caller_id: user.id,
      result,
      memo: activityMemo,
      activity_type: isEmail ? 'email' : 'call',
    });

    let newStatus: LeadStatus = selectedLead.status;
    if (result === 'appointment') newStatus = 'appointment';
    else if (result === 'connected') newStatus = 'contacted';
    else if (result === 'invalid') newStatus = 'excluded';
    else if (result === 'rejected') newStatus = 'dnc';
    else if (isEmail && newStatus === 'new') newStatus = 'calling';
    else if (newStatus === 'new') newStatus = 'calling';

    // Auto-exclude if no_answer count reaches threshold
    if (result === 'no_answer' && noAnswerCount >= NO_ANSWER_EXCLUDE_THRESHOLD) {
      newStatus = 'excluded';
      showToast(`${NO_ANSWER_EXCLUDE_THRESHOLD}回不通のため対象外に変更しました`, 'info');
    }

    await supabase
      .from('leads')
      .update({
        status: newStatus,
        next_activity_date: effectiveNextDate,
      })
      .eq('id', selectedLead.id);

    setActivityMemo('');
    setAutoNextDatePreview(null);
    const { data: updatedLead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', selectedLead.id)
      .single();
    if (updatedLead) {
      setSelectedLead(updatedLead);
      setNextActivityDate(updatedLead.next_activity_date || '');
      setLeads(prev => prev.map(l => l.id === updatedLead.id ? updatedLead : l));
    }
    loadSidebarData(updatedLead || selectedLead);
  };

  const handleBulkClassifyPriority = async () => {
    if (selectedIds.size === 0) return;
    const targetLeads = selectAllPages
      ? await (async () => { setBulkClassifying(true); setBulkClassifyProgress('リード取得中...'); return fetchAllMatchingLeads(); })()
      : leads.filter(l => selectedIds.has(l.id));
    if (targetLeads.length === 0) return;

    setBulkClassifying(true);
    setBulkClassifyProgress(`0 / ${targetLeads.length} 件完了`);

    let done = 0;
    for (const lead of targetLeads) {
      try {
        const res = await fetch('/api/classify-priority', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead: {
              company_name: lead.company_name,
              inquiry_content: lead.inquiry_content,
              lead_source: lead.lead_source,
              homepage: lead.homepage,
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          await supabase
            .from('leads')
            .update({ priority: data.priority })
            .eq('id', lead.id);
        }
      } catch {
        // skip failed
      }
      done++;
      setBulkClassifyProgress(`${done} / ${targetLeads.length} 件完了`);
    }

    setBulkClassifying(false);
    setBulkClassifyProgress('');
    setSelectedIds(new Set());
    setSelectAllPages(false);
    loadLeads();
  };

  const handleBulkHsCheck = async () => {
    if (selectedIds.size === 0) return;
    const targetLeads = selectAllPages
      ? await (async () => { setBulkHsChecking(true); setBulkHsProgress('リード取得中...'); return fetchAllMatchingLeads(); })()
      : leads.filter(l => selectedIds.has(l.id));
    if (targetLeads.length === 0) return;

    setBulkHsChecking(true);
    setBulkHsProgress(`0 / ${targetLeads.length} 件完了`);

    let done = 0;
    for (const lead of targetLeads) {
      try {
        await fetch('/api/hubspot-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lead_id: lead.id, company_name: lead.company_name, homepage: lead.homepage, email: lead.email, contact_name: lead.contact_name }),
        });
      } catch { /* skip */ }
      done++;
      setBulkHsProgress(`${done} / ${targetLeads.length} 件完了`);
    }

    setBulkHsChecking(false);
    setBulkHsProgress('');
    setSelectedIds(new Set());
    setSelectAllPages(false);
    loadLeads();
  };


  const handleBulkEmailGenerate = async () => {
    if (selectedIds.size === 0) return;
    const targetLeads = selectAllPages
      ? await (async () => { setBulkEmailGenerating(true); setBulkEmailGenerateProgress('リード取得中...'); return fetchAllMatchingLeads(); })()
      : leads.filter(l => selectedIds.has(l.id));
    // メールアドレスがあるリードのみ
    const emailableLeads = targetLeads.filter(l => l.email);
    if (emailableLeads.length === 0) { alert('メールアドレスのあるリードがありません。'); return; }

    setBulkEmailGenerating(true);
    setBulkEmailGenerateProgress(`0 / ${emailableLeads.length} 件生成中`);
    const results: { lead: Lead; subject: string; body: string; selected: boolean }[] = [];

    for (let i = 0; i < emailableLeads.length; i++) {
      const lead = emailableLeads[i];
      try {
        const res = await fetch('/api/generate-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lead: {
              company_name: lead.company_name,
              contact_name: lead.contact_name,
              inquiry_content: lead.inquiry_content,
              homepage: lead.homepage,
              memo: lead.memo,
            },
            template_type: bulkEmailTemplateType,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          results.push({ lead, subject: data.subject, body: data.body, selected: true });
        } else {
          results.push({ lead, subject: '(生成失敗)', body: data.error || '', selected: false });
        }
      } catch {
        results.push({ lead, subject: '(生成失敗)', body: '', selected: false });
      }
      setBulkEmailGenerateProgress(`${i + 1} / ${emailableLeads.length} 件生成中`);
    }

    setBulkEmails(results);
    setBulkEmailGenerating(false);
    setBulkEmailGenerateProgress('');
    setShowBulkEmailModal(true);
  };

  const handleBulkEmailSend = async () => {
    const toSend = bulkEmails.filter(e => e.selected && e.subject !== '(生成失敗)');
    if (toSend.length === 0) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    setBulkEmailSending(true);
    setBulkEmailSendProgress(`0 / ${toSend.length} 件送信中`);
    let sent = 0;

    for (const item of toSend) {
      try {
        const res = await fetch('/api/gmail/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: item.lead.email,
            subject: item.subject,
            body: item.body,
            user_id: user.id,
          }),
        });
        if (res.ok) {
          // コールログ記録
          await supabase.from('call_logs').insert({
            lead_id: item.lead.id,
            caller_id: user.id,
            result: 'email_sent',
            memo: `件名: ${item.subject}`,
            activity_type: 'email',
          });
          // 次回活動予定日を半年後に設定
          const sixMonthsLater = new Date();
          sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
          const nextDate = sixMonthsLater.toISOString().split('T')[0];
          await supabase.from('leads').update({ next_activity_date: nextDate }).eq('id', item.lead.id);
        }
      } catch { /* skip */ }
      sent++;
      setBulkEmailSendProgress(`${sent} / ${toSend.length} 件送信中`);
    }

    setBulkEmailSending(false);
    setBulkEmailSendProgress('');
    setShowBulkEmailModal(false);
    setBulkEmails([]);
    setSelectedIds(new Set());
    setSelectAllPages(false);
    alert(`${sent}件のメールを送信しました。`);
    loadLeads();
  };

  const handleSidebarHsCheck = async () => {
    if (!selectedLead) return;
    setHsChecking(true);
    try {
      const res = await fetch('/api/hubspot-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: selectedLead.id, company_name: selectedLead.company_name, homepage: selectedLead.homepage, email: selectedLead.email, contact_name: selectedLead.contact_name }),
      });
      const data = await res.json();
      if (res.ok) {
        const updated = { ...selectedLead, hs_deal_exists: data.deal_exists, hs_checked_at: data.checked_at, hs_deal_owner: data.deal_owner || '', hs_deal_created_at: data.deal_created_at || null, hs_listing_plan: data.listing_plan || '' };
        setSelectedLead(updated);
        setLeads(prev => prev.map(l => l.id === updated.id ? { ...l, ...updated } : l));
      }
    } catch { /* skip */ }
    setHsChecking(false);
  };

  const handleClassifyPriority = async () => {
    if (!selectedLead) return;
    setClassifying(true);
    setClassifyReason('');

    try {
      const res = await fetch('/api/classify-priority', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead: {
            company_name: selectedLead.company_name,
            inquiry_content: selectedLead.inquiry_content,
            lead_source: selectedLead.lead_source,
            homepage: selectedLead.homepage,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setClassifyReason(data.error || '判定に失敗しました');
        return;
      }

      // Update DB
      await supabase
        .from('leads')
        .update({ priority: data.priority })
        .eq('id', selectedLead.id);

      const updatedLead = { ...selectedLead, priority: data.priority };
      setSelectedLead(updatedLead);
      setLeads(prev => prev.map(l => l.id === updatedLead.id ? updatedLead : l));
      setClassifyReason(`${data.priority} - ${data.reason}`);
    } catch {
      setClassifyReason('通信エラーが発生しました');
    } finally {
      setClassifying(false);
    }
  };

  const handleAiGenerateEmail = async () => {
    if (!selectedLead) return;
    setAiGenerating(true);
    setAiEmailError('');
    setAiGeneratedSubject('');
    setAiGeneratedBody('');

    try {
      const res = await fetch('/api/generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead: {
            company_name: selectedLead.company_name,
            contact_name: selectedLead.contact_name,
            industry: selectedLead.industry,
            company_size: selectedLead.company_size,
            overseas_interest: selectedLead.overseas_interest,
            target_countries: selectedLead.target_countries,
            inquiry_content: selectedLead.inquiry_content,
            homepage: selectedLead.homepage,
            memo: selectedLead.memo,
          },
          template_type: aiEmailTemplateType,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAiEmailError(data.error || 'エラーが発生しました');
        return;
      }
      setAiGeneratedSubject(data.subject);
      setAiGeneratedBody(data.body);
    } catch {
      setAiEmailError('通信エラーが発生しました');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleAiCopyEmail = async () => {
    const fullEmail = `件名: ${aiGeneratedSubject}\n\n${aiGeneratedBody}`;
    await navigator.clipboard.writeText(fullEmail);
    setAiCopied(true);
    setTimeout(() => setAiCopied(false), 2000);
  };

  const handleAiSendEmail = async () => {
    if (!selectedLead || !selectedLead.email || !aiGeneratedSubject || !aiGeneratedBody) return;
    setAiSending(true);
    setAiEmailError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setAiEmailError('ログインしてください'); setAiSending(false); return; }

      const res = await fetch('/api/gmail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: selectedLead.email,
          subject: aiGeneratedSubject,
          body: aiGeneratedBody,
          user_id: user.id,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.reauth) {
          setGmailConnected(false);
        }
        setAiEmailError(data.error || '送信に失敗しました');
        return;
      }

      setAiSent(true);
      setAiGeneratedSubject('');
      setAiGeneratedBody('');
      setTimeout(() => setAiSent(false), 3000);

      // Auto-record email activity
      await supabase.from('call_logs').insert({
          lead_id: selectedLead.id,
          caller_id: user.id,
          result: 'email_sent',
          memo: `件名: ${aiGeneratedSubject}`,
          activity_type: 'email',
      });

      // 次回活動予定日を半年後に自動設定
      const sixMonthsLater = new Date();
      sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
      const nextDate = sixMonthsLater.toISOString().split('T')[0];
      await supabase.from('leads').update({ next_activity_date: nextDate }).eq('id', selectedLead.id);
      const updatedLead = { ...selectedLead, next_activity_date: nextDate };
      setSelectedLead(updatedLead);
      setNextActivityDate(nextDate);
      setLeads(prev => prev.map(l => l.id === updatedLead.id ? updatedLead : l));

      loadSidebarData(selectedLead);
    } catch {
      setAiEmailError('通信エラーが発生しました');
    } finally {
      setAiSending(false);
    }
  };

  const handleUpdateNextActivityDate = async (date: string) => {
    if (!selectedLead) return;
    setNextActivityDate(date);
    await supabase
      .from('leads')
      .update({ next_activity_date: date || null })
      .eq('id', selectedLead.id);
    const updatedLead = { ...selectedLead, next_activity_date: date || null };
    setSelectedLead(updatedLead);
    setLeads(prev => prev.map(l => l.id === updatedLead.id ? updatedLead : l));
  };

  const handleStartEditLog = (log: CallLog) => {
    setEditingLogId(log.id);
    setEditLogResult(log.result);
    setEditLogMemo(log.memo || '');
  };

  const handleSaveEditLog = async () => {
    if (!editingLogId || !selectedLead) return;
    await supabase
      .from('call_logs')
      .update({ result: editLogResult, memo: editLogMemo })
      .eq('id', editingLogId);
    setEditingLogId(null);
    loadSidebarData(selectedLead);
  };

  const handleDeleteLog = async (logId: string) => {
    if (!selectedLead) return;
    await supabase.from('call_logs').delete().eq('id', logId);
    loadSidebarData(selectedLead);
  };

  // --- Inline cell editing ---
  const startEditCell = (leadId: string, field: string, currentValue: string) => {
    setEditingCell(`${leadId}-${field}`);
    setEditCellValue(currentValue);
  };

  const saveCell = async (leadId: string, field: string) => {
    const updateData: Record<string, unknown> = {};
    if (field === 'assigned_to') {
      updateData[field] = editCellValue || null;
    } else if (field === 'next_activity_date' || field === 'inquiry_date' || field === 'hs_deal_created_at') {
      updateData[field] = editCellValue || null;
    } else if (field === 'hs_deal_exists') {
      updateData[field] = editCellValue === '' ? null : editCellValue === 'true';
    } else {
      updateData[field] = editCellValue;
    }
    await supabase.from('leads').update(updateData).eq('id', leadId);
    setEditingCell(null);
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...updateData } as Lead : l));
    if (selectedLead?.id === leadId) {
      setSelectedLead(prev => prev ? { ...prev, ...updateData } as Lead : prev);
    }
  };

  const cancelEditCell = () => {
    setEditingCell(null);
  };

  const isEditing = (leadId: string, field: string) => editingCell === `${leadId}-${field}`;

  // --- Bulk operations ---
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Column order & visibility persistence
  useEffect(() => {
    localStorage.setItem('callboard-column-order', JSON.stringify(columnOrder));
  }, [columnOrder]);

  useEffect(() => {
    localStorage.setItem('callboard-hidden-columns', JSON.stringify(Array.from(hiddenColumns)));
  }, [hiddenColumns]);

  const visibleColumns = useMemo(() => columnOrder.filter(k => !hiddenColumns.has(k)), [columnOrder, hiddenColumns]);

  const handleColumnDragStart = (key: string) => {
    dragColumnRef.current = key;
  };

  const handleColumnDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    setDragOverColumn(key);
  };

  const handleColumnDrop = (key: string) => {
    const from = dragColumnRef.current;
    if (from && from !== key) {
      const newOrder = [...columnOrder];
      const fromIndex = newOrder.indexOf(from);
      const toIndex = newOrder.indexOf(key);
      newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, from);
      setColumnOrder(newOrder);
    }
    dragColumnRef.current = null;
    setDragOverColumn(null);
  };

  const handleColumnDragEnd = () => {
    dragColumnRef.current = null;
    setDragOverColumn(null);
  };

  const toggleSort = (column: string) => {
    if (sortColumn === column) {
      setSortAscending(!sortAscending);
    } else {
      setSortColumn(column);
      setSortAscending(true);
    }
    setPage(0);
  };

  // Column filter helpers
  const FILTERABLE_COLUMNS: Record<string, { options: Record<string, string>; colors?: Record<string, string> }> = useMemo(() => ({
    lead_source: { options: LEAD_SOURCE_LABELS as Record<string, string>, colors: LEAD_SOURCE_COLORS as Record<string, string> },
    status: { options: LEAD_STATUS_LABELS as Record<string, string>, colors: LEAD_STATUS_COLORS as Record<string, string> },
    priority: { options: { A: 'A', B: 'B', C: 'C', '': '未設定' }, colors: { ...PRIORITY_COLORS, '': 'bg-gray-50 text-gray-400' } },
    hs_listing_plan: { options: { 'プレミアムプラン': 'プレミアム', 'ベーシックプラン': 'ベーシック', 'ライトプラン': 'ライト', 'フリープラン': 'フリー', 'お試しプラン': 'お試し', '': '未設定' }, colors: { 'プレミアムプラン': 'bg-purple-100 text-purple-800', 'ベーシックプラン': 'bg-blue-100 text-blue-800', 'ライトプラン': 'bg-teal-100 text-teal-800', 'フリープラン': 'bg-gray-100 text-gray-600', 'お試しプラン': 'bg-amber-100 text-amber-800', '': 'bg-gray-50 text-gray-400' } },
    hs_deal_exists: { options: { 'true': '商談あり', 'false': '商談なし' }, colors: { 'true': 'bg-green-100 text-green-800', 'false': 'bg-gray-100 text-gray-600' } },
    assigned_to: { options: {}, colors: {} }, // built dynamically from profiles
  }), []);

  const toggleColumnFilter = (column: string, value: string) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      const current = new Set(prev[column] || []);
      if (current.has(value)) {
        current.delete(value);
      } else {
        current.add(value);
      }
      if (current.size === 0) {
        delete next[column];
      } else {
        next[column] = current;
      }
      return next;
    });
    setPage(0);
  };

  const clearColumnFilter = (column: string) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      delete next[column];
      return next;
    });
    setPage(0);
  };

  const clearAllFilters = () => {
    setColumnFilters({});
    setExcludeDeal(false);
    setExcludeHasNextActivity(false);
    setSearch('');
    setPage(0);
  };

  const activeFilterCount = useMemo(() => {
    let count = Object.keys(columnFilters).length;
    if (excludeDeal) count++;
    if (excludeHasNextActivity) count++;
    return count;
  }, [columnFilters, excludeDeal, excludeHasNextActivity]);

  const toggleSelectAll = () => {
    if (selectedIds.size === leads.length) {
      setSelectedIds(new Set());
      setSelectAllPages(false);
    } else {
      setSelectedIds(new Set(leads.map(l => l.id)));
    }
  };

  const buildBulkQuery = (updateData: Record<string, unknown>) => {
    let query = supabase.from('leads').update(updateData);
    query = applyFilters(query);
    return query;
  };

  const fetchAllMatchingLeads = async (): Promise<Lead[]> => {
    const batchSize = 1000;
    let allLeads: Lead[] = [];
    let from = 0;
    while (true) {
      let query = supabase.from('leads').select('*');
      query = applyFilters(query);
      const { data } = await query.range(from, from + batchSize - 1);
      if (!data || data.length === 0) break;
      allLeads = allLeads.concat(data);
      if (data.length < batchSize) break;
      from += batchSize;
    }
    return allLeads;
  };

  const handleBulkAssign = async () => {
    if (selectedIds.size === 0) return;
    if (selectAllPages) {
      await buildBulkQuery({ assigned_to: bulkAssignTo || null });
    } else {
      const ids = Array.from(selectedIds);
      await supabase
        .from('leads')
        .update({ assigned_to: bulkAssignTo || null })
        .in('id', ids);
    }
    setSelectedIds(new Set());
    setSelectAllPages(false);
    setBulkAssignTo('');
    loadLeads();
  };

  const handleBulkStatus = async () => {
    if (selectedIds.size === 0 || !bulkStatus) return;
    if (selectAllPages) {
      await buildBulkQuery({ status: bulkStatus });
    } else {
      const ids = Array.from(selectedIds);
      await supabase
        .from('leads')
        .update({ status: bulkStatus })
        .in('id', ids);
    }
    setSelectedIds(new Set());
    setSelectAllPages(false);
    setBulkStatus('');
    loadLeads();
  };

  const handleBulkLeadSource = async () => {
    if (selectedIds.size === 0) return;
    if (selectAllPages) {
      await buildBulkQuery({ lead_source: bulkLeadSource });
    } else {
      const ids = Array.from(selectedIds);
      await supabase
        .from('leads')
        .update({ lead_source: bulkLeadSource })
        .in('id', ids);
    }
    setSelectedIds(new Set());
    setSelectAllPages(false);
    setBulkLeadSource('');
    loadLeads();
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const count = selectAllPages ? totalCount : selectedIds.size;
    if (!confirm(`${count}件のリードを削除しますか？この操作は取り消せません。`)) return;

    if (selectAllPages) {
      let query = supabase.from('leads').delete();
      query = applyFilters(query);
      await query;
    } else {
      const ids = Array.from(selectedIds);
      await supabase.from('leads').delete().in('id', ids);
    }
    setSelectedIds(new Set());
    setSelectAllPages(false);
    if (selectedLead && selectedIds.has(selectedLead.id)) {
      setSelectedLead(null);
    }
    loadLeads();
  };

  // Auto-detect column mapping based on CSV header names
  const autoDetectMapping = (headers: string[]): Record<string, string> => {
    const mapping: Record<string, string> = {};
    const patterns: Record<string, string[]> = {
      company_name: ['会社名', 'company_name', '会社', '企業名', '法人名'],
      phone: ['電話番号', 'phone', '電話', 'TEL', 'tel'],
      contact_name: ['担当者名', 'contact_name', '担当者', '氏名', '名前', '担当'],
      email: ['メールアドレス', 'email', 'メール', 'Email', 'E-mail', 'mail'],
      homepage: ['HP', 'homepage', 'URL', 'ホームページ', 'WebサイトURL', 'Webサイト', 'url', 'ウェブサイト'],
      lead_source: ['流入経路', 'lead_source', '経路', 'ソース', '登録経路'],
      inquiry_date: ['問い合わせ日', 'inquiry_date', '問合せ日', '登録日', '日付'],
      inquiry_content: ['問い合わせ内容', 'inquiry_content', '問合せ内容', '内容'],
      memo: ['メモ', 'memo', '備考', 'ノート', 'note'],
    };
    for (const [field, candidates] of Object.entries(patterns)) {
      for (const header of headers) {
        const h = header.trim();
        if (candidates.some(c => h === c || h.toLowerCase() === c.toLowerCase())) {
          mapping[field] = header;
          break;
        }
      }
    }
    return mapping;
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h: string) => h.trim().replace(/^\uFEFF/, ''),
      complete: (results) => {
        const data = results.data as Record<string, string>[];
        setCsvData(data);
        if (data.length > 0) {
          const headers = Object.keys(data[0]);
          setCsvColumnMapping(autoDetectMapping(headers));
        }
      },
    });
  };

  const handleImport = async () => {
    if (csvData.length === 0) return;
    if (!csvColumnMapping.company_name || !csvColumnMapping.phone) {
      alert('「会社名」と「電話番号」の列を選択してください。');
      return;
    }
    setImporting(true);

    const mapLeadSource = (raw: string): string => {
      if (!raw) return '';
      if (Object.keys(LEAD_SOURCE_LABELS).includes(raw)) return raw;
      const sourceMapping: Record<string, string> = {
        '過去問い合わせ': 'past_inquiry', '問い合わせ': 'past_inquiry', 'inquiry': 'past_inquiry',
        '失注': 'lost_deal', '失注案件': 'lost_deal',
        'ターゲット': 'target_list', 'ターゲットリスト': 'target_list', '検索追加': 'target_list',
        'セミナー': 'seminar', 'イベント': 'seminar', 'EXPO': 'seminar',
        '紹介': 'referral',
        'インバウンド': 'inbound', 'Web': 'inbound', 'HP': 'inbound',
        '外部リスト': 'external_list', '購入リスト': 'external_list',
      };
      for (const [k, v] of Object.entries(sourceMapping)) {
        if (raw.includes(k)) return v;
      }
      return 'other';
    };

    const m = csvColumnMapping;
    const leadsToInsert = csvData.map((row) => ({
      company_name: (m.company_name ? row[m.company_name] : '')?.trim() || '',
      phone: (m.phone ? row[m.phone] : '')?.trim() || '',
      contact_name: (m.contact_name ? row[m.contact_name] : '')?.trim() || '',
      email: (m.email ? row[m.email] : '')?.trim() || '',
      homepage: (m.homepage ? row[m.homepage] : '')?.trim() || '',
      lead_source: mapLeadSource((m.lead_source ? row[m.lead_source] : '')?.trim() || ''),
      inquiry_date: (m.inquiry_date ? row[m.inquiry_date] : '')?.trim() || null,
      inquiry_content: (m.inquiry_content ? row[m.inquiry_content] : '')?.trim() || '',
      status: 'new' as const,
      memo: (m.memo ? row[m.memo] : '')?.trim() || '',
    }));

    const validLeads = leadsToInsert.filter(
      (l) => l.company_name && l.phone
    );

    if (validLeads.length === 0) {
      alert(`会社名と電話番号の両方が入った行が見つかりませんでした（${leadsToInsert.length}件中0件）。\n列の割り当てを確認してください。`);
      setImporting(false);
      return;
    }

    // Check duplicates by company_name, email, phone
    const names = validLeads.map(l => l.company_name);
    const { data: existingByName } = await supabase
      .from('leads')
      .select('company_name')
      .in('company_name', names);
    const dupNames = new Set((existingByName || []).map(r => r.company_name));

    const emails = validLeads.map(l => l.email).filter(e => e);
    let dupEmails = new Set<string>();
    if (emails.length > 0) {
      const { data: existingByEmail } = await supabase
        .from('leads')
        .select('email')
        .in('email', emails);
      dupEmails = new Set((existingByEmail || []).map(r => r.email));
    }

    const phones = validLeads.map(l => l.phone).filter(p => p);
    let dupPhones = new Set<string>();
    if (phones.length > 0) {
      const { data: existingByPhone } = await supabase
        .from('leads')
        .select('phone')
        .in('phone', phones);
      dupPhones = new Set((existingByPhone || []).map(r => r.phone));
    }

    const newLeads = validLeads.filter(l => !dupNames.has(l.company_name) && (!l.email || !dupEmails.has(l.email)) && (!l.phone || !dupPhones.has(l.phone)));
    const skipped = validLeads.length - newLeads.length;

    if (skipped > 0 && newLeads.length === 0) {
      alert(`全${skipped}件が重複のためスキップされました。`);
      setImporting(false);
      return;
    }

    if (skipped > 0) {
      if (!window.confirm(`${validLeads.length}件中${skipped}件が重複しています。重複を除いた${newLeads.length}件をインポートしますか？`)) {
        setImporting(false);
        return;
      }
    }

    const { error } = await supabase.from('leads').insert(newLeads);

    if (error) {
      console.error('Import error:', error);
      alert(`インポートに失敗しました: ${error.message}`);
      setImporting(false);
      return;
    }

    alert(`${newLeads.length}件のリードをインポートしました。${skipped > 0 ? `（${skipped}件は重複スキップ）` : ''}`);
    setShowImportModal(false);
    setCsvData([]);
    setCsvColumnMapping({});
    setImporting(false);
    setPage(0);
    loadLeads();
  };

  const checkDuplicate = async (companyName: string, email: string, phone?: string): Promise<string | null> => {
    const { data: byName } = await supabase
      .from('leads')
      .select('id, company_name')
      .eq('company_name', companyName)
      .limit(1);
    if (byName && byName.length > 0) {
      return `「${companyName}」は既に登録されています。`;
    }
    if (email) {
      const { data: byEmail } = await supabase
        .from('leads')
        .select('id, company_name, email')
        .eq('email', email)
        .limit(1);
      if (byEmail && byEmail.length > 0) {
        return `メールアドレス「${email}」は「${byEmail[0].company_name}」で既に登録されています。`;
      }
    }
    if (phone) {
      const { data: byPhone } = await supabase
        .from('leads')
        .select('id, company_name, phone')
        .eq('phone', phone)
        .limit(1);
      if (byPhone && byPhone.length > 0) {
        return `電話番号「${phone}」は「${byPhone[0].company_name}」で既に登録されています。`;
      }
    }
    return null;
  };

  const handleAdd = async () => {
    if (!addForm.company_name || !addForm.phone) return;
    setAdding(true);

    const dupMsg = await checkDuplicate(addForm.company_name, addForm.email, addForm.phone);
    if (dupMsg) {
      if (!window.confirm(`${dupMsg}\nそれでも追加しますか？`)) {
        setAdding(false);
        return;
      }
    }

    await supabase.from('leads').insert({
      company_name: addForm.company_name,
      phone: addForm.phone,
      contact_name: addForm.contact_name || '',
      email: addForm.email || '',
      homepage: addForm.homepage || '',
      lead_source: addForm.lead_source || '',
      inquiry_date: addForm.inquiry_date || null,
      inquiry_content: addForm.inquiry_content || '',
      status: 'new' as const,
      memo: addForm.memo || '',
    });
    setShowAddModal(false);
    setAddForm({ company_name: '', phone: '', contact_name: '', email: '', homepage: '', lead_source: '', inquiry_date: '', inquiry_content: '', memo: '' });
    setAdding(false);
    setPage(0);
    loadLeads();
  };

  const buildGmailUrl = (template?: EmailTemplate) => {
    if (!selectedLead?.email) return '';
    const replacePlaceholders = (text: string) =>
      text
        .replace(/\{company_name\}/g, selectedLead.company_name || '')
        .replace(/\{contact_name\}/g, selectedLead.contact_name || '担当者');
    const subject = template ? replacePlaceholders(template.subject) : '';
    const body = template ? replacePlaceholders(template.body) : '';
    const params = new URLSearchParams({ view: 'cm', to: selectedLead.email });
    if (subject) params.set('su', subject);
    if (body) params.set('body', body);
    return `https://mail.google.com/mail/?${params.toString()}`;
  };

  const handleSaveTemplate = async () => {
    if (!editingTemplate?.name) return;
    if (editingTemplate.id) {
      await supabase.from('email_templates').update({
        name: editingTemplate.name,
        subject: editingTemplate.subject || '',
        body: editingTemplate.body || '',
      }).eq('id', editingTemplate.id);
    } else {
      await supabase.from('email_templates').insert({
        name: editingTemplate.name,
        subject: editingTemplate.subject || '',
        body: editingTemplate.body || '',
      });
    }
    setEditingTemplate(null);
    loadTemplates();
  };

  const handleDeleteTemplate = async (id: string) => {
    await supabase.from('email_templates').delete().eq('id', id);
    loadTemplates();
  };

  const profileMap = useMemo(() => new Map(profiles.map(p => [p.id, p.name])), [profiles]);
  const totalPages = useMemo(() => Math.ceil(totalCount / PAGE_SIZE), [totalCount]);

  // Helper: render editable text cell
  const renderEditableText = (lead: Lead, field: keyof Lead, displayValue: string) => {
    if (isEditing(lead.id, field)) {
      return (
        <input
          type="text"
          value={editCellValue}
          onChange={(e) => setEditCellValue(e.target.value)}
          onBlur={() => saveCell(lead.id, field)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveCell(lead.id, field);
            if (e.key === 'Escape') cancelEditCell();
          }}
          autoFocus
          className="w-full px-1 py-0.5 border border-blue-400 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
          onClick={(e) => e.stopPropagation()}
        />
      );
    }
    return (
      <span
        className="cursor-text hover:bg-blue-50 px-1 py-0.5 rounded -mx-1 block"
        onClick={(e) => {
          e.stopPropagation();
          startEditCell(lead.id, field, (lead[field] as string) || '');
        }}
      >
        {displayValue || '-'}
      </span>
    );
  };

  // Render a single cell by column key
  const renderCell = (lead: Lead, colKey: string) => {
    switch (colKey) {
      case 'company_name':
        return (
          <td key={colKey} className="py-2 px-3 text-sm font-medium text-gray-800">
            {renderEditableText(lead, 'company_name', lead.company_name)}
          </td>
        );
      case 'contact_name':
        return (
          <td key={colKey} className="py-2 px-3 text-sm text-gray-600">
            {renderEditableText(lead, 'contact_name', lead.contact_name || '')}
          </td>
        );
      case 'phone':
        return (
          <td key={colKey} className="py-2 px-3 text-sm text-gray-600">
            {renderEditableText(lead, 'phone', lead.phone)}
          </td>
        );
      case 'email':
        return (
          <td key={colKey} className="py-2 px-3 text-sm text-gray-600">
            {renderEditableText(lead, 'email', lead.email || '')}
          </td>
        );
      case 'homepage':
        return (
          <td key={colKey} className="py-2 px-3 text-sm text-gray-600">
            {isEditing(lead.id, 'homepage') ? (
              <input
                type="text"
                value={editCellValue}
                onChange={(e) => setEditCellValue(e.target.value)}
                onBlur={() => saveCell(lead.id, 'homepage')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCell(lead.id, 'homepage');
                  if (e.key === 'Escape') cancelEditCell();
                }}
                autoFocus
                className="w-full px-1 py-0.5 border border-blue-400 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                onClick={(e) => e.stopPropagation()}
              />
            ) : lead.homepage ? (
              <span className="flex items-center gap-1">
                <a
                  href={lead.homepage.startsWith('http') ? lead.homepage : `https://${lead.homepage}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-blue-600 hover:underline truncate max-w-[120px] inline-block"
                >
                  {lead.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </a>
                <button
                  onClick={(e) => { e.stopPropagation(); startEditCell(lead.id, 'homepage', lead.homepage || ''); }}
                  className="text-gray-400 hover:text-blue-600 flex-shrink-0"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
              </span>
            ) : (
              <span
                className="cursor-text hover:bg-blue-50 px-1 py-0.5 rounded -mx-1 block text-gray-400"
                onClick={(e) => { e.stopPropagation(); startEditCell(lead.id, 'homepage', ''); }}
              >
                -
              </span>
            )}
          </td>
        );
      case 'lead_source':
        return (
          <td key={colKey} className="py-2 px-3 text-sm text-gray-600" onClick={(e) => e.stopPropagation()}>
            {editingCell === `${lead.id}-lead_source` ? (
              <select
                value={editCellValue}
                onChange={(e) => setEditCellValue(e.target.value)}
                onBlur={() => saveCell(lead.id, 'lead_source')}
                autoFocus
                className="px-1 py-0.5 border border-blue-400 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              >
                {Object.entries(LEAD_SOURCE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            ) : (
              <span
                onClick={() => startEditCell(lead.id, 'lead_source', lead.lead_source || '')}
                className={`cursor-pointer inline-block px-2 py-0.5 rounded-full text-xs font-medium ${LEAD_SOURCE_COLORS[(lead.lead_source || '') as LeadSource] || 'bg-gray-50 text-gray-400'}`}
              >
                {LEAD_SOURCE_LABELS[(lead.lead_source || '') as LeadSource] || lead.lead_source || '未設定'}
              </span>
            )}
          </td>
        );
      case 'inquiry_date':
        return (
          <td key={colKey} className="py-2 px-3 text-sm" onClick={(e) => e.stopPropagation()}>
            {isEditing(lead.id, 'inquiry_date') ? (
              <input
                type="date"
                value={editCellValue}
                onChange={(e) => setEditCellValue(e.target.value)}
                onBlur={() => saveCell(lead.id, 'inquiry_date')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCell(lead.id, 'inquiry_date');
                  if (e.key === 'Escape') cancelEditCell();
                }}
                autoFocus
                className="px-1 py-0.5 border border-blue-400 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              />
            ) : (
              <span
                className="cursor-text hover:bg-blue-50 px-1 py-0.5 rounded -mx-1 block text-gray-600"
                onClick={() => startEditCell(lead.id, 'inquiry_date', lead.inquiry_date || '')}
              >
                {lead.inquiry_date
                  ? new Date(lead.inquiry_date).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' })
                  : '-'}
              </span>
            )}
          </td>
        );
      case 'inquiry_content':
        return (
          <td key={colKey} className="py-2 px-3 text-sm text-gray-500 max-w-[150px]">
            {isEditing(lead.id, 'inquiry_content') ? (
              <input
                type="text"
                value={editCellValue}
                onChange={(e) => setEditCellValue(e.target.value)}
                onBlur={() => saveCell(lead.id, 'inquiry_content')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCell(lead.id, 'inquiry_content');
                  if (e.key === 'Escape') cancelEditCell();
                }}
                autoFocus
                className="w-full px-1 py-0.5 border border-blue-400 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="cursor-text hover:bg-blue-50 px-1 py-0.5 rounded -mx-1 block truncate"
                onClick={(e) => { e.stopPropagation(); startEditCell(lead.id, 'inquiry_content', lead.inquiry_content || ''); }}
                title={lead.inquiry_content || ''}
              >
                {lead.inquiry_content || '-'}
              </span>
            )}
          </td>
        );
      case 'hs_listing_plan': {
        const plan = lead.hs_listing_plan || '';
        const planLabel = plan ? plan.replace('プラン', '') : '-';
        const planColor = plan === 'プレミアムプラン' ? 'bg-purple-100 text-purple-800'
          : plan === 'ベーシックプラン' ? 'bg-blue-100 text-blue-800'
          : plan === 'ライトプラン' ? 'bg-teal-100 text-teal-800'
          : plan === 'フリープラン' ? 'bg-gray-100 text-gray-600'
          : plan === 'お試しプラン' ? 'bg-amber-100 text-amber-800'
          : '';
        return (
          <td key={colKey} className="py-2 px-3 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
            {isEditing(lead.id, 'hs_listing_plan') ? (
              <input
                type="text"
                value={editCellValue}
                onChange={(e) => setEditCellValue(e.target.value)}
                onBlur={() => saveCell(lead.id, 'hs_listing_plan')}
                onKeyDown={(e) => { if (e.key === 'Enter') saveCell(lead.id, 'hs_listing_plan'); if (e.key === 'Escape') cancelEditCell(); }}
                autoFocus
                className="px-1 py-0.5 border border-blue-400 rounded text-xs focus:outline-none w-24"
              />
            ) : plan ? (
              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer hover:opacity-80 ${planColor}`} onClick={() => startEditCell(lead.id, 'hs_listing_plan', plan)}>{planLabel}</span>
            ) : (
              <span className="text-gray-300 text-xs cursor-pointer hover:text-gray-400" onClick={() => startEditCell(lead.id, 'hs_listing_plan', '')}>-</span>
            )}
          </td>
        );
      }
      case 'hs_deal_exists':
        return (
          <td key={colKey} className="py-2 px-3 text-center" onClick={(e) => e.stopPropagation()}>
            {isEditing(lead.id, 'hs_deal_exists') ? (
              <select
                value={editCellValue}
                onChange={(e) => setEditCellValue(e.target.value)}
                onBlur={() => saveCell(lead.id, 'hs_deal_exists')}
                autoFocus
                className="px-1 py-0.5 border border-blue-400 rounded text-xs focus:outline-none bg-white"
              >
                <option value="">未確認</option>
                <option value="true">商談済</option>
                <option value="false">未商談</option>
              </select>
            ) : lead.hs_deal_exists === null ? (
              <span className="text-gray-300 text-xs cursor-pointer hover:text-gray-400" onClick={() => startEditCell(lead.id, 'hs_deal_exists', '')}>-</span>
            ) : lead.hs_deal_exists ? (
              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700 cursor-pointer hover:opacity-80" onClick={() => startEditCell(lead.id, 'hs_deal_exists', 'true')}>商談済</span>
            ) : (
              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700 cursor-pointer hover:opacity-80" onClick={() => startEditCell(lead.id, 'hs_deal_exists', 'false')}>未商談</span>
            )}
          </td>
        );
      case 'hs_deal_owner':
        return (
          <td key={colKey} className="py-2 px-3 text-xs text-gray-700 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
            {isEditing(lead.id, 'hs_deal_owner') ? (
              <input
                type="text"
                value={editCellValue}
                onChange={(e) => setEditCellValue(e.target.value)}
                onBlur={() => saveCell(lead.id, 'hs_deal_owner')}
                onKeyDown={(e) => { if (e.key === 'Enter') saveCell(lead.id, 'hs_deal_owner'); if (e.key === 'Escape') cancelEditCell(); }}
                autoFocus
                className="px-1 py-0.5 border border-blue-400 rounded text-xs focus:outline-none w-24"
              />
            ) : (
              <span className="cursor-text hover:bg-blue-50 px-1 py-0.5 rounded -mx-1 block" onClick={() => startEditCell(lead.id, 'hs_deal_owner', lead.hs_deal_owner || '')}>
                {lead.hs_deal_owner || '-'}
              </span>
            )}
          </td>
        );
      case 'hs_deal_created_at':
        return (
          <td key={colKey} className="py-2 px-3 text-xs text-gray-700 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
            {isEditing(lead.id, 'hs_deal_created_at') ? (
              <input
                type="date"
                value={editCellValue ? editCellValue.slice(0, 10) : ''}
                onChange={(e) => setEditCellValue(e.target.value)}
                onBlur={() => saveCell(lead.id, 'hs_deal_created_at')}
                onKeyDown={(e) => { if (e.key === 'Enter') saveCell(lead.id, 'hs_deal_created_at'); if (e.key === 'Escape') cancelEditCell(); }}
                autoFocus
                className="px-1 py-0.5 border border-blue-400 rounded text-xs focus:outline-none"
              />
            ) : (
              <span className="cursor-text hover:bg-blue-50 px-1 py-0.5 rounded -mx-1 block" onClick={() => startEditCell(lead.id, 'hs_deal_created_at', lead.hs_deal_created_at || '')}>
                {lead.hs_deal_created_at ? new Date(lead.hs_deal_created_at).toLocaleDateString('ja-JP') : '-'}
              </span>
            )}
          </td>
        );
      case 'priority':
        return (
          <td key={colKey} className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
            {isEditing(lead.id, 'priority') ? (
              <select
                value={editCellValue}
                onChange={(e) => { setEditCellValue(e.target.value); }}
                onBlur={() => saveCell(lead.id, 'priority')}
                autoFocus
                className="px-1 py-0.5 border border-blue-400 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              >
                <option value="">-</option>
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            ) : (
              <span
                className={`inline-block px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-80 ${lead.priority ? PRIORITY_COLORS[lead.priority] : 'text-gray-400'}`}
                onClick={() => startEditCell(lead.id, 'priority', lead.priority || '')}
              >
                {lead.priority || '-'}
              </span>
            )}
          </td>
        );
      case 'status':
        return (
          <td key={colKey} className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
            {isEditing(lead.id, 'status') ? (
              <select
                value={editCellValue}
                onChange={(e) => { setEditCellValue(e.target.value); }}
                onBlur={() => saveCell(lead.id, 'status')}
                autoFocus
                className="px-1 py-0.5 border border-blue-400 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              >
                {Object.entries(LEAD_STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            ) : (
              <span
                className={`inline-block px-2 py-1 rounded-full text-xs font-medium cursor-pointer hover:opacity-80 ${LEAD_STATUS_COLORS[lead.status]}`}
                onClick={() => startEditCell(lead.id, 'status', lead.status)}
              >
                {LEAD_STATUS_LABELS[lead.status]}
              </span>
            )}
          </td>
        );
      case 'next_activity_date':
        return (
          <td key={colKey} className="py-2 px-3 text-sm" onClick={(e) => e.stopPropagation()}>
            {isEditing(lead.id, 'next_activity_date') ? (
              <input
                type="date"
                value={editCellValue}
                onChange={(e) => setEditCellValue(e.target.value)}
                onBlur={() => saveCell(lead.id, 'next_activity_date')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCell(lead.id, 'next_activity_date');
                  if (e.key === 'Escape') cancelEditCell();
                }}
                autoFocus
                className="px-1 py-0.5 border border-blue-400 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              />
            ) : (
              <span
                className={`cursor-text hover:bg-blue-50 px-1 py-0.5 rounded -mx-1 block ${
                  lead.next_activity_date
                    ? new Date(lead.next_activity_date) < new Date(new Date().toDateString())
                      ? 'text-red-600 font-medium'
                      : new Date(lead.next_activity_date).toDateString() === new Date().toDateString()
                      ? 'text-amber-600 font-medium'
                      : 'text-gray-600'
                    : 'text-gray-400'
                }`}
                onClick={() => startEditCell(lead.id, 'next_activity_date', lead.next_activity_date || '')}
              >
                {lead.next_activity_date
                  ? new Date(lead.next_activity_date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
                  : '-'}
              </span>
            )}
          </td>
        );
      case 'assigned_to':
        return (
          <td key={colKey} className="py-2 px-3 text-sm" onClick={(e) => e.stopPropagation()}>
            {isEditing(lead.id, 'assigned_to') ? (
              <select
                value={editCellValue}
                onChange={(e) => setEditCellValue(e.target.value)}
                onBlur={() => saveCell(lead.id, 'assigned_to')}
                autoFocus
                className="px-1 py-0.5 border border-blue-400 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
              >
                <option value="">未割当</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            ) : (
              <span
                className="cursor-text hover:bg-blue-50 px-1 py-0.5 rounded -mx-1 block text-gray-600"
                onClick={() => startEditCell(lead.id, 'assigned_to', lead.assigned_to || '')}
              >
                {profileMap.get(lead.assigned_to || '') || '未割当'}
              </span>
            )}
          </td>
        );
      case 'memo':
        return (
          <td key={colKey} className="py-2 px-3 text-sm text-gray-500 max-w-[150px]">
            {isEditing(lead.id, 'memo') ? (
              <input
                type="text"
                value={editCellValue}
                onChange={(e) => setEditCellValue(e.target.value)}
                onBlur={() => saveCell(lead.id, 'memo')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCell(lead.id, 'memo');
                  if (e.key === 'Escape') cancelEditCell();
                }}
                autoFocus
                className="w-full px-1 py-0.5 border border-blue-400 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className="cursor-text hover:bg-blue-50 px-1 py-0.5 rounded -mx-1 block truncate"
                onClick={(e) => { e.stopPropagation(); startEditCell(lead.id, 'memo', lead.memo || ''); }}
                title={lead.memo || ''}
              >
                {lead.memo || '-'}
              </span>
            )}
          </td>
        );
      case 'call_count': {
        const cnt = callCounts[lead.id] || 0;
        const cntColor = cnt === 0 ? 'text-gray-400' : cnt >= 3 ? 'font-semibold text-orange-600' : 'text-gray-700';
        return (
          <td key={colKey} className={`py-2 px-3 text-sm text-center ${cntColor}`}>
            {cnt === 0 ? '-' : cnt}
          </td>
        );
      }
      default:
        return <td key={colKey} className="py-2 px-3 text-sm text-gray-400">-</td>;
    }
  };

  return (
    <div className="relative h-full">
      {/* Main content */}
      <div className={`space-y-6 transition-all duration-200 ${selectedLead ? 'mr-96' : ''}`}>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">架電リスト</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors"
            >
              新規追加
            </button>
            <button
              onClick={() => setShowImportModal(true)}
              className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              CSVインポート
            </button>
          </div>
        </div>

        {/* Today / All tab switcher */}
        <div className="flex items-center gap-1 border-b border-gray-200">
          <button
            onClick={() => { setViewMode('all'); setPage(0); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              viewMode === 'all'
                ? 'border-slate-800 text-slate-800'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            全件 ({totalCount})
          </button>
          <button
            onClick={() => { setViewMode('today'); setPage(0); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              viewMode === 'today'
                ? 'border-slate-800 text-slate-800'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            今日
            {todayCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-amber-100 text-amber-800 text-xs rounded-full font-semibold">
                {todayCount}
              </span>
            )}
          </button>
        </div>

        {/* Bulk actions bar */}
        {selectedIds.size > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 space-y-2">
            {/* Selection info */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-blue-800">
                {selectAllPages ? totalCount : selectedIds.size}件選択中
              </span>
              <div className="flex items-center gap-2 text-sm">
                {selectedIds.size === leads.length && totalCount > leads.length && !selectAllPages && (
                  <button
                    onClick={() => setSelectAllPages(true)}
                    className="text-blue-700 underline hover:text-blue-900"
                  >
                    全{totalCount}件を選択
                  </button>
                )}
                {selectAllPages && (
                  <button
                    onClick={() => { setSelectAllPages(false); setSelectedIds(new Set(leads.map(l => l.id))); }}
                    className="text-blue-700 underline hover:text-blue-900"
                  >
                    このページのみに戻す
                  </button>
                )}
                <button
                  onClick={() => { setSelectedIds(new Set()); setSelectAllPages(false); }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  選択解除
                </button>
              </div>
            </div>

            {/* Bulk actions - grouped */}
            <div className="flex flex-wrap gap-2">
              {/* Group 1: Data changes */}
              <div className="flex items-center gap-1 bg-white rounded-md border border-gray-200 px-2 py-1">
                <select
                  value={bulkAssignTo}
                  onChange={(e) => setBulkAssignTo(e.target.value)}
                  className="px-1 py-0.5 text-xs border-0 bg-transparent focus:ring-0"
                >
                  <option value="">担当</option>
                  <option value="">未割当</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <button
                  onClick={handleBulkAssign}
                  className="px-2 py-0.5 bg-slate-700 text-white text-xs rounded hover:bg-slate-600"
                >
                  変更
                </button>
              </div>

              <div className="flex items-center gap-1 bg-white rounded-md border border-gray-200 px-2 py-1">
                <select
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value)}
                  className="px-1 py-0.5 text-xs border-0 bg-transparent focus:ring-0"
                >
                  <option value="">ステータス</option>
                  {Object.entries(LEAD_STATUS_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <button
                  onClick={handleBulkStatus}
                  disabled={!bulkStatus}
                  className="px-2 py-0.5 bg-slate-700 text-white text-xs rounded hover:bg-slate-600 disabled:opacity-50"
                >
                  変更
                </button>
              </div>

              <div className="flex items-center gap-1 bg-white rounded-md border border-gray-200 px-2 py-1">
                <select
                  value={bulkLeadSource}
                  onChange={(e) => setBulkLeadSource(e.target.value)}
                  className="px-1 py-0.5 text-xs border-0 bg-transparent focus:ring-0"
                >
                  <option value="">流入経路</option>
                  {Object.entries(LEAD_SOURCE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <button
                  onClick={handleBulkLeadSource}
                  className="px-2 py-0.5 bg-slate-700 text-white text-xs rounded hover:bg-slate-600"
                >
                  変更
                </button>
              </div>

              {/* Group 2: AI / External */}
              <div className="flex items-center gap-1">
                <button
                  onClick={handleBulkHsCheck}
                  disabled={bulkHsChecking}
                  className="px-2 py-1 bg-orange-600 text-white text-xs rounded hover:bg-orange-700 disabled:opacity-50"
                >
                  {bulkHsChecking ? bulkHsProgress : 'HubSpot確認'}
                </button>
                <button
                  onClick={handleBulkClassifyPriority}
                  disabled={bulkClassifying}
                  className="px-2 py-1 bg-violet-600 text-white text-xs rounded hover:bg-violet-700 disabled:opacity-50"
                >
                  {bulkClassifying ? bulkClassifyProgress : 'AI優先度'}
                </button>
              </div>

              {/* Group 3: Email */}
              <div className="flex items-center gap-1 bg-white rounded-md border border-blue-200 px-2 py-1">
                <select
                  value={bulkEmailTemplateType}
                  onChange={(e) => setBulkEmailTemplateType(e.target.value as typeof bulkEmailTemplateType)}
                  className="px-1 py-0.5 text-xs border-0 bg-transparent focus:ring-0"
                >
                  <option value="reapproach">再アプローチ</option>
                  <option value="initial">初回</option>
                  <option value="followup">フォローアップ</option>
                  <option value="appointment">アポイント</option>
                </select>
                <button
                  onClick={handleBulkEmailGenerate}
                  disabled={bulkEmailGenerating}
                  className="px-2 py-0.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {bulkEmailGenerating ? bulkEmailGenerateProgress : 'メール生成'}
                </button>
              </div>

              {/* Group 4: Danger */}
              <button
                onClick={handleBulkDelete}
                className="px-2 py-1 bg-red-600 text-white text-xs rounded hover:bg-red-700 ml-auto"
              >
                一括削除
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="会社名・担当者名・電話番号で検索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
            />
          </div>
          {/* Column settings */}
          <div className="relative">
            <button
              onClick={() => setShowColumnSettings(!showColumnSettings)}
              className={`p-2 border rounded-lg hover:bg-gray-50 transition-colors ${showColumnSettings ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white'}`}
              title="列の表示設定"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            {showColumnSettings && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowColumnSettings(false)} />
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 w-56 py-1 max-h-[400px] overflow-y-auto">
                  <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">表示する列</span>
                    <button
                      onClick={() => setHiddenColumns(new Set())}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      全て表示
                    </button>
                  </div>
                  {columnOrder.map((key) => (
                    <label key={key} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!hiddenColumns.has(key)}
                        onChange={() => {
                          setHiddenColumns(prev => {
                            const next = new Set(prev);
                            if (next.has(key)) {
                              next.delete(key);
                            } else {
                              next.add(key);
                            }
                            return next;
                          });
                        }}
                        className="rounded border-gray-300"
                      />
                      <span className={hiddenColumns.has(key) ? 'text-gray-400' : 'text-gray-700'}>
                        {COLUMN_LABELS[key]}
                      </span>
                    </label>
                  ))}
                  <div className="px-3 py-2 border-t border-gray-100">
                    <p className="text-xs text-gray-400">ドラッグ&ドロップで列順変更</p>
                  </div>
                </div>
              </>
            )}
          </div>
          {/* Active filter tags */}
          {activeFilterCount > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {Object.entries(columnFilters).map(([col, vals]) => {
                const labels = col === 'assigned_to'
                  ? Array.from(vals).map(v => v === '__unassigned__' ? '未割当' : (profiles.find(p => p.id === v)?.name || v))
                  : col === 'status'
                  ? Array.from(vals).map(v => LEAD_STATUS_LABELS[v as LeadStatus] || v)
                  : col === 'lead_source'
                  ? Array.from(vals).map(v => LEAD_SOURCE_LABELS[v as LeadSource] || v)
                  : col === 'priority'
                  ? Array.from(vals).map(v => v || '未設定')
                  : col === 'hs_listing_plan'
                  ? Array.from(vals).map(v => v ? v.replace('プラン', '') : '未設定')
                  : col === 'hs_deal_exists'
                  ? Array.from(vals).map(v => v === 'true' ? '商談あり' : '商談なし')
                  : Array.from(vals);
                return (
                  <span key={col} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded-md text-xs font-medium">
                    {COLUMN_LABELS[col]}: {labels.join(', ')}
                    <button
                      onClick={() => clearColumnFilter(col)}
                      className="ml-0.5 hover:text-blue-900"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                );
              })}
              {excludeDeal && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-700 rounded-md text-xs font-medium">
                  商談済み除外
                  <button onClick={() => { setExcludeDeal(false); setPage(0); }} className="ml-0.5 hover:text-red-900">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              )}
              {excludeHasNextActivity && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-teal-50 text-teal-700 rounded-md text-xs font-medium">
                  次回予定あり除外
                  <button onClick={() => { setExcludeHasNextActivity(false); setPage(0); }} className="ml-0.5 hover:text-teal-900">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </span>
              )}
              <button
                onClick={clearAllFilters}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                全解除
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-gray-500">読み込み中...</p>
            </div>
          ) : leads.length === 0 ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-gray-500">リードが見つかりません</p>
            </div>
          ) : (
            <>
              <div ref={tableRef} className="overflow-auto" style={{ maxHeight: 'calc(100vh - 260px)' }}>
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-3 px-3 w-8 bg-gray-50">
                        <input
                          type="checkbox"
                          checked={selectedIds.size === leads.length && leads.length > 0}
                          onChange={toggleSelectAll}
                          className="rounded border-gray-300"
                        />
                      </th>
                      {visibleColumns.map((key) => {
                        const isFilterable = key in FILTERABLE_COLUMNS;
                        const hasFilter = !!columnFilters[key]?.size;
                        return (
                          <th
                            key={key}
                            draggable
                            onDragStart={() => handleColumnDragStart(key)}
                            onDragOver={(e) => handleColumnDragOver(e, key)}
                            onDrop={() => handleColumnDrop(key)}
                            onDragEnd={handleColumnDragEnd}
                            className={`text-left py-2 px-3 text-sm font-medium text-gray-500 cursor-grab select-none bg-gray-50 relative ${
                              dragOverColumn === key ? 'border-l-2 border-blue-400' : ''
                            } ${hasFilter ? 'text-blue-600' : ''}`}
                          >
                            <div className="flex items-center gap-1">
                              <span
                                onClick={() => toggleSort(key)}
                                className="hover:text-gray-700 cursor-pointer truncate"
                              >
                                {COLUMN_LABELS[key] || key}
                                {sortColumn === key ? (sortAscending ? ' ▲' : ' ▼') : ''}
                              </span>
                              {isFilterable && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setOpenFilterColumn(openFilterColumn === key ? null : key); }}
                                  className={`flex-shrink-0 p-0.5 rounded hover:bg-gray-200 transition-colors ${hasFilter ? 'text-blue-600' : 'text-gray-400'}`}
                                  title={`${COLUMN_LABELS[key]}でフィルター`}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                  </svg>
                                </button>
                              )}
                            </div>
                            {/* Filter dropdown */}
                            {isFilterable && openFilterColumn === key && (
                              <>
                                <div className="fixed inset-0 z-20" onClick={() => setOpenFilterColumn(null)} />
                                <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 min-w-[200px] py-1 max-h-[320px] overflow-y-auto">
                                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100">
                                    <span className="text-xs font-medium text-gray-500">{COLUMN_LABELS[key]}フィルター</span>
                                    {hasFilter && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); clearColumnFilter(key); }}
                                        className="text-xs text-blue-600 hover:text-blue-800"
                                      >
                                        クリア
                                      </button>
                                    )}
                                  </div>
                                  {key === 'assigned_to' ? (
                                    <>
                                      <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={columnFilters.assigned_to?.has('__unassigned__') || false}
                                          onChange={() => toggleColumnFilter('assigned_to', '__unassigned__')}
                                          className="rounded border-gray-300"
                                        />
                                        <span className="text-gray-500">未割当</span>
                                      </label>
                                      {profiles.map((p) => (
                                        <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={columnFilters.assigned_to?.has(p.id) || false}
                                            onChange={() => toggleColumnFilter('assigned_to', p.id)}
                                            className="rounded border-gray-300"
                                          />
                                          {p.name}
                                        </label>
                                      ))}
                                    </>
                                  ) : (
                                    Object.entries(
                                      FILTERABLE_COLUMNS[key]?.options || {}
                                    ).map(([val, label]) => {
                                      const colors = FILTERABLE_COLUMNS[key]?.colors || {};
                                      return (
                                        <label key={val} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                                          <input
                                            type="checkbox"
                                            checked={columnFilters[key]?.has(val) || false}
                                            onChange={() => toggleColumnFilter(key, val)}
                                            className="rounded border-gray-300"
                                          />
                                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors[val] || 'bg-gray-100 text-gray-800'}`}>
                                            {label}
                                          </span>
                                        </label>
                                      );
                                    })
                                  )}
                                  {/* Extra options for status column */}
                                  {key === 'status' && (
                                    <>
                                      <div className="border-t border-gray-100 my-1" />
                                      <p className="px-3 py-1 text-xs text-gray-400">その他</p>
                                      <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={excludeDeal}
                                          onChange={() => { setExcludeDeal(!excludeDeal); setPage(0); }}
                                          className="rounded border-gray-300"
                                        />
                                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">商談済みを除外</span>
                                      </label>
                                      <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={excludeHasNextActivity}
                                          onChange={() => { setExcludeHasNextActivity(!excludeHasNextActivity); setPage(0); }}
                                          className="rounded border-gray-300"
                                        />
                                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-700">次回予定ありを除外</span>
                                      </label>
                                    </>
                                  )}
                                </div>
                              </>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => (
                      <tr
                        key={lead.id}
                        onClick={() => handleSelectLead(lead)}
                        className={`border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${
                          selectedLead?.id === lead.id ? 'bg-blue-50 hover:bg-blue-50' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(lead.id)}
                            onChange={() => toggleSelect(lead.id)}
                            className="rounded border-gray-300"
                          />
                        </td>
                        {visibleColumns.map((colKey) => renderCell(lead, colKey))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200">
                  <p className="text-sm text-gray-500">
                    全{totalCount}件中 {page * PAGE_SIZE + 1}-
                    {Math.min((page + 1) * PAGE_SIZE, totalCount)}件
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setPage(Math.max(0, page - 1)); tableRef.current?.scrollTo(0, 0); }}
                      disabled={page === 0}
                      className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                    >
                      前へ
                    </button>
                    <button
                      onClick={() => {
                        setPage(Math.min(totalPages - 1, page + 1));
                        tableRef.current?.scrollTo(0, 0);
                      }}
                      disabled={page >= totalPages - 1}
                      className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                    >
                      次へ
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Activity Sidebar */}
      {selectedLead && (
        <div className="fixed top-0 right-0 w-96 h-full border-l border-gray-200 bg-white shadow-lg overflow-hidden flex flex-col z-40">
          {/* Sidebar Header */}
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-800 truncate">{selectedLead.company_name}</h2>
              <p className="text-xs text-gray-500">{selectedLead.phone}</p>
            </div>
            <button
              onClick={() => setSelectedLead(null)}
              className="text-gray-400 hover:text-gray-600 flex-shrink-0 ml-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {sidebarLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-gray-500">読み込み中...</p>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {/* Lead Info */}
              <div className="px-4 py-3 border-b border-gray-100 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${LEAD_STATUS_COLORS[selectedLead.status]}`}>
                    {LEAD_STATUS_LABELS[selectedLead.status]}
                  </span>
                  <span className="text-xs text-gray-400">
                    担当: {profileMap.get(selectedLead.assigned_to || '') || '未割当'}
                  </span>
                </div>
                {selectedLead.contact_name && (
                  <p className="text-xs text-gray-600">担当者: {selectedLead.contact_name}</p>
                )}
                {selectedLead.homepage && (
                  <a
                    href={selectedLead.homepage.startsWith('http') ? selectedLead.homepage : `https://${selectedLead.homepage}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline block"
                  >
                    {selectedLead.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </a>
                )}
                <p className="text-xs text-gray-600">流入経路: <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${LEAD_SOURCE_COLORS[(selectedLead.lead_source || '') as LeadSource] || 'bg-gray-50 text-gray-400'}`}>{LEAD_SOURCE_LABELS[(selectedLead.lead_source || '') as LeadSource] || selectedLead.lead_source || '-'}</span></p>
                <p className="text-xs text-gray-600">問い合わせ日: {selectedLead.inquiry_date ? new Date(selectedLead.inquiry_date).toLocaleDateString('ja-JP') : '-'}</p>
                <p className="text-xs text-gray-600">問い合わせ内容: {selectedLead.inquiry_content || '-'}</p>
                {selectedLead.email && (
                  <div className="flex items-center gap-1 text-xs text-gray-600">
                    <span>メール: {selectedLead.email}</span>
                    <button
                      onClick={() => { navigator.clipboard.writeText(selectedLead.email); }}
                      className="p-0.5 text-gray-400 hover:text-blue-600 transition-colors"
                      title="コピー"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                )}
                {selectedLead.memo && (
                  <p className="text-xs text-gray-500">メモ: {selectedLead.memo}</p>
                )}
              </div>

              {/* HubSpot Email History */}
              <div className="px-4 py-3 border-b border-gray-100">
                <button
                  onClick={() => {
                    if (!showHsEmails) {
                      setShowHsEmails(true);
                      loadHsEmails(selectedLead);
                    } else {
                      setShowHsEmails(false);
                    }
                  }}
                  className="flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-blue-600 w-full"
                >
                  <svg className={`w-3 h-3 transition-transform ${showHsEmails ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  HubSpotメール履歴
                  {hsEmailHistory.length > 0 && <span className="text-gray-400 font-normal">({hsEmailHistory.length}件)</span>}
                </button>
                {showHsEmails && (
                  <div className="mt-2 space-y-2">
                    {hsEmailLoading ? (
                      <p className="text-xs text-gray-400">読み込み中...</p>
                    ) : hsEmailHistory.length === 0 ? (
                      <p className="text-xs text-gray-400">メール履歴なし</p>
                    ) : (
                      hsEmailHistory.map((act) => (
                        <div key={act.id} className="p-2 bg-gray-50 rounded text-xs space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${act.direction === 'OUTGOING' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
                              {act.direction === 'OUTGOING' ? '送信' : '受信'}
                            </span>
                            <span className="text-gray-400">
                              {act.timestamp ? new Date(act.timestamp).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' }) : ''}
                            </span>
                          </div>
                          <div className="font-medium text-gray-700 truncate">{act.subject}</div>
                          {act.bodyPreview && <div className="text-gray-400 line-clamp-2">{act.bodyPreview}</div>}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Next Activity Date */}
              <div className="px-4 py-3 border-b border-gray-100">
                <label className="block text-xs font-medium text-gray-500 mb-1">次回活動予定日</label>
                <input
                  type="date"
                  value={nextActivityDate}
                  onChange={(e) => handleUpdateNextActivityDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              {/* Record Activity */}
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="text-xs font-semibold text-gray-700 mb-2">活動を記録</h3>
                <textarea
                  value={activityMemo}
                  onChange={(e) => setActivityMemo(e.target.value)}
                  placeholder="活動メモを入力..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none mb-2"
                />
                <p className="text-[10px] text-gray-400 mb-1">架電</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.keys(CALL_RESULT_LABELS) as CallResult[]).filter((r) => r !== 'email_sent').map((result) => (
                    <button
                      key={result}
                      onClick={() => handleRecordActivity(result)}
                      onMouseEnter={result === 'no_answer' ? handleNoAnswerHover : undefined}
                      onMouseLeave={result === 'no_answer' ? () => setAutoNextDatePreview(null) : undefined}
                      className={`py-2 px-1 rounded-lg text-xs font-medium transition-colors ${CALL_RESULT_COLORS[result]}`}
                    >
                      {CALL_RESULT_LABELS[result]}
                    </button>
                  ))}
                </div>
                {autoNextDatePreview && (
                  <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-[10px] text-amber-700 font-medium">
                      次回架電日を自動セット：{new Date(autoNextDatePreview).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })}
                    </p>
                    <input
                      type="date"
                      value={nextActivityDate || autoNextDatePreview}
                      onChange={(e) => setNextActivityDate(e.target.value)}
                      className="mt-1 w-full px-2 py-1 border border-amber-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 bg-white"
                    />
                  </div>
                )}
                <p className="text-[10px] text-gray-400 mb-1 mt-2">メール</p>
                <button
                  onClick={() => handleRecordActivity('email_sent')}
                  className={`w-full py-2 px-1 rounded-lg text-xs font-medium transition-colors ${CALL_RESULT_COLORS.email_sent}`}
                >
                  {CALL_RESULT_LABELS.email_sent}
                </button>
              </div>

              {/* HubSpot Check */}
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    HubSpot 商談チェック
                  </h3>
                  {selectedLead.hs_deal_exists !== null && selectedLead.hs_deal_exists !== undefined && (
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${selectedLead.hs_deal_exists ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                      {selectedLead.hs_deal_exists ? '商談済' : '未商談'}
                    </span>
                  )}
                </div>
                <button
                  onClick={handleSidebarHsCheck}
                  disabled={hsChecking}
                  className="w-full py-2 bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-medium rounded-lg hover:from-orange-600 hover:to-amber-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {hsChecking ? (
                    <span className="flex items-center justify-center gap-1">
                      <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      確認中...
                    </span>
                  ) : (
                    'HubSpotで商談履歴を確認'
                  )}
                </button>
                {selectedLead.hs_deal_exists && selectedLead.hs_deal_owner && (
                  <p className="mt-1 text-xs text-gray-600">担当: {selectedLead.hs_deal_owner}</p>
                )}
                {selectedLead.hs_deal_exists && selectedLead.hs_deal_created_at && (
                  <p className="mt-0.5 text-xs text-gray-600">取引作成日: {new Date(selectedLead.hs_deal_created_at).toLocaleDateString('ja-JP')}</p>
                )}
                {selectedLead.hs_listing_plan && (
                  <p className="mt-1 text-xs text-gray-600">掲載プラン: {selectedLead.hs_listing_plan}</p>
                )}
                {selectedLead.hs_checked_at && (
                  <p className="mt-1 text-[10px] text-gray-400">最終チェック: {new Date(selectedLead.hs_checked_at).toLocaleString('ja-JP')}</p>
                )}
              </div>

              {/* Activity History - Calls */}
              <div className="px-4 py-3 border-b border-gray-100">
                <h3 className="text-xs font-semibold text-gray-700 mb-2">架電履歴</h3>
                {(() => {
                  const callLogs = sidebarCallLogs.filter((l) => l.activity_type !== 'email');
                  return callLogs.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-3">まだ架電履歴がありません</p>
                  ) : (
                    <div className="space-y-3">
                      {callLogs.map((log) => (
                        <div key={log.id} className="border-l-2 border-gray-200 pl-3 py-0.5">
                          {editingLogId === log.id ? (
                            <div className="space-y-2">
                              <select
                                value={editLogResult}
                                onChange={(e) => setEditLogResult(e.target.value as CallResult)}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-slate-500 bg-white"
                              >
                                {(Object.keys(CALL_RESULT_LABELS) as CallResult[]).filter((r) => r !== 'email_sent').map((r) => (
                                  <option key={r} value={r}>{CALL_RESULT_LABELS[r]}</option>
                                ))}
                              </select>
                              <textarea
                                value={editLogMemo}
                                onChange={(e) => setEditLogMemo(e.target.value)}
                                rows={2}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-slate-500 resize-none"
                                placeholder="メモ"
                              />
                              <div className="flex gap-1">
                                <button onClick={handleSaveEditLog} className="px-2 py-1 bg-slate-800 text-white text-[10px] rounded hover:bg-slate-700">保存</button>
                                <button onClick={() => setEditingLogId(null)} className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-700">キャンセル</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${CALL_RESULT_COLORS[log.result].replace(/hover:\S+/g, '')}`}>
                                  {CALL_RESULT_LABELS[log.result]}
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  {new Date(log.called_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span className="flex-1" />
                                <button onClick={() => handleStartEditLog(log)} className="text-[10px] text-gray-400 hover:text-blue-600">編集</button>
                                <button onClick={() => handleDeleteLog(log.id)} className="text-[10px] text-gray-400 hover:text-red-600">削除</button>
                              </div>
                              {log.memo && <p className="text-xs text-gray-600 mt-0.5">{log.memo}</p>}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Activity History - Emails */}
              <div className="px-4 py-3">
                <h3 className="text-xs font-semibold text-gray-700 mb-2">メール履歴</h3>
                {(() => {
                  const emailLogs = sidebarCallLogs.filter((l) => l.activity_type === 'email');
                  return emailLogs.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-3">まだメール履歴がありません</p>
                  ) : (
                    <div className="space-y-3">
                      {emailLogs.map((log) => (
                        <div key={log.id} className="border-l-2 border-indigo-200 pl-3 py-0.5">
                          {editingLogId === log.id ? (
                            <div className="space-y-2">
                              <textarea
                                value={editLogMemo}
                                onChange={(e) => setEditLogMemo(e.target.value)}
                                rows={2}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-slate-500 resize-none"
                                placeholder="メモ"
                              />
                              <div className="flex gap-1">
                                <button onClick={handleSaveEditLog} className="px-2 py-1 bg-slate-800 text-white text-[10px] rounded hover:bg-slate-700">保存</button>
                                <button onClick={() => setEditingLogId(null)} className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-700">キャンセル</button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex items-center gap-2">
                                <span className="inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-indigo-100 text-indigo-700">
                                  メール送付
                                </span>
                                <span className="text-[10px] text-gray-400">
                                  {new Date(log.called_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <span className="flex-1" />
                                <button onClick={() => handleStartEditLog(log)} className="text-[10px] text-gray-400 hover:text-blue-600">編集</button>
                                <button onClick={() => handleDeleteLog(log.id)} className="text-[10px] text-gray-400 hover:text-red-600">削除</button>
                              </div>
                              {log.memo && <p className="text-xs text-gray-600 mt-0.5">{log.memo}</p>}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add Lead Modal */}
      {showAddModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => { setShowAddModal(false); setAddForm({ company_name: '', phone: '', contact_name: '', email: '', homepage: '', lead_source: '', inquiry_date: '', inquiry_content: '', memo: '' }); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowAddModal(false); setAddForm({ company_name: '', phone: '', contact_name: '', email: '', homepage: '', lead_source: '', inquiry_date: '', inquiry_content: '', memo: '' }); } }}
        >
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">リード新規追加</h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setAddForm({ company_name: '', phone: '', contact_name: '', email: '', homepage: '', lead_source: '', inquiry_date: '', inquiry_content: '', memo: '' });
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 overflow-y-auto max-h-[70vh]">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  会社名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={addForm.company_name}
                  onChange={(e) => setAddForm({ ...addForm, company_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                  placeholder="例: 株式会社ABC"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  電話番号 <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={addForm.phone}
                  onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                  placeholder="例: 03-1234-5678"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">担当者名</label>
                <input
                  type="text"
                  value={addForm.contact_name}
                  onChange={(e) => setAddForm({ ...addForm, contact_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                  placeholder="例: 田中太郎"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">メールアドレス</label>
                <input
                  type="email"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                  placeholder="例: tanaka@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">HP</label>
                <input
                  type="url"
                  value={addForm.homepage}
                  onChange={(e) => setAddForm({ ...addForm, homepage: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                  placeholder="例: https://example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">流入経路</label>
                <select
                  value={addForm.lead_source}
                  onChange={(e) => setAddForm({ ...addForm, lead_source: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white"
                >
                  {Object.entries(LEAD_SOURCE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">問い合わせ日</label>
                <input
                  type="date"
                  value={addForm.inquiry_date}
                  onChange={(e) => setAddForm({ ...addForm, inquiry_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">問い合わせ内容</label>
                <textarea
                  value={addForm.inquiry_content}
                  onChange={(e) => setAddForm({ ...addForm, inquiry_content: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent resize-none"
                  placeholder="問い合わせ内容を入力してください"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">メモ</label>
                <textarea
                  value={addForm.memo}
                  onChange={(e) => setAddForm({ ...addForm, memo: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent resize-none"
                  placeholder="備考があれば入力してください"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setAddForm({ company_name: '', phone: '', contact_name: '', email: '', homepage: '', lead_source: '', inquiry_date: '', inquiry_content: '', memo: '' });
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                キャンセル
              </button>
              <button
                onClick={handleAdd}
                disabled={!addForm.company_name || !addForm.phone || adding}
                className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adding ? '追加中...' : '追加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Email Review Modal */}
      {showBulkEmailModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => !bulkEmailSending && setShowBulkEmailModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold">メール一括送信レビュー</h3>
                <p className="text-sm text-gray-500">
                  {bulkEmails.filter(e => e.selected).length} / {bulkEmails.length} 件選択中
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={bulkEmails.every(e => e.selected)}
                    onChange={() => {
                      const allSelected = bulkEmails.every(e => e.selected);
                      setBulkEmails(prev => prev.map(e => ({ ...e, selected: !allSelected })));
                    }}
                    className="rounded border-gray-300"
                  />
                  全選択
                </label>
                <button
                  onClick={() => setShowBulkEmailModal(false)}
                  disabled={bulkEmailSending}
                  className="px-3 py-1 text-sm text-gray-500 hover:text-gray-700"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleBulkEmailSend}
                  disabled={bulkEmailSending || bulkEmails.filter(e => e.selected).length === 0}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {bulkEmailSending ? bulkEmailSendProgress : `${bulkEmails.filter(e => e.selected).length}件送信`}
                </button>
              </div>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-3">
              {bulkEmails.map((item, idx) => (
                <div key={item.lead.id} className={`border rounded-lg p-4 ${item.selected ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200 bg-gray-50/50'}`}>
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => {
                        setBulkEmails(prev => prev.map((e, i) => i === idx ? { ...e, selected: !e.selected } : e));
                      }}
                      className="mt-1 rounded border-gray-300"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-bold text-gray-800">{item.lead.company_name}</span>
                        <span className="text-xs text-gray-500">{item.lead.contact_name}</span>
                        <span className="text-xs text-gray-400">{item.lead.email}</span>
                      </div>
                      {item.lead.inquiry_content && (
                        <p className="text-xs text-gray-500 mb-2 bg-gray-100 rounded px-2 py-1">
                          <span className="font-medium text-gray-600">問い合わせ: </span>{item.lead.inquiry_content}
                        </p>
                      )}
                      <div className="mb-2">
                        <label className="block text-xs text-gray-500 mb-1">件名</label>
                        <input
                          type="text"
                          value={item.subject}
                          onChange={(e) => setBulkEmails(prev => prev.map((em, i) => i === idx ? { ...em, subject: e.target.value } : em))}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">本文</label>
                        <textarea
                          value={item.body}
                          onChange={(e) => setBulkEmails(prev => prev.map((em, i) => i === idx ? { ...em, body: e.target.value } : em))}
                          rows={6}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => { setShowImportModal(false); setCsvData([]); setCsvColumnMapping({}); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowImportModal(false); setCsvData([]); setCsvColumnMapping({}); } }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">
                CSVインポート
              </h2>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setCsvData([]);
                }}
                className="text-gray-400 hover:text-gray-600"
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-gray-600">
                  CSVファイルをアップロードしてください。
                </p>
                <button
                  onClick={() => {
                    const bom = '\uFEFF';
                    const header = '会社名,電話番号,担当者名,メールアドレス,HP,流入経路,問い合わせ日,問い合わせ内容,メモ';
                    const sample = '株式会社サンプル,03-1234-5678,田中太郎,tanaka@example.com,https://example.com,Web問い合わせ,2026-03-23,料金について知りたい,初回コンタクト';
                    const csv = bom + header + '\n' + sample + '\n';
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'leads_sample.csv';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="text-sm text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  サンプルCSV
                </button>
              </div>
              <input
                type="file"
                accept=".csv"
                onChange={handleCSVUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
              />

              {csvData.length > 0 && (
                <div className="mt-4 space-y-4">
                  <p className="text-sm font-medium text-gray-700">
                    {csvData.length}件のデータ — 列の割り当てを確認してください
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'company_name', label: '会社名', required: true },
                      { key: 'phone', label: '電話番号', required: true },
                      { key: 'contact_name', label: '担当者名', required: false },
                      { key: 'email', label: 'メールアドレス', required: false },
                      { key: 'homepage', label: 'HP', required: false },
                      { key: 'lead_source', label: '流入経路', required: false },
                      { key: 'inquiry_date', label: '問い合わせ日', required: false },
                      { key: 'inquiry_content', label: '問い合わせ内容', required: false },
                      { key: 'memo', label: 'メモ', required: false },
                    ].map(({ key, label, required }) => (
                      <div key={key} className="flex items-center gap-2">
                        <label className={`text-xs w-24 shrink-0 ${required ? 'font-bold text-gray-800' : 'text-gray-500'}`}>
                          {label}{required ? ' *' : ''}
                        </label>
                        <select
                          value={csvColumnMapping[key] || ''}
                          onChange={(e) => setCsvColumnMapping(prev => ({ ...prev, [key]: e.target.value }))}
                          className={`flex-1 text-xs border rounded px-2 py-1 ${required && !csvColumnMapping[key] ? 'border-red-300 bg-red-50' : 'border-gray-200'}`}
                        >
                          <option value="">（未設定）</option>
                          {Object.keys(csvData[0]).map((col) => (
                            <option key={col} value={col}>{col}</option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  {csvColumnMapping.company_name && csvColumnMapping.phone && (
                    <div className="max-h-40 overflow-auto border border-gray-200 rounded-lg">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 border-b">
                            <th className="text-left py-1 px-2 font-medium text-gray-500">会社名</th>
                            <th className="text-left py-1 px-2 font-medium text-gray-500">電話番号</th>
                            <th className="text-left py-1 px-2 font-medium text-gray-500">担当者</th>
                            <th className="text-left py-1 px-2 font-medium text-gray-500">メール</th>
                          </tr>
                        </thead>
                        <tbody>
                          {csvData.slice(0, 5).map((row, i) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="py-1 px-2 text-gray-600">{row[csvColumnMapping.company_name]}</td>
                              <td className="py-1 px-2 text-gray-600">{row[csvColumnMapping.phone]}</td>
                              <td className="py-1 px-2 text-gray-600">{csvColumnMapping.contact_name ? row[csvColumnMapping.contact_name] : ''}</td>
                              <td className="py-1 px-2 text-gray-600">{csvColumnMapping.email ? row[csvColumnMapping.email] : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {csvData.length > 5 && (
                        <p className="text-xs text-gray-400 text-center py-1">
                          ...他 {csvData.length - 5}件
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setCsvData([]);
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                キャンセル
              </button>
              <button
                onClick={handleImport}
                disabled={csvData.length === 0 || importing || !csvColumnMapping.company_name || !csvColumnMapping.phone}
                className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? 'インポート中...' : `${csvData.length}件をインポート`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Template Editor Modal */}
      {showTemplateEditor && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => { setShowTemplateEditor(false); setEditingTemplate(null); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowTemplateEditor(false); setEditingTemplate(null); } }}
          tabIndex={-1}
          ref={(el) => el?.focus()}
        >
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-800">
                {editingTemplate ? (editingTemplate.id ? 'テンプレートを編集' : '新規テンプレート') : 'メールテンプレート管理'}
              </h2>
              <button
                onClick={() => { setShowTemplateEditor(false); setEditingTemplate(null); }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {editingTemplate ? (
              <div className="px-6 py-4 space-y-4 overflow-y-auto">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">テンプレート名</label>
                  <input
                    type="text"
                    value={editingTemplate.name || ''}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="例: 初回ご挨拶"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">件名</label>
                  <input
                    type="text"
                    value={editingTemplate.subject || ''}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, subject: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                    placeholder="例: お問い合わせありがとうございます"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">本文</label>
                  <textarea
                    value={editingTemplate.body || ''}
                    onChange={(e) => setEditingTemplate({ ...editingTemplate, body: e.target.value })}
                    rows={10}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 resize-none font-mono"
                    placeholder="メール本文を入力..."
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    変数: {'{contact_name}'} → 担当者名、{'{company_name}'} → 会社名 に自動変換されます
                  </p>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => setEditingTemplate(null)}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                  >
                    戻る
                  </button>
                  <button
                    onClick={handleSaveTemplate}
                    disabled={!editingTemplate.name}
                    className="px-4 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50"
                  >
                    保存
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <div className="px-6 py-4 space-y-2">
                  {emailTemplates.length === 0 ? (
                    <p className="text-sm text-gray-500 text-center py-8">テンプレートがありません</p>
                  ) : (
                    emailTemplates.map((tpl) => (
                      <div key={tpl.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">{tpl.name}</p>
                          <p className="text-xs text-gray-500 truncate">件名: {tpl.subject || '(未設定)'}</p>
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{tpl.body || '(本文なし)'}</p>
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            onClick={() => setEditingTemplate(tpl)}
                            className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => handleDeleteTemplate(tpl.id)}
                            className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded"
                          >
                            削除
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="px-6 py-4 border-t border-gray-200">
                  <button
                    onClick={() => setEditingTemplate({ name: '', subject: '', body: '' })}
                    className="w-full px-4 py-2 border border-dashed border-gray-300 text-sm text-gray-600 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-colors"
                  >
                    + 新しいテンプレートを追加
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast notifications */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`px-4 py-3 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${
              t.type === 'success' ? 'bg-green-600' :
              t.type === 'error' ? 'bg-red-600' :
              'bg-slate-700'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
