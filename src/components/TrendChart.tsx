import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import type { DailyPoint } from "../../shared/metrics";
import { useI18n } from "../lib/i18n";

interface Props {
  points: DailyPoint[];
  kind?: "area" | "bar";
  format: (v: number) => string;
  average?: number | null;
  height?: number;
}

export function TrendChart({ points, kind = "area", format, average, height = 200 }: Props) {
  const { fmtDate } = useI18n();
  const data = points.map((p) => ({ ...p, label: fmtDate(`${p.date}T12:00:00Z`, { day: "numeric", month: "short" }) }));
  const common = {
    data,
    margin: { top: 8, right: 4, left: 4, bottom: 0 },
  };
  // Bars start at zero; lines get headroom so day-to-day noise isn't drawn as a cliff.
  const domain: [number | string | ((v: number) => number), number | string | ((v: number) => number)] =
    kind === "bar" ? [0, "auto"] : [(min: number) => Math.floor(min * 0.85), (max: number) => Math.ceil(max * 1.08)];
  const axis = (
    <>
      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--ink-3)", fontSize: 11 }} minTickGap={24} />
      <YAxis hide domain={domain} />
      <Tooltip
        cursor={{ fill: "var(--surface-2)", stroke: "var(--line)" }}
        contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, fontSize: 13, color: "var(--ink)" }}
        labelStyle={{ color: "var(--ink-3)" }}
        formatter={(v) => [format(Number(v)), ""]}
        separator=""
      />
      {average != null && <ReferenceLine y={average} stroke="var(--ink-3)" strokeDasharray="3 4" />}
    </>
  );
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart {...common}>
            {axis}
            <Bar dataKey="value" fill="var(--gold)" radius={[6, 6, 2, 2]} maxBarSize={18} animationDuration={400} />
          </BarChart>
        ) : (
          <AreaChart {...common}>
            <defs>
              <linearGradient id="aevumFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--gold)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--gold)" stopOpacity={0} />
              </linearGradient>
            </defs>
            {axis}
            <Area type="monotone" dataKey="value" stroke="var(--gold)" strokeWidth={2} fill="url(#aevumFill)" dot={false} activeDot={{ r: 4 }} animationDuration={400} />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
