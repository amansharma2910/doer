export type User = {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
  day_start_time: string;
  day_duration_minutes: number;
  capacity_ratio: number;
};

export type LogicalDay = {
  id: string;
  anchor_date: string;
  start_at: string;
  end_at: string;
  timezone: string;
  duration_minutes: number;
  capacity_base_minutes: number | null;
  busy_minutes_subtracted: number | null;
  threshold_minutes: number | null;
  committed_minutes: number;
  calendar_state: string;
  is_indeterminate: boolean;
  indeterminate_reason: string | null;
  is_at_risk: boolean;
  closed_at: string | null;
  verdict: string | null;
};

export type PreferenceBlock = {
  id: string;
  kind: string;
  start_offset_minutes: number;
  end_offset_minutes: number;
  is_focus: boolean;
};
