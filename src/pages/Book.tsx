import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check } from "lucide-react";
import { useFetch } from "../lib/useFetch";
import { useI18n } from "../lib/i18n";
import { post, ApiError } from "../lib/api";
import type { Expert } from "../lib/types";
import { Avatar, Button, Card, Empty, ErrorState, PageHeader, Spinner, cx } from "../components/ui";

export function Book() {
  const { expertId } = useParams();
  const { t, fmtDate } = useI18n();
  const nav = useNavigate();
  const expert = useFetch<Expert>(`/care/experts/${expertId}`);
  const slots = useFetch<{ timeZone: string; slots: { startsAt: number; endsAt: number }[] }>(`/care/experts/${expertId}/slots?days=14`);
  const [picked, setPicked] = useState<number | null>(null);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const s of slots.data?.slots ?? []) {
      const d = fmtDate(s.startsAt, { weekday: "long", day: "numeric", month: "long" });
      m.set(d, [...(m.get(d) ?? []), s.startsAt]);
    }
    return [...m.entries()];
  }, [slots.data, fmtDate]);

  async function confirm() {
    if (picked == null) return;
    setBusy(true);
    setError(null);
    try {
      const b = await post<{ id: string }>("/care/bookings", { expertId, startsAt: picked, topic });
      nav(`/care/session/${b.id}?booked=1`, { replace: true });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t("care.slotTaken") : t("common.error"));
      setPicked(null);
      void slots.reload();
    } finally {
      setBusy(false);
    }
  }

  if (expert.loading || slots.loading) return <Spinner />;
  if (expert.error || slots.error || !expert.data) return <ErrorState onRetry={() => (expert.reload(), slots.reload())} />;
  const e = expert.data;

  return (
    <>
      <PageHeader title={t("care.pickSlot")} back="/care" />
      <Card className="flex items-center gap-3 p-4">
        <Avatar name={e.name} role={e.role} />
        <div>
          <p className="font-medium">{e.name}</p>
          <p className="text-sm text-ink-2">
            {e.title || t(`role.${e.role}`)} · {e.session_minutes} {t("care.minutes")}
          </p>
        </div>
      </Card>

      {error && (
        <p className="mt-4 rounded-2xl bg-coral-soft px-4 py-3 text-sm text-coral" role="alert">
          {error}
        </p>
      )}

      {byDay.length === 0 ? (
        <div className="mt-6">
          <Empty>{t("care.noSlots")}</Empty>
        </div>
      ) : (
        <div className="mt-6 space-y-6 pb-40">
          {byDay.map(([day, starts]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-medium text-ink-2 capitalize">{day}</h2>
              <div className="grid grid-cols-4 gap-2">
                {starts.map((s) => (
                  <button
                    key={s}
                    onClick={() => setPicked(s)}
                    aria-pressed={picked === s}
                    className={cx(
                      "h-11 rounded-2xl border text-sm tabular transition",
                      picked === s ? "border-gold bg-gold text-[#16170f]" : "border-line bg-surface hover:border-ink-3",
                    )}
                  >
                    {fmtDate(s, { hour: "2-digit", minute: "2-digit" })}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {picked != null && (
        <div className="pb-safe fixed inset-x-0 bottom-16 z-10 border-t border-line bg-bg/95 backdrop-blur-xl">
          <div className="mx-auto max-w-xl space-y-3 px-4 py-4">
            <p className="text-sm">
              <Check className="mr-1 inline size-4 text-gold" aria-hidden />
              {fmtDate(picked, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
            </p>
            <input
              value={topic}
              onChange={(ev) => setTopic(ev.target.value)}
              placeholder={t("care.topic")}
              maxLength={500}
              className="h-11 w-full rounded-2xl border border-line bg-surface px-4 text-[16px] outline-none placeholder:text-ink-3 focus:border-gold"
            />
            <Button className="w-full" onClick={confirm} loading={busy}>
              {t("care.confirm")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
