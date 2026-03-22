'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import type { Target, Profile, PeriodType } from '@/lib/types';
import { startOfMonth, format } from 'date-fns';

export default function TargetsPage() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentUserRole, setCurrentUserRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [periodType, setPeriodType] = useState<PeriodType>('monthly');
  const [periodStart, setPeriodStart] = useState(
    format(startOfMonth(new Date()), 'yyyy-MM-dd')
  );
  const [targetCalls, setTargetCalls] = useState(0);
  const [targetConnects, setTargetConnects] = useState(0);
  const [targetAppointments, setTargetAppointments] = useState(0);

  const supabase = createClient();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setCurrentUserId(user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profile) {
        setCurrentUserRole(profile.role);
      }

      const { data: profilesData } = await supabase
        .from('profiles')
        .select('*');
      setProfiles(profilesData || []);

      const { data: targetsData } = await supabase
        .from('targets')
        .select('*')
        .order('period_start', { ascending: false });

      setTargets(targetsData || []);

      // Pre-fill form with existing target if any
      const existingTarget = (targetsData || []).find(
        (t) =>
          t.user_id === user.id &&
          t.period_type === 'monthly' &&
          t.period_start === format(startOfMonth(new Date()), 'yyyy-MM-dd')
      );
      if (existingTarget) {
        setTargetCalls(existingTarget.target_calls);
        setTargetConnects(existingTarget.target_connects);
        setTargetAppointments(existingTarget.target_appointments);
      }
    } catch (err) {
      console.error('Load targets error:', err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    setSaving(true);

    // Check if target exists for this user/period
    const { data: existing } = await supabase
      .from('targets')
      .select('id')
      .eq('user_id', currentUserId)
      .eq('period_type', periodType)
      .eq('period_start', periodStart)
      .single();

    if (existing) {
      await supabase
        .from('targets')
        .update({
          target_calls: targetCalls,
          target_connects: targetConnects,
          target_appointments: targetAppointments,
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('targets').insert({
        user_id: currentUserId,
        period_type: periodType,
        period_start: periodStart,
        target_calls: targetCalls,
        target_connects: targetConnects,
        target_appointments: targetAppointments,
      });
    }

    setSaving(false);
    loadData();
  };

  const periodLabel = (type: PeriodType) => {
    switch (type) {
      case 'daily':
        return '日次';
      case 'weekly':
        return '週次';
      case 'monthly':
        return '月次';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">目標設定</h1>

      {/* Target Setting Form */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          自分の目標を設定
        </h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              期間タイプ
            </label>
            <select
              value={periodType}
              onChange={(e) => setPeriodType(e.target.value as PeriodType)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white"
            >
              <option value="daily">日次</option>
              <option value="weekly">週次</option>
              <option value="monthly">月次</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              期間開始日
            </label>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              目標架電数
            </label>
            <input
              type="number"
              value={targetCalls}
              onChange={(e) => setTargetCalls(Number(e.target.value))}
              min={0}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              目標接続数
            </label>
            <input
              type="number"
              value={targetConnects}
              onChange={(e) => setTargetConnects(Number(e.target.value))}
              min={0}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              目標アポ数
            </label>
            <input
              type="number"
              value={targetAppointments}
              onChange={(e) =>
                setTargetAppointments(Number(e.target.value))
              }
              min={0}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>

      {/* Team Targets View */}
      {currentUserRole === 'manager' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            チーム目標一覧
          </h2>
          {targets.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              目標が設定されていません
            </p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">
                    担当者
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">
                    期間
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">
                    開始日
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-500">
                    架電数
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-500">
                    接続数
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-500">
                    アポ数
                  </th>
                </tr>
              </thead>
              <tbody>
                {targets.map((target) => (
                  <tr
                    key={target.id}
                    className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <td className="py-3 px-4 text-sm font-medium text-gray-800">
                      {profiles.find(p => p.id === target.user_id)?.name || '不明'}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {periodLabel(target.period_type)}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-600">
                      {target.period_start}
                    </td>
                    <td className="py-3 px-4 text-sm text-right text-gray-700">
                      {target.target_calls}
                    </td>
                    <td className="py-3 px-4 text-sm text-right text-gray-700">
                      {target.target_connects}
                    </td>
                    <td className="py-3 px-4 text-sm text-right text-gray-700">
                      {target.target_appointments}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Personal Targets Summary (for callers) */}
      {currentUserRole !== 'manager' && targets.filter((t) => t.user_id === currentUserId).length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            自分の目標一覧
          </h2>
          <div className="space-y-4">
            {targets
              .filter((t) => t.user_id === currentUserId)
              .map((target) => (
                <div
                  key={target.id}
                  className="border border-gray-100 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-gray-800">
                      {periodLabel(target.period_type)} - {target.period_start}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <TargetCard
                      label="架電数"
                      value={target.target_calls}
                      color="text-slate-800"
                    />
                    <TargetCard
                      label="接続数"
                      value={target.target_connects}
                      color="text-blue-600"
                    />
                    <TargetCard
                      label="アポ数"
                      value={target.target_appointments}
                      color="text-green-600"
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TargetCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
