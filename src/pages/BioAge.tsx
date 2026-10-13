import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, FlaskConical, Info, RefreshCw, Sparkles } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFetch } from "../lib/useFetch";
import { useI18n, type MessageKey } from "../lib/i18n";
import { api, post, ApiError } from "../lib/api";
import { Button, Card, Empty, ErrorState, PageHeader, SectionTitle, Spinner, cx } from "../components/ui";
import { labDef } from "../../shared/labs";

interface Report {
  overall_bio_age: number;
  confidence: "low" | "medium" | "high";
  headline: string;
  summary: string;
  systems: {
    key: string;
    bio_age: number | null;
    confidence: "low" | "medium" | "high";
    status: "younger" | "on_track" | "older" | "unknown";
    evidence: string;
    key_metrics: { label: string; value: string }[];
  }[];
  drivers_younger: string[];
  drivers_older: string[];
  recommendations: { title: string; detail: string; expected_effect: string; priority: "high" | "medium" | "low" }[];
  data_gaps: { what: string; why: string }[];
}

interface ReportView {
  id: string;
  status: "pending" | "done" | "error";
  chronoAge: number;
  phenoAge: number | null;
  report: Report | null;
  error: string | null;
  createdAt: number;
}

interface Overview {
  aiEnabled: boolean;
  method: "ai" | "rules";
  birthDateMissing: boolean;
  chronoAge: number | null;
  phenoAge: { value: number | null; missing: string[]; spanDays: number | null; takenAt: number | null; required: string[] };
  latest: ReportView | null;
  latestDone: ReportView | null;
  history: { createdAt: number; bioAge: number; chronoAge: number; phenoAge: number | null }[];
  pace: number | null;
}

export function BioAgePage({ member }: { member?: string }) {
  const { t, fmtNum } = useI18n();
  const q = member ? `?member=${member}` : "";
  const res = useFetch<Overview>(`/bioage${q}`);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = res.reload;
  // Poll a running report until it finishes.
  useEffect(() => {
    const id = pending ?? (res.data?.latest?.status === "pending" ? res.data.latest.id : null);
    if (!id) return;
    const timer = setInterval(async () => {
      const r = await api<ReportView>(`/bioage/${id}${q}`).catch(() => null);
      if (r && r.status !== "pending") {
        clearInterval(timer);
        setPending(null);
        if (r.status === "error") setError(t("bio.failed"));
        void reload();
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [pending, res.data?.latest?.status, res.data?.latest?.id, q, reload, t]);

  if (res.loading && !res.data) return <Spinner />;
  if (res.error || !res.data) return <ErrorState onRetry={res.reload} />;
  const d = res.data;
  const running = pending != null || d.latest?.status === "pending";
  const lastDone = d.latestDone;

  async function start() {
    setError(null);
    try {
      const { id } = await post<{ id: string }>("/bioage");
      // The rule-based engine finishes inside the request; only AI reports run in the background.
      if (d.method === "rules") void reload();
      else setPending(id);
    } catch (e) {
      setError(e instanceof ApiError && e.code === "already_running" ? t("bio.running") : t("bio.failed"));
    }
  }

  return (
    <>
      {!member && <PageHeader title={t("bio.title")} subtitle={t("bio.subtitle")} back="/" />}

      {d.birthDateMissing ? (
        <Card className="text-sm">
          <p className="text-ink-2">{t("bio.needBirth")}</p>
          {!member && (
            <Link to="/profile">
              <Button size="sm" className="mt-3">
                {t("bio.addBirth")}
              </Button>
            </Link>
          )}
        </Card>
      ) : (
        <>
          <Hero view={lastDone} chrono={d.chronoAge!} running={running} />
          {!member && (
            <div className="mt-3">
              <Button className="w-full" onClick={start} loading={running} disabled={running}>
                {running ? t("bio.running") : lastDone ? (
                  <>
                    <RefreshCw className="size-4" aria-hidden /> {t("bio.rerun")}
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" aria-hidden /> {t("bio.run")}
                  </>
                )}
              </Button>
              {error && <p className="mt-2 text-sm text-coral">{error}</p>}
            </div>
          )}
        </>
      )}

      <PhenoCard pheno={d.phenoAge} chrono={d.chronoAge} member={member} />

      {lastDone?.report && <ReportDetail r={lastDone.report} />}

      {d.history.length > 1 && (
        <>
          <SectionTitle>{t("bio.history")}</SectionTitle>
          <Card>
            <History points={d.history} />
            {d.pace != null && (
              <p className="mt-3 text-sm text-ink-2">
                {t("bio.pace")}: <span className="text-ink tabular">{t("bio.paceValue", { n: fmtNum(d.pace, 2) })}</span>
              </p>
            )}
          </Card>
        </>
      )}

      <details className="mt-6 rounded-3xl border border-line bg-surface p-5 text-sm text-ink-2">
        <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink">
          <Info className="size-4" aria-hidden /> {t("bio.method")}
        </summary>
        <p className="mt-3 leading-relaxed">{t(d.method === "rules" ? "bio.methodTextRules" : "bio.methodText")}</p>
      </details>
    </>
  );
}

function Hero({ view, chrono, running }: { view: ReportView | null; chrono: number; running: boolean }) {
  const { t, fmtNum, fmtDate } = useI18n();
  const bio = view?.report?.overall_bio_age ?? null;
  const delta = bio != null ? Math.round((bio - chrono) * 10) / 10 : null;
  return (
    <Card className="text-center">
      <p className="text-sm text-ink-2">{t("bio.title")}</p>
      <p className={cx("mt-1 font-display text-7xl leading-none font-medium tabular", running && "animate-pulse")}>{bio != null ? fmtNum(bio, 1) : "—"}</p>
      <p className="mt-2 text-sm text-ink-3">
        {t("bio.chrono")}: <span className="tabular text-ink-2">{fmtNum(chrono, 1)}</span>
      </p>
      {delta != null && (
        <p
          className={cx(
            "mt-3 inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm",
            delta < -0.4 ? "bg-sage-soft text-sage" : delta > 0.4 ? "bg-coral-soft text-coral" : "bg-surface-2 text-ink-2",
          )}
        >
          {delta < -0.4 ? <ArrowDown className="size-4" aria-hidden /> : delta > 0.4 ? <ArrowUp className="size-4" aria-hidden /> : null}
          {delta < -0.4 ? t("bio.younger", { n: fmtNum(-delta, 1) }) : delta > 0.4 ? t("bio.older", { n: fmtNum(delta, 1) }) : t("bio.same")}
        </p>
      )}
      {view?.report && (
        <>
          <p className="mx-auto mt-4 max-w-sm font-display text-lg leading-snug">{view.report.headline}</p>
          <p className="mt-2 text-xs text-ink-3">
            {t("bio.confidence")}: {t(`bio.conf.${view.report.confidence}`)} · {fmtDate(view.createdAt, { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </>
      )}
      {!view && !running && <p className="mt-3 text-sm text-ink-3">{t("bio.notYet")}</p>}
    </Card>
  );
}

function PhenoCard({ pheno, chrono, member }: { pheno: Overview["phenoAge"]; chrono: number | null; member?: string }) {
  const { t, fmtNum, locale } = useI18n();
  return (
    <Card className="mt-3">
      <div className="flex items-start gap-3">
        <FlaskConical className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden />
        <div className="flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-medium">{t("bio.phenoage")}</p>
            <p className="font-display text-2xl tabular">{pheno.value != null ? fmtNum(pheno.value, 1) : "—"}</p>
          </div>
          <p className="mt-1 text-xs text-ink-3">{t("bio.phenoHint")}</p>
          {pheno.value != null && chrono != null && (
            <p className={cx("mt-2 text-sm", pheno.value < chrono ? "text-sage" : "text-coral")}>
              {pheno.value < chrono ? t("bio.younger", { n: fmtNum(chrono - pheno.value, 1) }) : t("bio.older", { n: fmtNum(pheno.value - chrono, 1) })}
            </p>
          )}
          {pheno.value == null && pheno.missing.length > 0 && (
            <p className="mt-2 text-sm text-ink-2">
              {t("bio.phenoMissing")}: {pheno.missing.map((k) => labDef(k)?.name[locale] ?? k).join(", ")}
            </p>
          )}
          {pheno.value == null && !pheno.missing.length && pheno.spanDays != null && <p className="mt-2 text-sm text-ink-2">{t("bio.phenoSpan")}</p>}
          {!member && pheno.value == null && (
            <Link to="/data/labs">
              <Button size="sm" variant="secondary" className="mt-3">
                {t("bio.addLabs")}
              </Button>
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}

const STATUS_STYLE = {
  younger: "bg-sage-soft text-sage",
  on_track: "bg-surface-2 text-ink-2",
  older: "bg-coral-soft text-coral",
  unknown: "bg-surface-2 text-ink-3",
};

function ReportDetail({ r }: { r: Report }) {
  const { t, fmtNum } = useI18n();
  return (
    <>
      <p className="mt-5 px-1 text-[15px] leading-relaxed text-ink-2">{r.summary}</p>

      <SectionTitle>{t("bio.systems")}</SectionTitle>
      <div className="space-y-3">
        {r.systems.map((s) => (
          <Card key={s.key} className="p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{t(`bio.sys.${s.key}` as MessageKey)}</p>
              <div className="flex items-center gap-2">
                <span className={cx("rounded-full px-2.5 py-0.5 text-xs", STATUS_STYLE[s.status])}>{t(`bio.status.${s.status}`)}</span>
                <span className="font-display text-2xl tabular">{s.bio_age != null ? fmtNum(s.bio_age, 0) : "—"}</span>
              </div>
            </div>
            {s.status !== "unknown" && <p className="mt-2 text-sm text-ink-2">{s.evidence}</p>}
            {s.key_metrics.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.key_metrics.map((m) => (
                  <span key={m.label} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-2">
                    {m.label}: <span className="text-ink">{m.value}</span>
                  </span>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>

      {(r.drivers_younger.length > 0 || r.drivers_older.length > 0) && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <DriverList title={t("bio.helping")} items={r.drivers_younger} tone="sage" />
          <DriverList title={t("bio.hurting")} items={r.drivers_older} tone="coral" />
        </div>
      )}

      <SectionTitle>{t("bio.recommendations")}</SectionTitle>
      <div className="space-y-3">
        {r.recommendations.map((rec, i) => (
          <Card key={i} className="p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-medium">{rec.title}</p>
              <span className={cx("shrink-0 text-xs", rec.priority === "high" ? "text-gold" : "text-ink-3")}>{t(`bio.priority.${rec.priority}`)}</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{rec.detail}</p>
            <p className="mt-1.5 text-xs text-sage">{rec.expected_effect}</p>
          </Card>
        ))}
      </div>

      {r.data_gaps.length > 0 && (
        <>
          <SectionTitle>{t("bio.gaps")}</SectionTitle>
          <Card className="space-y-3 text-sm">
            {r.data_gaps.map((g, i) => (
              <div key={i}>
                <p className="font-medium">{g.what}</p>
                <p className="text-ink-2">{g.why}</p>
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}

function DriverList({ title, items, tone }: { title: string; items: string[]; tone: "sage" | "coral" }) {
  if (!items.length) return null;
  return (
    <Card className="p-4">
      <p className={cx("text-sm font-medium", tone === "sage" ? "text-sage" : "text-coral")}>{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </Card>
  );
}

function History({ points }: { points: Overview["history"] }) {
  const { fmtDate, fmtNum, t } = useI18n();
  const data = points.map((p) => ({ label: fmtDate(p.createdAt, { day: "numeric", month: "short" }), bio: p.bioAge, chrono: Math.round(p.chronoAge * 10) / 10 }));
  if (!data.length) return <Empty>—</Empty>;
  return (
    <div style={{ height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--ink-3)", fontSize: 11 }} />
          <YAxis hide domain={["dataMin - 3", "dataMax + 3"]} />
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, fontSize: 13, color: "var(--ink)" }}
            formatter={(v, name) => [fmtNum(Number(v), 1), name === "bio" ? t("bio.title") : t("bio.chrono")]}
          />
          <Line type="monotone" dataKey="chrono" stroke="var(--ink-3)" strokeDasharray="4 4" dot={false} />
          <Line type="monotone" dataKey="bio" stroke="var(--gold)" strokeWidth={2.5} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
