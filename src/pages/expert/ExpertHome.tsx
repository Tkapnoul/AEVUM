import { useFetch } from "../../lib/useFetch";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import type { Booking } from "../../lib/types";
import { Empty, ErrorState, SectionTitle, Spinner } from "../../components/ui";
import { SessionCard } from "../../components/SessionCard";

export function ExpertHome() {
  const { t, fmtDate } = useI18n();
  const { me } = useSession();
  const res = useFetch<{ bookings: Booking[] }>("/care/bookings?scope=upcoming", { pollMs: 60_000 });
  const today = new Date().toDateString();
  const active = res.data?.bookings.filter((b) => b.status === "booked") ?? [];
  const todays = active.filter((b) => new Date(b.starts_at).toDateString() === today);
  const later = active.filter((b) => new Date(b.starts_at).toDateString() !== today);

  return (
    <>
      <header className="mb-4 pt-2">
        <p className="text-sm text-ink-3 capitalize">{fmtDate(Date.now(), { weekday: "long", day: "numeric", month: "long" })}</p>
        <h1 className="mt-1 font-display text-[32px] leading-tight font-medium">{me?.name}</h1>
      </header>
      {res.loading && !res.data ? (
        <Spinner />
      ) : res.error ? (
        <ErrorState onRetry={res.reload} />
      ) : (
        <>
          <SectionTitle>{t("expert.today")}</SectionTitle>
          {todays.length ? (
            <div className="space-y-3">
              {todays.map((b) => (
                <SessionCard key={b.id} booking={b} viewAs="expert" />
              ))}
            </div>
          ) : (
            <Empty>{t("today.noSession")}</Empty>
          )}
          <SectionTitle>{t("expert.upcoming")}</SectionTitle>
          {later.length ? (
            <div className="space-y-3">
              {later.map((b) => (
                <SessionCard key={b.id} booking={b} viewAs="expert" />
              ))}
            </div>
          ) : (
            <Empty>{t("today.noSession")}</Empty>
          )}
        </>
      )}
    </>
  );
}
