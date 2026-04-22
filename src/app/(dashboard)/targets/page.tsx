'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase';
import type { Target, Profile, PeriodType } from '@/lib/types';
import { startOfMonth, startOfWeek, endOfMonth, format } from 'date-fns';

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

  // Actual progress state (for current month)
  const [actualCalls, setActualCalls] = useState(0);
  const [actualConnects, setActualConnects] = useState(0);
  const [actualAppointments, setActualAppointments] = useState(0);

  // Manager: per-member editing state
  interface MemberProgress {
    userId: string;
    name: string;
    targetCalls: number;
    targetConnects: number;
    targetAppointments: number;
    actualCalls: number;
    actualConnects: number;
    actualAppointments: number;
    targetId: string | null;
  }
  const [memberProgress, setMemberProgress] = useState<MemberProgress[]>([]);
  const [managerSaving, setManagerSaving] = useState<string | null>(null);

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

      // Load actual call_logs for current month
      const monthEnd = format(endOfMonth(new Date()), 'yyyy-MM-dd');
      const { data: callLogsData } = await supabase
        .from('call_logs')
        .select('result')
        .eq('caller_id', user.id)
        .gte('called_at', monthStartStr)
        .lte('called_at', monthEnd + 'T23:59:59');

      const logs = callLogsData || [];
      setActualCalls(logs.length);
      setActualConnects(logs.filter((l) => l.result === 'connected' || l.result === 'appointment').length);
      setActualAppointments(logs.filter((l) => l.result === 'appointment').length);

      // Manager: load all members' progress for current month
      if (profile && profile.role === 'manager') {
        const allProfiles = profilesData || [];
        const callerProfiles = allProfiles.filter((p) => p.role !== 'manager');

        const { data: allLogs } = await supabase
          .from('call_logs')
          .select('caller_id, result')
          .gte('called_at', monthStartStr)
          .lte('called_at', monthEnd + 'T23:59:59');

        const memberStats: MemberProgress[] = callerProfiles.map((p) => {
          const memberLogs = (allLogs || []).filter((l) => l.caller_id === p.id);
          const existingTarget = (targetsData || []).find(
            (t) => t.user_id === p.id && t.period_type === 'monthly' && t.period_start === monthStartStr
          );
          return {
            userId: p.id,
            name: p.name,
            targetCalls: existingTarget?.target_calls ?? 0,
            targetConnects: existingTarget?.target_connects ?? 0,
            targetAppointments: existingTarget?.target_appointments ?? 0,
            actualCalls: memberLogs.length,
            actualConnects: memberLogs.filter((l) => l.result === 'connected' || l.result === 'appointment').length,
            actualAppointments: memberLogs.filter((l) => l.result === 'appointment').length,
            targetId: existingTarget?.id ?? null,
          };
        });
        setMemberProgress(memberStats);
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

  const handleSaveMemberTarget = async (member: MemberProgress) => {
    setManagerSaving(member.userId);
    const { data: existing } = await supabase
      .from('targets')
      .select('id')
      .eq('user_id', member.userId)
      .eq('period_type', 'monthly')
      .eq('period_start', format(startOfMonth(new Date()), 'yyyy-MM-dd'))
      .single();

    if (existing) {
      await supabase
        .from('targets')
        .update({
          target_calls: member.targetCalls,
          target_connects: member.targetConnects,
          target_appointments: member.targetAppointments,
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('targets').insert({
        user_id: member.userId,
        period_type: 'monthly',
        period_start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
        target_calls: member.targetCalls,
        target_connects: member.targetConnects,
        target_appointments: member.targetAppointments,
      });
    }
    setManagerSaving(null);
    loadData();
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

      {/* Manager: Team Member Targets & Progress */}
      {currentUserRole === 'manager' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">
            チームメンバー目標設定・進捗確認
          </h2>
          <p className="text-xs text-gray-500 mb-5">
            {format(startOfMonth(new Date()), 'yyyy/MM')} 月次目標
          </p>
          {memberProgress.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">
              メンバーが見つかりません
            </p>
          ) : (
            <div className="space-y-4">
              {memberProgress.map((member) => {
                const callPct = member.targetCalls > 0
                  ? Math.min(100, Math.round((member.actualCalls / member.targetCalls) * 100))
                  : null;
                const apptPct = member.targetAppointments > 0
                  ? Math.min(100, Math.round((member.actualAppointments / member.targetAppointments) * 100))
                  : null;
                const barColor = (pct: number | null) =>
                  pct === null ? 'bg-gray-300' : pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';

                return (
                  <div key={member.userId} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-medium text-gray-800">{member.name}</span>
                      <button
                        onClick={() => handleSaveMemberTarget(member)}
                        disabled={managerSaving === member.userId}
                        className="px-3 py-1 bg-slate-700 text-white text-xs rounded hover:bg-slate-600 transition-colors disabled:opacity-50"
                      >
                        {managerSaving === member.userId ? '保存中...' : '保存'}
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">目標架電数</label>
                        <input
                          type="number"
                          value={member.targetCalls}
                          onChange={(e) =>
                            setMemberProgress((prev) =>
                              prev.map((m) =>
                                m.userId === member.userId
                                  ? { ...m, targetCalls: Number(e.target.value) }
                                  : m
                              )
                            )
                          }
                          min={0}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">目標接続数</label>
                        <input
                          type="number"
                          value={member.targetConnects}
                          onChange={(e) =>
                            setMemberProgress((prev) =>
                              prev.map((m) =>
                                m.userId === member.userId
                                  ? { ...m, targetConnects: Number(e.target.value) }
                                  : m
                              )
                            )
                          }
                          min={0}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">目標アポ数</label>
                        <input
                          type="number"
                          value={member.targetAppointments}
                          onChange={(e) =>
                            setMemberProgress((prev) =>
                              prev.map((m) =>
                                m.userId === member.userId
                                  ? { ...m, targetAppointments: Number(e.target.value) }
                                  : m
                              )
                            )
                          }
                          min={0}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-slate-400"
                        />
                      </div>
                    </div>
                    {/* Progress bars */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gray-50 rounded p-2">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>架電 実績</span>
                          <span className="font-medium text-gray-700">
                            {member.actualCalls}{member.targetCalls > 0 ? ` / ${member.targetCalls}` : ''}
                            {callPct !== null && ` (${callPct}%)`}
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${barColor(callPct)} rounded-full`}
                            style={{ width: `${callPct ?? 0}%` }}
                          />
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded p-2">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>アポ 実績</span>
                          <span className="font-medium text-gray-700">
                            {member.actualAppointments}{member.targetAppointments > 0 ? ` / ${member.targetAppointments}` : ''}
                            {apptPct !== null && ` (${apptPct}%)`}
                          </span>
                        </div>
                        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${barColor(apptPct)} rounded-full`}
                            style={{ width: `${apptPct ?? 0}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 今月の進捗 */}
      {currentUserRole !== 'manager' && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            今月の進捗（{format(startOfMonth(new Date()), 'yyyy/MM')}）
          </h2>
          <div className="grid grid-cols-3 gap-4">
            {([
              { label: '架電数', actual: actualCalls, target: monthlyForm.calls, color: 'text-slate-800' },
              { label: '接続数', actual: actualConnects, target: monthlyForm.connects, color: 'text-blue-600' },
              { label: 'アポ数', actual: actualAppointments, target: monthlyForm.appointments, color: 'text-green-600' },
            ] as { label: string; actual: number; target: number; color: string }[]).map(({ label, actual, target, color }) => {
              const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : null;
              const barColor = pct === null ? 'bg-gray-300' : pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
              return (
                <div key={label} className="bg-gray-50 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">{label}</p>
                  <p className={`text-2xl font-bold ${color}`}>{actual}</p>
                  {target > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5">目標 {target}</p>
                  )}
                  {pct !== null && (
                    <div className="mt-2">
                      <div className="flex justify-between text-xs text-gray-500 mb-0.5">
                        <span>達成率</span>
                        <span>{pct}%</span>
                      </div>
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div className={`h-full ${barColor} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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
