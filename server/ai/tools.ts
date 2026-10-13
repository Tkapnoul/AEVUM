import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { all } from "../db.js";
import { dailySeries } from "../lib/metrics-store.js";
import { openSlots } from "../lib/slots.js";
import { METRIC_TYPES, type MetricType } from "../../shared/metrics.js";

type Tool = Anthropic.Beta.BetaTool;

const MetricHistory = z.object({ metric: z.enum(METRIC_TYPES as [MetricType, ...MetricType[]]), days: z.number().int().min(1).max(90) });
const SleepHistory = z.object({ days: z.number().int().min(1).max(30) });
const Empty = z.object({});
const Availability = z.object({ role: z.enum(["coach", "doctor", "nutritionist", "physio"]), days: z.number().int().min(1).max(21) });
const Sessions = z.object({ scope: z.enum(["upcoming", "past"]) });

export const TOOLS: Tool[] = [
  {
    name: "get_metric_history",
    description:
      "Daily values for one metric of the member over the last N days. Sample metrics (heart_rate, spo2, stress) return the daily average with min/max. Use before making any claim about a trend.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: METRIC_TYPES },
        days: { type: "integer", minimum: 1, maximum: 90 },
      },
      required: ["metric", "days"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "get_sleep_history",
    description: "Nightly sleep sessions for the last N nights: total, deep, light, REM and awake minutes, sleep score, bed and wake times (UTC).",
    input_schema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 30 } },
      required: ["days"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "get_lab_results",
    description: "All lab results / biomarkers on file for the member, with units, reference ranges, date and who entered them.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "find_session_slots",
    description:
      "Next open 1-1 session slots with the member's care-team experts of a given role. Times are ISO UTC; the app shows them in local time. The member books from the Care tab.",
    input_schema: {
      type: "object",
      properties: {
        role: { type: "string", enum: ["coach", "doctor", "nutritionist", "physio"] },
        days: { type: "integer", minimum: 1, maximum: 21 },
      },
      required: ["role", "days"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
  {
    name: "list_sessions",
    description: "The member's upcoming or past 1-1 sessions, with the notes their experts shared with them.",
    input_schema: {
      type: "object",
      properties: { scope: { type: "string", enum: ["upcoming", "past"] } },
      required: ["scope"],
      additionalProperties: false,
    },
    strict: true,
    eager_input_streaming: true,
  },
];

const iso = (ts: number | null) => (ts == null ? null : new Date(ts).toISOString());

/** Runs a tool for `userId`. Throws on invalid input; the caller turns that into an is_error result. */
export function runTool(userId: string, name: string, input: unknown): unknown {
  switch (name) {
    case "get_metric_history": {
      const { metric, days } = MetricHistory.parse(input);
      return { metric, points: dailySeries(userId, metric, days).map((p) => ({ ...p, value: Math.round(p.value * 10) / 10 })) };
    }
    case "get_sleep_history": {
      const { days } = SleepHistory.parse(input);
      const rows = all<Record<string, number | string | null>>(
        "SELECT date, start_ts, end_ts, total_min, deep_min, light_min, rem_min, awake_min, score FROM sleep_sessions WHERE user_id = ? ORDER BY date DESC LIMIT ?",
        userId, days,
      );
      return rows.reverse().map((r) => ({ ...r, start_ts: iso(r.start_ts as number | null), end_ts: iso(r.end_ts as number | null) }));
    }
    case "get_lab_results": {
      Empty.parse(input);
      return all<Record<string, unknown>>(
        `SELECT l.marker, l.value, l.unit, l.ref_low, l.ref_high, l.taken_at, l.note, u.name AS entered_by
         FROM labs l LEFT JOIN users u ON u.id = l.entered_by WHERE l.user_id = ? ORDER BY l.marker, l.taken_at`,
        userId,
      ).map((r) => ({ ...r, taken_at: iso(r.taken_at as number) }));
    }
    case "find_session_slots": {
      const { role, days } = Availability.parse(input);
      const experts = all<{ id: string; name: string }>(
        "SELECT u.id, u.name FROM care_team ct JOIN users u ON u.id = ct.expert_id WHERE ct.member_id = ? AND u.role = ?",
        userId, role,
      );
      if (!experts.length) return { note: `No ${role} on the member's care team yet. They can browse all experts in the Care tab.` };
      return experts.map((e) => ({ expert: e.name, slots: openSlots(e.id, days).slice(0, 8).map((s) => iso(s.startsAt)) }));
    }
    case "list_sessions": {
      const { scope } = Sessions.parse(input);
      const now = Date.now();
      const rows = all<{ id: string; starts_at: number; status: string; topic: string; name: string; role: string }>(
        `SELECT b.id, b.starts_at, b.status, b.topic, u.name, u.role FROM bookings b JOIN users u ON u.id = b.expert_id
         WHERE b.member_id = ? AND ${scope === "past" ? "b.ends_at < ?" : "b.ends_at >= ? AND b.status = 'booked'"}
         ORDER BY b.starts_at ${scope === "past" ? "DESC" : "ASC"} LIMIT 10`,
        userId, now,
      );
      return rows.map((b) => ({
        when: iso(b.starts_at),
        with: `${b.name} (${b.role})`,
        status: b.status,
        topic: b.topic,
        notes: all<{ content: string }>("SELECT content FROM session_notes WHERE booking_id = ? AND visible_to_member = 1", b.id).map((n) => n.content),
      }));
    }
    default:
      throw new Error(`unknown tool ${name}`);
  }
}
