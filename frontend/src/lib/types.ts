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
  calendar_state: "connected" | "revoked" | "stale" | "absent";
  is_indeterminate: boolean;
  indeterminate_reason: string | null;
  is_at_risk: boolean;
  closed_at: string | null;
  verdict: Verdict | null;
  calendar_synced_at: string | null;
  calendar_is_stale: boolean;
};

export type Verdict = "success" | "failure" | "neutral" | "unscheduled";

export type PreferenceKind =
  | "deep_work"
  | "personal_project"
  | "personal"
  | "social"
  | "other";

export const PREFERENCE_LABELS: Record<PreferenceKind, string> = {
  deep_work: "Deep work",
  personal_project: "Personal project",
  personal: "Personal",
  social: "Social",
  other: "Other",
};

/** Only these two count toward capacity. The rest are time, not headroom. */
export const FOCUS_KINDS: PreferenceKind[] = ["deep_work", "personal_project"];

export type Task = {
  id: string;
  logical_day_id: string;
  anchor_date: string;
  title: string;
  notes: string | null;
  is_primary: boolean;
  preference_kind: PreferenceKind;
  sort_index: number;
  estimate_minutes: number | null;
  estimate_source: "model" | "user" | null;
  estimation_status: "pending" | "estimated" | "failed";
  started_at: string | null;
  completed_at: string | null;
  actual_minutes: number | null;
  carry_forward_count: number;
  carry_forward_demoted: boolean;
  is_complete: boolean;
};

export type PreferenceBlock = {
  id: string;
  kind: PreferenceKind;
  start_offset_minutes: number;
  end_offset_minutes: number;
  is_focus: boolean;
};

export type HeatmapCell = {
  anchor_date: string;
  completed_total: number;
  completed_primary: number;
  scheduled_primary: number;
  verdict: Verdict | null;
  is_at_risk: boolean;
};

export type ProposedTask = {
  title: string;
  preference_kind: PreferenceKind;
  estimate_minutes: number;
};

export type RuleError = {
  message: string;
  code: string;
  remedy: string | null;
};

/** The daily commitment cap. Mirrors MAX_PRIMARIES on the server. */
export const MAX_PRIMARIES = 4;

/** The only durations an estimate may hold. The API snaps to these regardless. */
export const ESTIMATE_BUCKETS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480];
