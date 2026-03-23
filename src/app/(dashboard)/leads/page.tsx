'use client';

import { useEffect, useState, useCallback, useMemo, memo } from 'react';
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
} from '@/lib/types';
import Papa from 'papaparse';

const PAGE_SIZE = 15;
const supabase = createClient();

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all');
  const [assignedFilter, setAssignedFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
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

  // Edit call log state
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editLogResult, setEditLogResult] = useState<CallResult>('no_answer');
  const [editLogMemo, setEditLogMemo] = useState('');

  // Inline edit state: { leadId-field: value }
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editCellValue, setEditCellValue] = useState('');

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAssignTo, setBulkAssignTo] = useState('');
  const [bulkStatus, setBulkStatus] = useState('');
  const [selectAllPages, setSelectAllPages] = useState(false);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadLeads = useCallback(async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('leads')
        .select('*', { count: 'exact' });

      if (debouncedSearch) {
        query = query.or(
          `company_name.ilike.%${debouncedSearch}%,contact_name.ilike.%${debouncedSearch}%,phone.ilike.%${debouncedSearch}%`
        );
      }

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (assignedFilter !== 'all') {
        if (assignedFilter === 'unassigned') {
          query = query.is('assigned_to', null);
        } else {
          query = query.eq('assigned_to', assignedFilter);
        }
      }

      const { data, count } = await query
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      setLeads(data || []);
      setTotalCount(count || 0);
    } catch (err) {
      console.error('Load leads error:', err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, statusFilter, assignedFilter]);

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
  const loadSidebarData = useCallback(async (lead: Lead) => {
    setSidebarLoading(true);
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

  const handleRecordActivity = async (result: CallResult) => {
    if (!selectedLead) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('call_logs').insert({
      lead_id: selectedLead.id,
      caller_id: user.id,
      result,
      memo: activityMemo,
    });

    let newStatus: LeadStatus = selectedLead.status;
    if (result === 'appointment') newStatus = 'appointment';
    else if (result === 'connected') newStatus = 'contacted';
    else if (result === 'invalid') newStatus = 'excluded';
    else if (result === 'rejected') newStatus = 'dnc';
    else if (newStatus === 'new') newStatus = 'calling';

    await supabase
      .from('leads')
      .update({
        status: newStatus,
        next_activity_date: nextActivityDate || null,
      })
      .eq('id', selectedLead.id);

    setActivityMemo('');
    const { data: updatedLead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', selectedLead.id)
      .single();
    if (updatedLead) {
      setSelectedLead(updatedLead);
      setNextActivityDate(updatedLead.next_activity_date || '');
    }
    loadSidebarData(updatedLead || selectedLead);
    loadLeads();
  };

  const handleUpdateNextActivityDate = async (date: string) => {
    if (!selectedLead) return;
    setNextActivityDate(date);
    await supabase
      .from('leads')
      .update({ next_activity_date: date || null })
      .eq('id', selectedLead.id);
    loadLeads();
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
    } else if (field === 'next_activity_date' || field === 'inquiry_date') {
      updateData[field] = editCellValue || null;
    } else if (field === 'status') {
      updateData[field] = editCellValue;
    } else {
      updateData[field] = editCellValue;
    }
    await supabase.from('leads').update(updateData).eq('id', leadId);
    setEditingCell(null);
    loadLeads();
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
    if (debouncedSearch) {
      query = query.or(
        `company_name.ilike.%${debouncedSearch}%,contact_name.ilike.%${debouncedSearch}%,phone.ilike.%${debouncedSearch}%`
      );
    }
    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }
    if (assignedFilter !== 'all') {
      if (assignedFilter === 'unassigned') {
        query = query.is('assigned_to', null);
      } else {
        query = query.eq('assigned_to', assignedFilter);
      }
    }
    return query;
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

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setCsvData(results.data as Record<string, string>[]);
      },
    });
  };

  const handleImport = async () => {
    if (csvData.length === 0) return;
    setImporting(true);

    const leadsToInsert = csvData.map((row) => ({
      company_name: row['会社名'] || row['company_name'] || '',
      phone: row['電話番号'] || row['phone'] || '',
      contact_name: row['担当者名'] || row['contact_name'] || '',
      email: row['メールアドレス'] || row['email'] || '',
      homepage: row['HP'] || row['homepage'] || row['URL'] || '',
      lead_source: row['流入経路'] || row['lead_source'] || '',
      inquiry_date: row['問い合わせ日'] || row['inquiry_date'] || null,
      inquiry_content: row['問い合わせ内容'] || row['inquiry_content'] || '',
      status: 'new' as const,
      memo: row['メモ'] || row['memo'] || '',
    }));

    const validLeads = leadsToInsert.filter(
      (l) => l.company_name && l.phone
    );

    if (validLeads.length === 0) {
      setImporting(false);
      return;
    }

    // Check duplicates by company_name
    const names = validLeads.map(l => l.company_name);
    const { data: existingByName } = await supabase
      .from('leads')
      .select('company_name')
      .in('company_name', names);
    const dupNames = new Set((existingByName || []).map(r => r.company_name));

    // Check duplicates by email
    const emails = validLeads.map(l => l.email).filter(e => e);
    let dupEmails = new Set<string>();
    if (emails.length > 0) {
      const { data: existingByEmail } = await supabase
        .from('leads')
        .select('email')
        .in('email', emails);
      dupEmails = new Set((existingByEmail || []).map(r => r.email));
    }

    const newLeads = validLeads.filter(l => !dupNames.has(l.company_name) && (!l.email || !dupEmails.has(l.email)));
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

    await supabase.from('leads').insert(newLeads);

    setShowImportModal(false);
    setCsvData([]);
    setImporting(false);
    setPage(0);
    loadLeads();
  };

  const checkDuplicate = async (companyName: string, email: string): Promise<string | null> => {
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
    return null;
  };

  const handleAdd = async () => {
    if (!addForm.company_name || !addForm.phone) return;
    setAdding(true);

    const dupMsg = await checkDuplicate(addForm.company_name, addForm.email);
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

  return (
    <div className="relative h-full">
      {/* Main content */}
      <div className="space-y-6">
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

        {/* Bulk actions bar */}
        {selectedIds.size > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 space-y-1">
            {selectedIds.size === leads.length && totalCount > leads.length && !selectAllPages && (
              <div className="text-sm text-center text-blue-700">
                このページの{leads.length}件を選択中。
                <button
                  onClick={() => setSelectAllPages(true)}
                  className="ml-1 font-medium text-blue-900 underline hover:text-blue-700"
                >
                  全{totalCount}件を選択
                </button>
              </div>
            )}
            {selectAllPages && (
              <div className="text-sm text-center text-blue-700">
                全{totalCount}件を選択中。
                <button
                  onClick={() => { setSelectAllPages(false); setSelectedIds(new Set(leads.map(l => l.id))); }}
                  className="ml-1 font-medium text-blue-900 underline hover:text-blue-700"
                >
                  このページのみに戻す
                </button>
              </div>
            )}
            <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-blue-800">{selectAllPages ? totalCount : selectedIds.size}件選択中</span>
            <div className="flex items-center gap-2 ml-auto">
              <select
                value={bulkAssignTo}
                onChange={(e) => setBulkAssignTo(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-sm bg-white"
              >
                <option value="">担当を選択</option>
                <option value="">未割当</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button
                onClick={handleBulkAssign}
                className="px-3 py-1 bg-slate-800 text-white text-sm rounded hover:bg-slate-700"
              >
                担当を一括変更
              </button>
              <span className="text-gray-300">|</span>
              <select
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-sm bg-white"
              >
                <option value="">ステータスを選択</option>
                {Object.entries(LEAD_STATUS_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <button
                onClick={handleBulkStatus}
                disabled={!bulkStatus}
                className="px-3 py-1 bg-slate-800 text-white text-sm rounded hover:bg-slate-700 disabled:opacity-50"
              >
                ステータスを一括変更
              </button>
              <button
                onClick={() => { setSelectedIds(new Set()); setSelectAllPages(false); }}
                className="px-2 py-1 text-sm text-gray-500 hover:text-gray-700"
              >
                選択解除
              </button>
            </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="会社名・担当者名・電話番号で検索..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as LeadStatus | 'all');
              setPage(0);
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
          >
            <option value="all">全てのステータス</option>
            {Object.entries(LEAD_STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={assignedFilter}
            onChange={(e) => {
              setAssignedFilter(e.target.value);
              setPage(0);
            }}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
          >
            <option value="all">全ての担当者</option>
            <option value="unassigned">未割当</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
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
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-3 px-3 w-8">
                        <input
                          type="checkbox"
                          checked={selectedIds.size === leads.length && leads.length > 0}
                          onChange={toggleSelectAll}
                          className="rounded border-gray-300"
                        />
                      </th>
                      <th className="text-left py-3 px-3 text-sm font-medium text-gray-500">会社名</th>
                      <th className="text-left py-3 px-3 text-sm font-medium text-gray-500">担当者名</th>
                      <th className="text-left py-3 px-3 text-sm font-medium text-gray-500">電話番号</th>
                      <th className="text-left py-3 px-3 text-sm font-medium text-gray-500">メール</th>
                      <th className="text-left py-3 px-3 text-sm font-medium text-gray-500">HP</th>
                      <th className="text-left py-3 px-3 text-sm font-medium text-gray-500">流入経路</th>
                      <th className="text-left py-3 px-3 text-sm font-medium text-gray-500">問い合わせ日</th>
                      <th className="text-left py-3 px-3 text-sm font-medium text-gray-500">問い合わせ内容</th>
                      <th className="text-left py-3 px-3 text-sm font-medium text-gray-500">ステータス</th>
                      <th className="text-left py-3 px-3 text-sm font-medium text-gray-500">次回予定</th>
                      <th className="text-left py-3 px-3 text-sm font-medium text-gray-500">担当</th>
                      <th className="text-left py-3 px-3 text-sm font-medium text-gray-500">メモ</th>
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
                        {/* Company name */}
                        <td className="py-2 px-3 text-sm font-medium text-gray-800">
                          {renderEditableText(lead, 'company_name', lead.company_name)}
                        </td>
                        {/* Contact name */}
                        <td className="py-2 px-3 text-sm text-gray-600">
                          {renderEditableText(lead, 'contact_name', lead.contact_name || '')}
                        </td>
                        {/* Phone */}
                        <td className="py-2 px-3 text-sm text-gray-600">
                          {renderEditableText(lead, 'phone', lead.phone)}
                        </td>
                        {/* Email */}
                        <td className="py-2 px-3 text-sm text-gray-600">
                          {renderEditableText(lead, 'email', lead.email || '')}
                        </td>
                        {/* Homepage */}
                        <td className="py-2 px-3 text-sm text-gray-600">
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
                        {/* Lead source */}
                        <td className="py-2 px-3 text-sm text-gray-600">
                          {renderEditableText(lead, 'lead_source', lead.lead_source || '')}
                        </td>
                        {/* Inquiry date */}
                        <td className="py-2 px-3 text-sm" onClick={(e) => e.stopPropagation()}>
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
                        {/* Inquiry content */}
                        <td className="py-2 px-3 text-sm text-gray-500 max-w-[150px]">
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
                        {/* Status */}
                        <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
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
                        {/* Next activity date */}
                        <td className="py-2 px-3 text-sm" onClick={(e) => e.stopPropagation()}>
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
                        {/* Assigned to */}
                        <td className="py-2 px-3 text-sm" onClick={(e) => e.stopPropagation()}>
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
                        {/* Memo */}
                        <td className="py-2 px-3 text-sm text-gray-500 max-w-[150px]">
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
                      onClick={() => setPage(Math.max(0, page - 1))}
                      disabled={page === 0}
                      className="px-3 py-1 text-sm border border-gray-300 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                    >
                      前へ
                    </button>
                    <button
                      onClick={() =>
                        setPage(Math.min(totalPages - 1, page + 1))
                      }
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
                <p className="text-xs text-gray-600">流入経路: {selectedLead.lead_source || '-'}</p>
                <p className="text-xs text-gray-600">問い合わせ日: {selectedLead.inquiry_date ? new Date(selectedLead.inquiry_date).toLocaleDateString('ja-JP') : '-'}</p>
                <p className="text-xs text-gray-600">問い合わせ内容: {selectedLead.inquiry_content || '-'}</p>
                {selectedLead.email && (
                  <div className="pt-1">
                    <button
                      onClick={() => setShowMailPanel(!showMailPanel)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      メールを送る
                    </button>
                    {showMailPanel && (
                      <div className="mt-2 p-2 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
                        <p className="text-[10px] text-gray-500">宛先: {selectedLead.email}</p>
                        <a
                          href={buildGmailUrl()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-full text-center px-2 py-1.5 border border-gray-300 rounded text-xs text-gray-700 hover:bg-white transition-colors"
                        >
                          空のメールを作成
                        </a>
                        {emailTemplates.length > 0 && (
                          <div className="border-t border-gray-200 pt-2">
                            <p className="text-[10px] font-medium text-gray-500 mb-1">テンプレートから作成</p>
                            {emailTemplates.map((tpl) => (
                              <a
                                key={tpl.id}
                                href={buildGmailUrl(tpl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block w-full text-left px-2 py-1.5 text-xs text-blue-700 hover:bg-blue-50 rounded transition-colors"
                              >
                                {tpl.name}
                              </a>
                            ))}
                          </div>
                        )}
                        <button
                          onClick={() => setShowTemplateEditor(true)}
                          className="w-full text-center px-2 py-1.5 border border-dashed border-gray-300 rounded text-[10px] text-gray-500 hover:text-gray-700 hover:border-gray-400 transition-colors"
                        >
                          テンプレートを管理
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {selectedLead.memo && (
                  <p className="text-xs text-gray-500">メモ: {selectedLead.memo}</p>
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
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.keys(CALL_RESULT_LABELS) as CallResult[]).map((result) => (
                    <button
                      key={result}
                      onClick={() => handleRecordActivity(result)}
                      className={`py-2 px-1 rounded-lg text-xs font-medium transition-colors ${CALL_RESULT_COLORS[result]}`}
                    >
                      {CALL_RESULT_LABELS[result]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Activity History */}
              <div className="px-4 py-3">
                <h3 className="text-xs font-semibold text-gray-700 mb-2">活動履歴</h3>
                {sidebarCallLogs.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">まだ活動履歴がありません</p>
                ) : (
                  <div className="space-y-3">
                    {sidebarCallLogs.map((log) => (
                      <div key={log.id} className="border-l-2 border-gray-200 pl-3 py-0.5">
                        {editingLogId === log.id ? (
                          <div className="space-y-2">
                            <select
                              value={editLogResult}
                              onChange={(e) => setEditLogResult(e.target.value as CallResult)}
                              className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-slate-500 bg-white"
                            >
                              {(Object.keys(CALL_RESULT_LABELS) as CallResult[]).map((r) => (
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
                              <button
                                onClick={handleSaveEditLog}
                                className="px-2 py-1 bg-slate-800 text-white text-[10px] rounded hover:bg-slate-700"
                              >
                                保存
                              </button>
                              <button
                                onClick={() => setEditingLogId(null)}
                                className="px-2 py-1 text-[10px] text-gray-500 hover:text-gray-700"
                              >
                                キャンセル
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <span className={`inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium ${CALL_RESULT_COLORS[log.result].replace(/hover:\S+/g, '')}`}>
                                {CALL_RESULT_LABELS[log.result]}
                              </span>
                              <span className="text-[10px] text-gray-400">
                                {new Date(log.called_at).toLocaleString('ja-JP', {
                                  month: 'numeric',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              <span className="flex-1" />
                              <button
                                onClick={() => handleStartEditLog(log)}
                                className="text-[10px] text-gray-400 hover:text-blue-600"
                              >
                                編集
                              </button>
                              <button
                                onClick={() => handleDeleteLog(log.id)}
                                className="text-[10px] text-gray-400 hover:text-red-600"
                              >
                                削除
                              </button>
                            </div>
                            {log.memo && (
                              <p className="text-xs text-gray-600 mt-0.5">{log.memo}</p>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
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
          tabIndex={-1}
          ref={(el) => el?.focus()}
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
            <div className="px-6 py-4 space-y-4">
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
                <input
                  type="text"
                  value={addForm.lead_source}
                  onChange={(e) => setAddForm({ ...addForm, lead_source: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent"
                  placeholder="例: Web問い合わせ"
                />
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

      {/* CSV Import Modal */}
      {showImportModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => { setShowImportModal(false); setCsvData([]); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { setShowImportModal(false); setCsvData([]); } }}
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
                <div className="mt-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">
                    プレビュー（{csvData.length}件）
                  </p>
                  <div className="max-h-64 overflow-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b">
                          {Object.keys(csvData[0]).map((key) => (
                            <th
                              key={key}
                              className="text-left py-2 px-3 font-medium text-gray-500"
                            >
                              {key}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {csvData.slice(0, 5).map((row, i) => (
                          <tr
                            key={i}
                            className="border-b border-gray-100"
                          >
                            {Object.values(row).map((val, j) => (
                              <td
                                key={j}
                                className="py-2 px-3 text-gray-600"
                              >
                                {val}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {csvData.length > 5 && (
                      <p className="text-xs text-gray-400 text-center py-2">
                        ...他 {csvData.length - 5}件
                      </p>
                    )}
                  </div>
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
                disabled={csvData.length === 0 || importing}
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
    </div>
  );
}
