'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import type {
  Lead,
  LeadStatus,
  Profile,
} from '@/lib/types';
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_COLORS,
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

  const router = useRouter();
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

  return (
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
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">
                    会社名
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">
                    担当者名
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">
                    電話番号
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">
                    HP
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">
                    ステータス
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">
                    担当
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">
                    更新日
                  </th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    onClick={() => router.push(`/leads/${lead.id}`)}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="py-3 px-4 text-sm font-medium text-gray-800">
                      {lead.company_name}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {lead.contact_name || '-'}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {lead.phone}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {lead.homepage ? (
                        <a
                          href={lead.homepage.startsWith('http') ? lead.homepage : `https://${lead.homepage}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-blue-600 hover:underline"
                        >
                          {lead.homepage.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                        </a>
                      ) : '-'}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${LEAD_STATUS_COLORS[lead.status]}`}
                      >
                        {LEAD_STATUS_LABELS[lead.status]}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {profiles.find(p => p.id === lead.assigned_to)?.name || '未割当'}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-400">
                      {new Date(lead.updated_at).toLocaleDateString('ja-JP')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

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
