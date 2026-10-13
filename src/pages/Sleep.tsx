import { useFetch } from "../lib/useFetch";
import { useI18n } from "../lib/i18n";
import { fmtDuration } from "../lib/format";
import type { SleepSession } from "../lib/types";
import { Card, ErrorState, PageHeader, SectionTitle, Spinner } from "../components/ui";

const STAGES = [
  { key: "deep_min", label: "data.stages.deep", color: "var(--sky)" },
  { key: "rem_min", label: "data.stages.rem", color: "var(--gold)" },
  { key: "light_min", label: "data.stages.light", color: "var(--sage)" },
  { key: "awake_min", label: "data.stages.awake", color: "var(--coral)" },
] as const;

export function SleepPage({ member }: { member?: string }) {
  const { t, fmtDate } = useI18n();
  const res = useFetch<{ sessions: SleepSession[] }>(`/metrics/sleep?days=14${member ? `&member=${member}` : ""}`);
  if (res.loading && !res.data) return <Spinner />;
  if (res.error) return <ErrorState onRetry={res.reload} />;
  const sessions = res.data?.sessions ?? [];
  const last = sessions.at(-1);
  const maxTotal = Math.max(1, ...sessions.map((s) => s.total_min + (s.awake_min ?? 0)));

  return (
    <>
      {!member && <PageHeader title={t("data.sleep")} back="/data" />}
      {!last ? (
        <Card className="text-center text-sm text-ink-3">{t("common.noData")}</Card>
      ) : (
        <>
          <Card>
            <p className="text-sm text-ink-2">
              {t("data.lastNight")} · {fmtDate(`${last.date}T12:00:00Z`, { weekday: "long", day: "numeric", month: "short" })}
            </p>
            <div className="mt-1 flex items-baseline gap-3">
              <p className="font-display text-4xl tabular">{fmtDuration(last.total_min)}</p>
              {last.score != null && <p className="text-sm text-ink-2">{t("metric.sleep_score")} <span className="text-ink tabular">{last.score}</span></p>}
            </div>
            {last.start_ts && last.end_ts && (
              <p className="mt-1 text-sm text-ink-3 tabular">
                {fmtDate(last.start_ts, { hour: "2-digit", minute: "2-digit" })} → {fmtDate(last.end_ts, { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
            <StageBar s={last} />
            <ul className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
              {STAGES.map((st) =>
                last[st.key] != null ? (
                  <li key={st.key} className="flex items-center gap-2">
                    <span className="size-2.5 rounded-full" style={{ background: st.color }} aria-hidden />
                    <span className="text-ink-2">{t(st.label)}</span>
                    <span className="ml-auto pr-4 tabular">{fmtDuration(last[st.key] as number)}</span>
                  </li>
                ) : null,
              )}
            </ul>
          </Card>

          <SectionTitle>14 {t("common.days")}</SectionTitle>
          <Card>
            <ul className="space-y-2.5">
              {sessions
                .slice()
                .reverse()
                .map((s) => (
                  <li key={s.date} className="flex items-center gap-3 text-sm">
                    <span className="w-14 shrink-0 text-ink-3">{fmtDate(`${s.date}T12:00:00Z`, { weekday: "short", day: "numeric" })}</span>
                    <div className="flex-1" style={{ maxWidth: `${((s.total_min + (s.awake_min ?? 0)) / maxTotal) * 100}%` }}>
                      <StageBar s={s} thin />
                    </div>
                    <span className="w-16 shrink-0 text-right tabular">{fmtDuration(s.total_min)}</span>
                  </li>
                ))}
            </ul>
          </Card>
        </>
      )}
      <p className="mt-3 px-1 text-xs text-ink-3">{t("data.wellnessNote")}</p>
    </>
  );
}

function StageBar({ s, thin }: { s: SleepSession; thin?: boolean }) {
  const parts = STAGES.map((st) => ({ ...st, v: (s[st.key] as number | null) ?? 0 }));
  const known = parts.reduce((a, p) => a + p.v, 0);
  if (!known) return <div className={`${thin ? "h-2" : "mt-4 h-3"} rounded-full bg-gold/60`} />;
  return (
    <div className={`${thin ? "h-2" : "mt-4 h-3"} flex overflow-hidden rounded-full`}>
      {parts.map((p) => (p.v ? <div key={p.key} style={{ width: `${(p.v / known) * 100}%`, background: p.color }} /> : null))}
    </div>
  );
}
