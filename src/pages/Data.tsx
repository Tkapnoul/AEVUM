import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronRight, FlaskConical, Hourglass, Moon, Plus, Watch } from "lucide-react";
import { useFetch } from "../lib/useFetch";
import { useI18n } from "../lib/i18n";
import { fmtMetric } from "../lib/format";
import { post } from "../lib/api";
import type { Series } from "../lib/types";
import { Card, ErrorState, PageHeader, Segmented, SectionTitle, Spinner, Button, Field, cx } from "../components/ui";
import { TrendChart } from "../components/TrendChart";
import { isMetricType, type MetricType } from "../../shared/metrics";

const CHIPS: MetricType[] = [
  "steps", "resting_hr", "hrv", "sleep_minutes", "vo2max", "heart_rate", "spo2", "stress", "respiratory_rate",
  "active_calories", "exercise_minutes", "bp_systolic", "bp_diastolic", "blood_glucose", "weight", "body_fat", "pai",
];
const BAR_TYPES: MetricType[] = ["steps", "active_calories", "sleep_minutes", "pai", "distance", "exercise_minutes"];
const MANUAL: Partial<Record<MetricType, "weight" | "bp" | "blood_glucose" | "body_fat">> = {
  weight: "weight", body_fat: "body_fat", bp_systolic: "bp", bp_diastolic: "bp", blood_glucose: "blood_glucose",
};

export function DataPage({ member }: { member?: string }) {
  const params = useParams();
  const nav = useNavigate();
  const { t, fmtNum } = useI18n();
  const type: MetricType = params.metric && isMetricType(params.metric) ? params.metric : "steps";
  const [days, setDays] = useState(30);
  const q = member ? `&member=${member}` : "";
  const series = useFetch<Series>(`/metrics/series/${type}?days=${days}${q}`);
  const intraday = useFetch<{ samples: { ts: number; value: number }[] }>(type === "heart_rate" ? `/metrics/intraday/heart_rate?${q.slice(1)}` : null);
  const fmt = (v: number) => {
    const f = fmtMetric(type, v, fmtNum);
    return `${f.value}${f.unit ? ` ${f.unit}` : ""}`;
  };
  const values = series.data?.points.map((p) => p.value) ?? [];
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const base = member ? `/expert/clients/${member}/data` : "/data";

  return (
    <>
      {!member && <PageHeader title={t("data.title")} />}
      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {CHIPS.map((c) => (
          <button
            key={c}
            onClick={() => nav(`${base}/${c}`, { replace: true })}
            aria-pressed={c === type}
            className={cx(
              "h-9 shrink-0 rounded-full border px-4 text-sm transition",
              c === type ? "border-ink bg-ink text-bg" : "border-line bg-surface text-ink-2 hover:text-ink",
            )}
          >
            {t(`metric.${c}`)}
          </button>
        ))}
      </div>

      <Card className="mt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-ink-2">
              {t(`metric.${type}`)} · {t("data.avg")} {days} {t("common.days")}
            </p>
            <p className="mt-1 font-display text-4xl tabular">{avg != null ? fmt(avg) : "—"}</p>
          </div>
          <Segmented
            value={days}
            onChange={setDays}
            options={[
              { value: 7, label: "7" },
              { value: 30, label: "30" },
              { value: 90, label: "90" },
            ]}
          />
        </div>
        <div className="mt-4">
          {series.loading && !series.data ? (
            <Spinner />
          ) : series.error ? (
            <ErrorState onRetry={series.reload} />
          ) : values.length ? (
            <TrendChart points={series.data!.points} kind={BAR_TYPES.includes(type) ? "bar" : "area"} format={fmt} average={avg} />
          ) : (
            <p className="py-12 text-center text-sm text-ink-3">{t("common.noData")}</p>
          )}
        </div>
        {values.length > 1 && (
          <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center text-sm">
            <div>
              <dt className="text-ink-3">min</dt>
              <dd className="tabular">{fmt(Math.min(...values))}</dd>
            </div>
            <div>
              <dt className="text-ink-3">{t("data.avg")}</dt>
              <dd className="tabular">{fmt(avg!)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">max</dt>
              <dd className="tabular">{fmt(Math.max(...values))}</dd>
            </div>
          </dl>
        )}
      </Card>

      {type === "heart_rate" && intraday.data && intraday.data.samples.length > 0 && (
        <Card className="mt-3">
          <p className="mb-2 text-sm text-ink-2">{t("data.intraday")}</p>
          <IntradayChart samples={intraday.data.samples} fmt={fmt} />
        </Card>
      )}

      {MANUAL[type] && !member && <ManualEntry kind={MANUAL[type]!} onSaved={series.reload} />}

      <p className="mt-3 px-1 text-xs text-ink-3">{t("data.wellnessNote")}</p>

      {!member && (
        <>
          <SectionTitle>{t("nav.data")}</SectionTitle>
          <div className="space-y-3">
            <LinkCard to="/bioage" icon={<Hourglass className="size-5" aria-hidden />} title={t("bio.title")} />
            <LinkCard to="/data/sleep-detail" icon={<Moon className="size-5" aria-hidden />} title={t("data.sleep")} />
            <LinkCard to="/data/labs" icon={<FlaskConical className="size-5" aria-hidden />} title={t("data.labs")} />
            <LinkCard to="/devices" icon={<Watch className="size-5" aria-hidden />} title={t("data.devices")} />
          </div>
        </>
      )}
    </>
  );
}

function LinkCard({ to, icon, title }: { to: string; icon: React.ReactNode; title: string }) {
  return (
    <Link to={to}>
      <Card className="flex items-center gap-4 p-4">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-surface-2 text-gold">{icon}</span>
        <span className="flex-1 font-medium">{title}</span>
        <ChevronRight className="size-5 text-ink-3" aria-hidden />
      </Card>
    </Link>
  );
}

function IntradayChart({ samples, fmt }: { samples: { ts: number; value: number }[]; fmt: (v: number) => string }) {
  const { fmtDate } = useI18n();
  // Hourly averages keep the chart readable on a phone.
  const byHour = new Map<string, number[]>();
  for (const s of samples) {
    const h = fmtDate(s.ts, { hour: "2-digit" });
    byHour.set(h, [...(byHour.get(h) ?? []), s.value]);
  }
  const points = [...byHour.entries()].map(([h, vs]) => ({ date: h, value: vs.reduce((a, b) => a + b, 0) / vs.length }));
  return <TrendChartRaw points={points} fmt={fmt} />;
}

function TrendChartRaw({ points, fmt }: { points: { date: string; value: number }[]; fmt: (v: number) => string }) {
  const max = Math.max(...points.map((p) => p.value));
  const min = Math.min(...points.map((p) => p.value));
  return (
    <div className="flex h-32 items-end gap-[3px]" role="img" aria-label="hourly">
      {points.map((p) => (
        <div key={p.date} className="group relative flex-1" title={`${p.date}: ${fmt(p.value)}`}>
          <div className="rounded-t bg-coral/70" style={{ height: `${20 + ((p.value - min) / Math.max(1, max - min)) * 100}px` }} />
        </div>
      ))}
    </div>
  );
}

function ManualEntry({ kind, onSaved }: { kind: "weight" | "bp" | "blood_glucose" | "body_fat"; onSaved: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const label = kind === "bp" ? t("data.bp") : kind === "weight" ? `${t("metric.weight")} (kg)` : kind === "body_fat" ? `${t("metric.body_fat")} (%)` : `${t("metric.blood_glucose")} (mg/dL)`;
  if (!open)
    return (
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> {t("data.addEntry")}: {kind === "bp" ? t("data.bp") : t(`metric.${kind}`)}
      </Button>
    );
  return (
    <Card className="mt-3">
      <form
        className="flex items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            if (kind === "bp") {
              await post("/metrics/manual", { type: "bp_systolic", value: Number(a) });
              await post("/metrics/manual", { type: "bp_diastolic", value: Number(b) });
            } else await post("/metrics/manual", { type: kind, value: Number(a.replace(",", ".")) });
          } finally {
            setBusy(false);
          }
          setOpen(false);
          setA("");
          setB("");
          onSaved();
        }}
      >
        <div className="flex-1">
          <Field label={kind === "bp" ? t("data.systolic") : label} type="number" step="0.1" inputMode="decimal" required value={a} onChange={(e) => setA(e.target.value)} />
        </div>
        {kind === "bp" && (
          <div className="flex-1">
            <Field label={t("data.diastolic")} type="number" inputMode="numeric" required value={b} onChange={(e) => setB(e.target.value)} />
          </div>
        )}
        <Button type="submit" loading={busy}>
          {t("common.save")}
        </Button>
      </form>
    </Card>
  );
}
