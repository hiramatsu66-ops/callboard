'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import type { Target, Profile, PeriodType } from '@/lib/types';
import { startOfMonth, startOfWeek, format } from 'date-fns';

interface PeriodForm {
  periodStart: string;
  calls: number;
  connects: number;
  appointments: number;
}

export default function TargetsPage() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [currentUserRole, setCurrentUserRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 3-section form state
  const [dailyForm, setDailyForm] = useState<PeriodForm>({
    periodStart: format(new Date(), 'yyyy-MM-dd'),
    calls: 0,
    connects: 0,
    appointments: 0,
  });
  const [weeklyForm, setWeeklyForm] = useState<PeriodForm>({
    periodStart: format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    calls: 0,
    connects: 0,
    appointments: 0,
  });
  const [monthlyForm, setMonthlyForm] = useState<PeriodForm>({
    periodStart: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    calls: 0,
    connects: 0,
    appointments: 0,
  });

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

      // Pre-fill forms with existing targets
      const userTargets = (targetsData || []).filter((t) => t.user_id === user.id);

      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const weekStartStr = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const monthStartStr = format(startOfMonth(new Date()), 'yyyy-MM-dd');

      const existingDaily = userTargets.find(
        (t) => t.period_type === 'daily' && t.period_start === todayStr
      );
      if (existingDaily) {
        setDailyForm({
          periodStart: todayStr,
          calls: existingDaily.target_calls,
          connects: existingDaily.target_connects,
          appointments: existingDaily.target_appointments,
        });
      }

      const existingWeekly = userTargets.find(
        (t) => t.period_type === 'weekly' && t.period_start === weekStartStr
      );
      if (existingWeekly) {
        setWeeklyForm({
          periodStart: weekStartStr,
          calls: existingWeekly.target_calls,
          connects: existingWeekly.target_connects,
          appointments: existingWeekly.target_appointments,
        });
      }

      const existingMonthly = userTargets.find(
        (t) => t.period_type === 'monthly' && t.period_start === monthStartStr
      );
      if (existingMonthly) {
        setMonthlyForm({
          periodStart: monthStartStr,
          calls: existingMonthly.target_calls,
          connects: existingMonthly.target_connects,
          appointments: existingMonthly.target_appointments,
        });
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

  const upsertTarget = async (periodType: PeriodType, form: PeriodForm) => {
    const { data: existing } = await supabase
      .from('targets')
      .select('id')
      .eq('user_id', currentUserId)
      .eq('period_type', periodType)
      .eq('period_start', form.periodStart)
      .single();

    if (existing) {
      await supabase
        .from('targets')
        .update({
          target_calls: form.calls,
          target_connects: form.connects,
          target_appointments: form.appointments,
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('targets').insert({
        user_id: currentUserId,
        period_type: periodType,
        period_start: form.periodStart,
        target_calls: form.calls,
        target_connects: form.connects,
        target_appointments: form.appointments,
      });
    }
  };

  const handleSaveAll = async () => {
    setSaving(true);
    await Promise.all([
      upsertTarget('daily', dailyForm),
      upsertTarget('weekly', weeklyForm),
      upsertTarget('monthly', monthlyForm),
    ]);
    setSaving(false);
    loadData();
  };

  const periodLabel = (type: PeriodType) => {
    switch (type) {
      case 'daily': return '日次';
      case 'weekly': return '週次';
      case 'monthly': return '月次';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  const PeriodSection = ({
    label,
    color,
    form,
    onFormChange,
  }: {
    label: string;
    color: string;
    form: PeriodForm;
    onFormChange: (f: PeriodForm) => void;
  }) => (
    <div className={`border-l-4 ${color} pl-4`}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-semibold text-gray-700">{label}</span>
        <input
          type="date"
          value={form.periodStart}
          onChange={(e) => onFormChange({ ...form, periodStart: e.target.value })}
          className="px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">目標架電数</label>
          <input
            type="number"
            value={form.calls}
            onChange={(e) => onFormChange({ ...form, calls: Number(e.target.value) })}
            min={0}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">目標接続数</label>
          <input
            type="number"
            value={form.connects}
            onChange={(e) => onFormChange({ ...form, connects: Number(e.target.value) })}
            min={0}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">目標アポ数</label>
          <input
            type="number"
            value={form.appointments}
            onChange={(e) => onFormChange({ ...form, appointments: Number(e.target.value) })}
            min={0}
            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">目標設定</h1>

      {/* Target Setting Form - 3 sections */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-5">
          自分の目標を設定
        </h2>
        <div className="space-y-6">
          <PeriodSection
            label="日次"
            color="border-blue-400"
            form={dailyForm}
            onFormChange={setDailyForm}
          />
          <PeriodSection
            label="週次"
            color="border-amber-400"
            form={weeklyForm}
            onFormChange={setWeeklyForm}
          />
          <PeriodSection
            label="月次"
            color="border-green-400"
            form={monthlyForm}
            onFormChange={setMonthlyForm}
          />
        </div>
        <div className="mt-6">
          <button
            onClick={handleSaveAll}
            disabled={saving}
            className="px-6 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            {saving ? '保存中...' : '3種類まとめて保存'}
          </button>
        </div>
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
