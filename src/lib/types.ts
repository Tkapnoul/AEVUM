import type { DailyPoint, MetricType, ScoreBreakdown, Role } from "../../shared/metrics";

export interface Summary {
  latest: Partial<Record<MetricType, { ts: number; value: number; isToday: boolean } | null>>;
  sleep: SleepSession | null;
  score: ScoreBreakdown;
  device: { kind: string; last_sync_at: number | null } | null;
}

export interface SleepSession {
  date: string;
  start_ts: number | null;
  end_ts: number | null;
  total_min: number;
  deep_min: number | null;
  light_min: number | null;
  rem_min: number | null;
  awake_min: number | null;
  score: number | null;
  source: string;
}

export interface Series {
  type: MetricType;
  days: number;
  points: DailyPoint[];
}

export interface Expert {
  id: string;
  name: string;
  role: Role;
  title: string;
  bio: string;
  languages: string[];
  session_minutes: number;
  accepting: number;
  on_team?: number;
}

export interface Booking {
  id: string;
  member_id: string;
  expert_id: string;
  starts_at: number;
  ends_at: number;
  status: "booked" | "cancelled" | "completed";
  topic: string;
  room_url: string;
  member_name: string;
  expert_name: string;
  expert_role: Role;
  expert_title: string | null;
}

export interface BookingDetail extends Booking {
  notes: { id: string; content: string; visible_to_member: number; created_at: number; author_name: string }[];
}

export interface Lab {
  id: string;
  marker: string;
  value: number;
  unit: string;
  ref_low: number | null;
  ref_high: number | null;
  taken_at: number;
  note: string;
  entered_by_name: string | null;
}

export interface Device {
  id: string;
  kind: string;
  name: string;
  created_at: number;
  last_sync_at: number | null;
}

export interface Message {
  id: string;
  sender_id: string;
  body: string;
  created_at: number;
  read_at: number | null;
}

export interface Thread {
  other_id: string;
  other_name: string;
  other_role: Role;
  last_at: number;
  last_body: string;
  unread: number;
}

export interface AppConfig {
  publicUrl: string;
  aiEnabled: boolean;
  clinicTimeZone: string;
  devices: { kind: string; name: string }[];
}
