import { Link } from "react-router-dom";
import { Watch, Sparkles, ChevronRight, RefreshCw, Hourglass } from "lucide-react";
import { useFetch } from "../lib/useFetch";
import { useI18n, type MessageKey } from "../lib/i18n";
import { useSession } from "../lib/session";
import type { Booking, Summary } from "../lib/types";
import { fmtMetric, timeAgo } from "../lib/format";
import { Card, ErrorState, SectionTitle, Spinner, Button } from "../components/ui";
import { ScoreRing, PillarBar } from "../components/ScoreRing";
import { SessionCard } from "../components/SessionCard";
import type { MetricType } from "../../shared/metrics";
import { isLocal } from "../lib/native";

const BASE_TILES: MetricType[] = ["steps", "resting_hr", "hrv", "vo2max", "spo2", "stress", "active_calories", "pai"];
const STALE_MS = 24 * 3600_000;

function greeting(): MessageKey {
  const h = new Date().getHours();
  return h < 12 ? "today.greeting.morning" : h < 18 ? "today.greeting.afternoon" : "today.greeting.evening";
}

export function Today() {
  const { t, fmtDate, fmtNum, locale } = useI18n();
  const { me } = useSession();
  const summary = useFetch<Summary>("/metrics/summary", { pollMs: 60_000 });
  const bookings = useFetch<{ bookings: Booking[] }>("/care/bookings?scope=upcoming");
  const insight = useFetch<{ text: string | null; reason?: string }>("/ai/insight");
  const bio = useFetch<BioSummary>("/bioage");

  const s = summary.data;
  // Show the metrics this member's device actually provides (steps and resting HR always, as the basics).
  const tiles = BASE_TILES.filter((type) => type === "steps" || type === "resting_hr" || s?.latest[type]);
  const next = bookings.data?.bookings.find((b) => b.status === "booked");
  const firstName = me?.name.split(" ")[0] ?? "";

  return (
    <>
      <header className="mb-6 pt-2">
        <p className="text-sm text-ink-3 capitalize">{fmtDate(Date.now(), { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="mt-1 font-display text-[32px] leading-tight font-medium">
          {t(greeting())}, {firstName}
        </h1>
      </header>

      {summary.loading && !s ? (
        <Spinner />
      ) : summary.error && !s ? (
        <ErrorState onRetry={summary.reload} />
      ) : s ? (
        <>
          <Card className="flex items-center gap-5">
            <ScoreRing score={s.score.score} />
            <div className="min-w-0 flex-1 space-y-2.5">
              <div>
                <p className="font-medium">{t("today.score")}</p>
                <p className="text-xs text-ink-3">{s.score.score == null ? t("today.scoreNotEnough") : t("today.scoreHint")}</p>
              </div>
              {s.score.components.map((c) => (
                <PillarBar key={c.key} label={t(`pillar.${c.key}`)} score={c.score} />
              ))}
            </div>
          </Card>

          <Card className="mt-3 border-gold/30 bg-gold-soft/40">
            <div className="flex items-center gap-2 text-sm font-medium text-gold">
              <Sparkles className="size-4" aria-hidden /> {t("today.insight")}
            </div>
            <p className="mt-2 text-[15px] leading-relaxed">
              {insight.loading ? <span className="text-ink-3">{t("common.loading")}</span> : insight.data?.text ?? <span className="text-ink-3">{insight.data?.reason === "ai_not_configured" ? t("today.insightOff") : "—"}</span>}
            </p>
            <Link to="/ai" className="mt-3 inline-flex items-center text-sm text-ink-2 hover:text-ink">
              {t("ai.title")} <ChevronRight className="size-4" aria-hidden />
            </Link>
          </Card>

          {!s.device ? (
            <Link to="/devices" className="mt-3 block">
              <Card className="flex items-center gap-4">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-surface-2 text-gold">
                  <Watch className="size-5" aria-hidden />
                </span>
                <div className="flex-1">
                  <p className="font-medium">{t("today.connectWatch")}</p>
                  <p className="text-sm text-ink-2">{t("today.connectWatchHint")}</p>
                </div>
                <ChevronRight className="size-5 text-ink-3" aria-hidden />
              </Card>
            </Link>
          ) : (
            <p className="mt-3 flex items-center gap-1.5 px-1 text-xs text-ink-3">
              <RefreshCw className="size-3" aria-hidden />
              {t("today.lastSync")}: {s.device.last_sync_at ? timeAgo(s.device.last_sync_at, locale) : t("device.never")}
              {(!s.device.last_sync_at || Date.now() - s.device.last_sync_at > STALE_MS) && <span className="text-gold"> · {t("today.stale")}</span>}
            </p>
          )}

          <BioCard data={bio.data} />

          {!isLocal() && (
            <>
              <SectionTitle>{t("today.nextSession")}</SectionTitle>
              {next ? (
                <SessionCard booking={next} />
              ) : (
                <Card className="flex items-center justify-between">
                  <p className="text-sm text-ink-2">{t("today.noSession")}</p>
                  <Link to="/care">
                    <Button size="sm" variant="secondary">
                      {t("today.bookOne")}
                    </Button>
                  </Link>
                </Card>
              )}
            </>
          )}

          <SectionTitle>{t("today.metrics")}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            {s.sleep && (
              <Link to="/data/sleep" className="col-span-2">
                <Card className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-ink-2">{t("data.lastNight")}</p>
                    <p className="mt-1 font-display text-3xl tabular">{fmtMetric("sleep_minutes", s.sleep.total_min, fmtNum).value}</p>
                  </div>
                  <div className="text-right text-sm text-ink-2">
                    {s.sleep.deep_min != null && (
                      <p>
                        {t("data.stages.deep")} <span className="text-ink tabular">{fmtMetric("deep_sleep_minutes", s.sleep.deep_min, fmtNum).value}</span>
                      </p>
                    )}
                    {s.sleep.score != null && (
                      <p>
                        {t("metric.sleep_score")} <span className="text-ink tabular">{s.sleep.score}</span>
                      </p>
                    )}
                  </div>
                </Card>
              </Link>
            )}
            {tiles.map((type) => {
              const v = s.latest[type];
              const f = v ? fmtMetric(type, v.value, fmtNum) : null;
              return (
                <Link key={type} to={`/data/${type}`}>
                  <Card className="h-full p-4">
                    <p className="text-sm text-ink-2">{t(`metric.${type}`)}</p>
                    <p className="mt-2 font-display text-[26px] leading-none tabular">
                      {f ? f.value : "—"}
                      {f?.unit && <span className="ml-1 font-sans text-xs text-ink-3">{f.unit}</span>}
                    </p>
                    {v && !v.isToday && <p className="mt-1 text-[11px] text-ink-3">{fmtDate(v.ts)}</p>}
                  </Card>
                </Link>
              );
            })}
          </div>
        </>
      ) : null}
    </>
  );
}

interface BioSummary {
  chronoAge: number | null;
  latestDone: { report: { overall_bio_age: number } | null } | null;
  phenoAge: { value: number | null };
}

function BioCard({ data }: { data: BioSummary | null }) {
  const { t, fmtNum } = useI18n();
  // The AI report is the headline number; until there is one, PhenoAge from blood tests stands in.
  const ai = data?.latestDone?.report?.overall_bio_age ?? null;
  const bio = ai ?? data?.phenoAge.value ?? null;
  const delta = bio != null && data?.chronoAge != null ? bio - data.chronoAge : null;
  return (
    <Link to="/bioage" className="mt-3 block">
      <Card className="flex items-center gap-4">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-gold-soft text-gold">
          <Hourglass className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{ai == null && bio != null ? "PhenoAge" : t("bio.title")}</p>
          <p className="truncate text-sm text-ink-2">
            {delta == null ? t("bio.notYet") : delta < -0.4 ? t("bio.younger", { n: fmtNum(-delta, 1) }) : delta > 0.4 ? t("bio.older", { n: fmtNum(delta, 1) }) : t("bio.same")}
          </p>
        </div>
        <span className="font-display text-3xl tabular">{bio != null ? fmtNum(bio, 1) : "—"}</span>
        <ChevronRight className="size-5 text-ink-3" aria-hidden />
      </Card>
    </Link>
  );
}
