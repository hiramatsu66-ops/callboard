'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import type {
  Lead,
  LeadStatus,
  CallResult,
  CallLog,
  Profile,
} from '@/lib/types';
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_COLORS,
  CALL_RESULT_LABELS,
  CALL_RESULT_COLORS,
} from '@/lib/types';
import Papa from 'papaparse';

const PAGE_SIZE = 15;

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all');
  const [assignedFilter, setAssignedFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [showImportModal, setShowImportModal] = useState(false);
  const [csvData, setCsvData] = useState<Record<string, string>[]>([]);
  const [importing, setImporting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ company_name: '', phone: '', contact_name: '', homepage: '', memo: '' });
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

  const supabase = createClient();

  const loadLeads = useCallback(async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('leads')
        .select('*', { count: 'exact' });

      if (search) {
        query = query.or(
          `company_name.ilike.%${search}%,contact_name.ilike.%${search}%,phone.ilike.%${search}%`
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
  }, [page, search, statusFilter, assignedFilter]);

  useEffect(() => {
    const loadProfiles = async () => {
      const { data } = await supabase.from('profiles').select('*');
      setProfiles(data || []);
    };
    loadProfiles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    } else if (field === 'next_activity_date') {
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
    } else {
      setSelectedIds(new Set(leads.map(l => l.id)));
    }
  };

  const handleBulkAssign = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    await supabase
      .from('leads')
      .update({ assigned_to: bulkAssignTo || null })
      .in('id', ids);
    setSelectedIds(new Set());
    setBulkAssignTo('');
    loadLeads();
  };

  const handleBulkStatus = async () => {
    if (selectedIds.size === 0 || !bulkStatus) return;
    const ids = Array.from(selectedIds);
    await supabase
      .from('leads')
      .update({ status: bulkStatus })
      .in('id', ids);
    setSelectedIds(new Set());
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
      homepage: row['HP'] || row['homepage'] || row['URL'] || '',
      status: 'new' as const,
      memo: row['メモ'] || row['memo'] || '',
    }));

    const validLeads = leadsToInsert.filter(
      (l) => l.company_name && l.phone
    );

    if (validLeads.length > 0) {
      await supabase.from('leads').insert(validLeads);
    }

    setShowImportModal(false);
    setCsvData([]);
    setImporting(false);
    setPage(0);
    loadLeads();
  };

  const handleAdd = async () => {
    if (!addForm.company_name || !addForm.phone) return;
    setAdding(true);
    await supabase.from('leads').insert({
      company_name: addForm.company_name,
      phone: addForm.phone,
      contact_name: addForm.contact_name || '',
      homepage: addForm.homepage || '',
      status: 'new' as const,
      memo: addForm.memo || '',
    });
    setShowAddModal(false);
    setAddForm({ company_name: '', phone: '', contact_name: '', homepage: '', memo: '' });
    setAdding(false);
    setPage(0);
    loadLeads();
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

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
    <div className="flex h-full">
      {/* Main content */}
      <div className={`flex-1 space-y-6 transition-all ${selectedLead ? 'mr-0' : ''}`}>
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
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
            <span className="text-sm font-medium text-blue-800">{selectedIds.size}件選択中</span>
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
                onClick={() => setSelectedIds(new Set())}
                className="px-2 py-1 text-sm text-gray-500 hover:text-gray-700"
              >
                選択解除
              </button>
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
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
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
                      <th className="text-left py-3 px-3 text-sm font-medium text-gray-500">HP</th>
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
                        className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
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
                              {profiles.find(p => p.id === lead.assigned_to)?.name || '未割当'}
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
        <div className="w-96 flex-shrink-0 border-l border-gray-200 bg-white ml-6 rounded-lg shadow-sm overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 7rem)' }}>
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
                    担当: {profiles.find(p => p.id === selectedLead.assigned_to)?.name || '未割当'}
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-800">リード新規追加</h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setAddForm({ company_name: '', phone: '', contact_name: '', homepage: '', memo: '' });
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
                  setAddForm({ company_name: '', phone: '', contact_name: '', homepage: '', memo: '' });
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-2xl mx-4">
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
              <p className="text-sm text-gray-600 mb-4">
                CSVファイルをアップロードしてください。ヘッダー行に「会社名」「電話番号」「担当者名」「HP」「メモ」を含めてください。
              </p>
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
    </div>
  );
}
