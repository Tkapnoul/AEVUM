import { useFetch } from "../lib/useFetch";
import { useI18n } from "../lib/i18n";
import type { Lab } from "../lib/types";
import { Card, Empty, ErrorState, PageHeader, Spinner, cx } from "../components/ui";

export function LabsPage({ member, onAdd }: { member?: string; onAdd?: React.ReactNode }) {
  const { t, fmtDate, fmtNum } = useI18n();
  const res = useFetch<{ labs: Lab[] }>(`/metrics/labs${member ? `?member=${member}` : ""}`);
  if (res.loading && !res.data) return <Spinner />;
  if (res.error) return <ErrorState onRetry={res.reload} />;
  // Latest result per marker, keeping the previous one for the trend arrow.
  const byMarker = new Map<string, Lab[]>();
  for (const l of res.data?.labs ?? []) byMarker.set(l.marker, [...(byMarker.get(l.marker) ?? []), l]);

  return (
    <>
      {!member && <PageHeader title={t("data.labs")} back="/data" />}
      {onAdd}
      {byMarker.size === 0 ? (
        <Empty>{t("data.labsEmpty")}</Empty>
      ) : (
        <div className="space-y-3">
          {[...byMarker.entries()].map(([marker, rows]) => {
            const l = rows.at(-1)!;
            const prev = rows.at(-2);
            const out = (l.ref_low != null && l.value < l.ref_low) || (l.ref_high != null && l.value > l.ref_high);
            return (
              <Card key={marker} className="p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{marker}</p>
                  <p className="font-display text-2xl tabular">
                    {fmtNum(l.value, 2)} <span className="font-sans text-xs text-ink-3">{l.unit}</span>
                  </p>
                </div>
                <RangeBar lab={l} />
                <div className="mt-2 flex justify-between text-xs text-ink-3">
                  <span className={cx(out ? "text-coral" : "text-sage")}>{out ? t("data.outOfRange") : t("data.inRange")}</span>
                  <span>
                    {t("data.range")}: {l.ref_low ?? "–"} – {l.ref_high ?? "–"} · {fmtDate(l.taken_at, { day: "numeric", month: "short", year: "numeric" })}
                    {prev && ` · ${prev.value < l.value ? "↑" : prev.value > l.value ? "↓" : "→"} ${fmtNum(prev.value, 2)}`}
                  </span>
                </div>
                {l.note && <p className="mt-2 text-sm text-ink-2">{l.note}</p>}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

function RangeBar({ lab }: { lab: Lab }) {
  const lo = lab.ref_low ?? (lab.ref_high != null ? 0 : null);
  const hi = lab.ref_high ?? (lab.ref_low != null ? lab.ref_low * 2 : null);
  if (lo == null || hi == null || hi <= lo) return null;
  const span = hi - lo;
  const min = lo - span * 0.5;
  const max = hi + span * 0.5;
  const pos = Math.max(0, Math.min(1, (lab.value - min) / (max - min)));
  return (
    <div className="relative mt-3 h-1.5 rounded-full bg-line" aria-hidden>
      <div className="absolute inset-y-0 rounded-full bg-sage/40" style={{ left: `${((lo - min) / (max - min)) * 100}%`, right: `${100 - ((hi - min) / (max - min)) * 100}%` }} />
      <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink" style={{ left: `${pos * 100}%` }} />
    </div>
  );
}
