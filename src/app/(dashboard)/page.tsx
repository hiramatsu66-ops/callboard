'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import type { Profile, CallLog, Target, PeriodType } from '@/lib/types';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  startOfDay,
  startOfWeek,
  startOfMonth,
  endOfDay,
  endOfWeek,
  endOfMonth,
  subDays,
  subWeeks,
  subMonths,
  format,
  differenceInDays,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
} from 'date-fns';

type ViewMode = 'personal' | 'team';
type ExtendedPeriodType = PeriodType | 'custom';

interface KPIData {
  totalCalls: number;
  connects: number;
  appointments: number;
  connectRate: number;
  appointmentRate: number;
  appointmentFromConnectRate: number;
}

interface MemberStats {
  profile: Profile;
  calls: number;
  connects: number;
  appointments: number;
  connectRate: number;
  appointmentRate: number;
}

export default function DashboardPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><p className="text-gray-500">読み込み中...</p></div>}>
      <DashboardPage />
    </Suspense>
  );
}

function DashboardPage() {
  const searchParams = useSearchParams();
  const [periodType, setPeriodType] = useState<ExtendedPeriodType>(() => {
    const p = searchParams.get('period');
    if (p === 'custom') return 'custom';
    if (p === 'weekly') return 'weekly';
    if (p === 'monthly') return 'monthly';
    return 'daily';
  });
  const [customFrom, setCustomFrom] = useState(() => searchParams.get('from') || '');
  const [customTo, setCustomTo] = useState(() => searchParams.get('to') || '');
  const [viewMode, setViewMode] = useState<ViewMode>('team');
  const [kpi, setKPI] = useState<KPIData>({
    totalCalls: 0,
    connects: 0,
    appointments: 0,
    connectRate: 0,
    appointmentRate: 0,
    appointmentFromConnectRate: 0,
  });
  const [memberStats, setMemberStats] = useState<MemberStats[]>([]);
  const [trendData, setTrendData] = useState<Record<string, unknown>[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const getDateRange = useCallback(
    (type: ExtendedPeriodType) => {
      const now = new Date();
      switch (type) {
        case 'daily':
          return { start: startOfDay(now), end: endOfDay(now) };
        case 'weekly':
          return {
            start: startOfWeek(now, { weekStartsOn: 1 }),
            end: endOfWeek(now, { weekStartsOn: 1 }),
          };
        case 'monthly':
          return { start: startOfMonth(now), end: endOfMonth(now) };
        case 'custom': {
          const from = customFrom ? startOfDay(new Date(customFrom)) : startOfDay(subDays(now, 7));
          const to = customTo ? endOfDay(new Date(customTo)) : endOfDay(now);
          return { start: from, end: to };
        }
      }
    },
    [customFrom, customTo]
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setCurrentUserId(user.id);

      const { start, end } = getDateRange(periodType);

      // Fetch profiles
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*');

      // Fetch call logs for the period
      let callQuery = supabase
        .from('call_logs')
        .select('*')
        .gte('called_at', start.toISOString())
        .lte('called_at', end.toISOString());

    if (viewMode === 'personal') {
      callQuery = callQuery.eq('caller_id', user.id);
    }

    const { data: callLogs } = await callQuery;
    const logs: CallLog[] = callLogs || [];

    // Calculate KPI
    const totalCalls = logs.length;
    const connects = logs.filter(
      (l) => l.result === 'connected' || l.result === 'appointment'
    ).length;
    const appointments = logs.filter(
      (l) => l.result === 'appointment'
    ).length;

    setKPI({
      totalCalls,
      connects,
      appointments,
      connectRate: totalCalls > 0 ? (connects / totalCalls) * 100 : 0,
      appointmentRate:
        totalCalls > 0 ? (appointments / totalCalls) * 100 : 0,
      appointmentFromConnectRate:
        connects > 0 ? (appointments / connects) * 100 : 0,
    });

    // Calculate member stats
    if (profiles) {
      const stats: MemberStats[] = profiles
        .filter((p) => p.role === 'caller' || p.role === 'manager')
        .map((profile) => {
          const memberLogs = logs.filter(
            (l) => l.caller_id === profile.id
          );
          const memberCalls = memberLogs.length;
          const memberConnects = memberLogs.filter(
            (l) =>
              l.result === 'connected' || l.result === 'appointment'
          ).length;
          const memberAppointments = memberLogs.filter(
            (l) => l.result === 'appointment'
          ).length;
          return {
            profile,
            calls: memberCalls,
            connects: memberConnects,
            appointments: memberAppointments,
            connectRate:
              memberCalls > 0
                ? (memberConnects / memberCalls) * 100
                : 0,
            appointmentRate:
              memberCalls > 0
                ? (memberAppointments / memberCalls) * 100
                : 0,
          };
        })
        .filter((s) => s.calls > 0);
      setMemberStats(stats);
    }

    // Build trend data
    const trendPoints: Record<string, unknown>[] = [];

    if (periodType === 'custom') {
      const rangeStart = customFrom ? startOfDay(new Date(customFrom)) : startOfDay(subDays(new Date(), 7));
      const rangeEnd = customTo ? endOfDay(new Date(customTo)) : endOfDay(new Date());
      const daysDiff = differenceInDays(rangeEnd, rangeStart);

      // Determine granularity: <=7 days -> daily, 8-60 -> weekly, 61+ -> monthly
      if (daysDiff <= 7) {
        const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });
        for (const d of days) {
          let trendQuery = supabase.from('call_logs').select('result')
            .gte('called_at', startOfDay(d).toISOString())
            .lte('called_at', endOfDay(d).toISOString());
          if (viewMode === 'personal') trendQuery = trendQuery.eq('caller_id', user.id);
          const { data: tl } = await trendQuery;
          const tlogs = tl || [];
          trendPoints.push({ label: format(d, 'M/d'), calls: tlogs.length, connects: tlogs.filter(l => l.result === 'connected' || l.result === 'appointment').length, appointments: tlogs.filter(l => l.result === 'appointment').length });
        }
      } else if (daysDiff <= 60) {
        const weeks = eachWeekOfInterval({ start: rangeStart, end: rangeEnd }, { weekStartsOn: 1 });
        for (const w of weeks) {
          const wEnd = endOfWeek(w, { weekStartsOn: 1 });
          let trendQuery = supabase.from('call_logs').select('result')
            .gte('called_at', startOfDay(w).toISOString())
            .lte('called_at', wEnd.toISOString());
          if (viewMode === 'personal') trendQuery = trendQuery.eq('caller_id', user.id);
          const { data: tl } = await trendQuery;
          const tlogs = tl || [];
          trendPoints.push({ label: format(w, 'M/d') + '~', calls: tlogs.length, connects: tlogs.filter(l => l.result === 'connected' || l.result === 'appointment').length, appointments: tlogs.filter(l => l.result === 'appointment').length });
        }
      } else {
        const months = eachMonthOfInterval({ start: rangeStart, end: rangeEnd });
        for (const m of months) {
          const mEnd = endOfMonth(m);
          let trendQuery = supabase.from('call_logs').select('result')
            .gte('called_at', startOfMonth(m).toISOString())
            .lte('called_at', mEnd.toISOString());
          if (viewMode === 'personal') trendQuery = trendQuery.eq('caller_id', user.id);
          const { data: tl } = await trendQuery;
          const tlogs = tl || [];
          trendPoints.push({ label: format(m, 'yyyy/M'), calls: tlogs.length, connects: tlogs.filter(l => l.result === 'connected' || l.result === 'appointment').length, appointments: tlogs.filter(l => l.result === 'appointment').length });
        }
      }
    } else {
      const pointCount = periodType === 'daily' ? 7 : periodType === 'weekly' ? 4 : 6;
      for (let i = pointCount - 1; i >= 0; i--) {
        let pStart: Date, pEnd: Date, label: string;
        if (periodType === 'daily') {
          const d = subDays(new Date(), i);
          pStart = startOfDay(d); pEnd = endOfDay(d); label = format(d, 'M/d');
        } else if (periodType === 'weekly') {
          const d = subWeeks(new Date(), i);
          pStart = startOfWeek(d, { weekStartsOn: 1 }); pEnd = endOfWeek(d, { weekStartsOn: 1 }); label = format(pStart, 'M/d') + '~';
        } else {
          const d = subMonths(new Date(), i);
          pStart = startOfMonth(d); pEnd = endOfMonth(d); label = format(d, 'yyyy/M');
        }
        let trendQuery = supabase.from('call_logs').select('result')
          .gte('called_at', pStart.toISOString()).lte('called_at', pEnd.toISOString());
        if (viewMode === 'personal') trendQuery = trendQuery.eq('caller_id', user.id);
        const { data: trendLogs } = await trendQuery;
        const tl = trendLogs || [];
        trendPoints.push({
          label, calls: tl.length,
          connects: tl.filter(l => l.result === 'connected' || l.result === 'appointment').length,
          appointments: tl.filter(l => l.result === 'appointment').length,
        });
      }
    }
    setTrendData(trendPoints);

    // Fetch targets
    const targetPeriodType = periodType === 'custom' ? 'daily' : periodType;
    const { data: targetData } = await supabase
      .from('targets')
      .select('*')
      .eq('period_type', targetPeriodType);

    setTargets(targetData || []);
    } catch (err) {
      console.error('Dashboard load error:', err);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodType, viewMode, customFrom, customTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Sync period to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (periodType !== 'daily') params.set('period', periodType);
    if (periodType === 'custom') {
      if (customFrom) params.set('from', customFrom);
      if (customTo) params.set('to', customTo);
    }
    const qs = params.toString();
    window.history.replaceState(null, '', qs ? `/?${qs}` : '/');
  }, [periodType, customFrom, customTo]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">ダッシュボード</h1>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex bg-white rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setViewMode('personal')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === 'personal'
                  ? 'bg-slate-800 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              個人
            </button>
            <button
              onClick={() => setViewMode('team')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                viewMode === 'team'
                  ? 'bg-slate-800 text-white'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              チーム
            </button>
          </div>

          {/* Period selector */}
          <div className="flex bg-white rounded-lg border border-gray-200 overflow-hidden">
            {(
              [
                { key: 'daily', label: '日別' },
                { key: 'weekly', label: '週別' },
                { key: 'monthly', label: '月別' },
                { key: 'custom', label: 'カスタム' },
              ] as const
            ).map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriodType(p.key)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  periodType === p.key
                    ? 'bg-slate-800 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* Custom date pickers */}
          {periodType === 'custom' && (
            <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-200 px-3 py-1">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="text-sm border-0 focus:ring-0 focus:outline-none"
              />
              <span className="text-gray-400 text-sm">〜</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="text-sm border-0 focus:ring-0 focus:outline-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      {(() => {
        const myTarget = targets.find(t => t.user_id === currentUserId);
        return (
      <div className="grid grid-cols-6 gap-4">
        <KPICard
          label="架電数"
          value={kpi.totalCalls.toString()}
          unit="件"
          color="text-slate-800"
          target={viewMode === 'personal' && myTarget ? myTarget.target_calls : undefined}
          actual={viewMode === 'personal' ? kpi.totalCalls : undefined}
        />
        <KPICard
          label="担当接続数"
          value={kpi.connects.toString()}
          unit="件"
          color="text-blue-600"
          target={viewMode === 'personal' && myTarget ? myTarget.target_connects : undefined}
          actual={viewMode === 'personal' ? kpi.connects : undefined}
        />
        <KPICard
          label="アポ数"
          value={kpi.appointments.toString()}
          unit="件"
          color="text-green-600"
          target={viewMode === 'personal' && myTarget ? myTarget.target_appointments : undefined}
          actual={viewMode === 'personal' ? kpi.appointments : undefined}
        />
        <KPICard
          label="担当接続率"
          value={kpi.connectRate.toFixed(1)}
          unit="%"
          color="text-blue-600"
        />
        <KPICard
          label="アポ率"
          value={kpi.appointmentRate.toFixed(1)}
          unit="%"
          color="text-green-600"
        />
        <KPICard
          label="担当アポ率"
          value={kpi.appointmentFromConnectRate.toFixed(1)}
          unit="%"
          color="text-amber-600"
        />
      </div>
        );
      })()}

      {/* Trend Chart */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          推移グラフ
        </h2>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="calls"
              name="架電数"
              stroke="#1e293b"
              strokeWidth={2}
              dot={{ fill: '#1e293b' }}
            />
            <Line
              type="monotone"
              dataKey="connects"
              name="接続数"
              stroke="#2563eb"
              strokeWidth={2}
              dot={{ fill: '#2563eb' }}
            />
            <Line
              type="monotone"
              dataKey="appointments"
              name="アポ数"
              stroke="#22c55e"
              strokeWidth={2}
              dot={{ fill: '#22c55e' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Member Comparison Table */}
      {viewMode === 'team' && memberStats.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            担当者別実績
          </h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">
                  担当者
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
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-500">
                  接続率
                </th>
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-500">
                  アポ率
                </th>
              </tr>
            </thead>
            <tbody>
              {memberStats.map((m) => (
                <tr
                  key={m.profile.id}
                  className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                >
                  <td className="py-3 px-4 text-sm font-medium text-gray-800">
                    {m.profile.name}
                  </td>
                  <td className="py-3 px-4 text-sm text-right text-gray-700">
                    {m.calls}
                  </td>
                  <td className="py-3 px-4 text-sm text-right text-gray-700">
                    {m.connects}
                  </td>
                  <td className="py-3 px-4 text-sm text-right text-gray-700">
                    {m.appointments}
                  </td>
                  <td className="py-3 px-4 text-sm text-right text-gray-700">
                    {m.connectRate.toFixed(1)}%
                  </td>
                  <td className="py-3 px-4 text-sm text-right text-gray-700">
                    {m.appointmentRate.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
  );
}

function KPICard({
  label,
  value,
  unit,
  color,
  target,
  actual,
}: {
  label: string;
  value: string;
  unit: string;
  color: string;
  target?: number;
  actual?: number;
}) {
  const hasTarget = target !== undefined && actual !== undefined && target > 0;
  const pct = hasTarget ? (actual! / target!) * 100 : 0;
  const progressColor = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>
        {value}
        <span className="text-sm font-normal text-gray-400 ml-1">
          {unit}
        </span>
      </p>
      {hasTarget && (
        <div className="mt-2">
          <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
            <span>目標: {target}</span>
            <span>{Math.round(pct)}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${progressColor}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({
  label,
  actual,
  target,
  color,
}: {
  label: string;
  actual: number;
  target: number;
  color: string;
}) {
  const percentage = target > 0 ? Math.min((actual / target) * 100, 100) : 0;
  const overTarget = target > 0 && actual >= target;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-600">{label}</span>
        <span className="text-sm font-medium text-gray-800">
          {actual} / {target}{' '}
          <span
            className={`text-xs ${overTarget ? 'text-green-600' : 'text-gray-400'}`}
          >
            ({percentage.toFixed(0)}%)
          </span>
        </span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${overTarget ? 'bg-green-500' : color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
