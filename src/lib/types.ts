export interface Profile {
  id: string;
  name: string;
  role: 'manager' | 'caller';
  created_at: string;
}

export type LeadStatus = 'new' | 'calling' | 'contacted' | 'appointment' | 'excluded' | 'dnc';

export interface Lead {
  id: string;
  company_name: string;
  phone: string;
  contact_name: string;
  homepage: string;
  next_activity_date: string | null;
  status: LeadStatus;
  memo: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  profiles?: Profile;
}

export type CallResult = 'no_answer' | 'reception' | 'connected' | 'appointment' | 'rejected' | 'invalid';

export interface CallLog {
  id: string;
  lead_id: string;
  caller_id: string;
  called_at: string;
  result: CallResult;
  memo: string;
  created_at: string;
  // Joined fields
  profiles?: Profile;
  leads?: Lead;
}

export type PeriodType = 'daily' | 'weekly' | 'monthly';

export interface Target {
  id: string;
  user_id: string;
  period_type: PeriodType;
  period_start: string;
  target_calls: number;
  target_connects: number;
  target_appointments: number;
  created_at: string;
  updated_at: string;
  // Joined fields
  profiles?: Profile;
}

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: '新規',
  calling: '架電中',
  contacted: '接触済',
  appointment: 'アポ獲得',
  excluded: '対象外',
  dnc: '架電禁止',
};

export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  calling: 'bg-amber-100 text-amber-800',
  contacted: 'bg-purple-100 text-purple-800',
  appointment: 'bg-green-100 text-green-800',
  excluded: 'bg-gray-100 text-gray-800',
  dnc: 'bg-red-100 text-red-800',
};

export const CALL_RESULT_LABELS: Record<CallResult, string> = {
  no_answer: '不在',
  reception: '受付',
  connected: '担当接続',
  appointment: 'アポ獲得',
  rejected: '断り',
  invalid: '番号無効',
};

export const CALL_RESULT_COLORS: Record<CallResult, string> = {
  no_answer: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
  reception: 'bg-amber-100 text-amber-700 hover:bg-amber-200',
  connected: 'bg-blue-100 text-blue-700 hover:bg-blue-200',
  appointment: 'bg-green-100 text-green-700 hover:bg-green-200',
  rejected: 'bg-red-100 text-red-700 hover:bg-red-200',
  invalid: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
};
