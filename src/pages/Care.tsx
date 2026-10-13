import { Link } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { useFetch } from "../lib/useFetch";
import { useI18n } from "../lib/i18n";
import type { Booking, Expert, Thread } from "../lib/types";
import { Avatar, Button, Card, Empty, PageHeader, SectionTitle, Spinner } from "../components/ui";
import { SessionCard } from "../components/SessionCard";

export function Care() {
  const { t, fmtDate } = useI18n();
  const experts = useFetch<{ experts: Expert[] }>("/care/experts");
  const upcoming = useFetch<{ bookings: Booking[] }>("/care/bookings?scope=upcoming");
  const past = useFetch<{ bookings: Booking[] }>("/care/bookings?scope=past");
  const threads = useFetch<{ threads: Thread[] }>("/care/threads", { pollMs: 30_000 });
  const unread = new Map(threads.data?.threads.map((th) => [th.other_id, th.unread]) ?? []);

  const team = experts.data?.experts.filter((e) => e.on_team) ?? [];
  const others = experts.data?.experts.filter((e) => !e.on_team) ?? [];
  const active = upcoming.data?.bookings.filter((b) => b.status === "booked") ?? [];
  // Messaging is open with experts the member is linked to: care team, or anyone they've booked.
  const booked = new Set(
    [...(upcoming.data?.bookings ?? []), ...(past.data?.bookings ?? [])].filter((b) => b.status !== "cancelled").map((b) => b.expert_id),
  );

  return (
    <>
      <PageHeader title={t("care.title")} />
      {experts.loading && !experts.data ? (
        <Spinner />
      ) : (
        <>
          <SectionTitle>{t("care.team")}</SectionTitle>
          <div className="space-y-3">
            {team.map((e) => (
              <ExpertRow key={e.id} e={e} unread={unread.get(e.id) ?? 0} canMessage />
            ))}
          </div>

          <SectionTitle>{t("care.upcoming")}</SectionTitle>
          {active.length ? (
            <div className="space-y-3">
              {active.map((b) => (
                <SessionCard key={b.id} booking={b} />
              ))}
            </div>
          ) : (
            <Empty>{t("today.noSession")}</Empty>
          )}

          {others.length > 0 && (
            <>
              <SectionTitle>{t("care.allExperts")}</SectionTitle>
              <div className="space-y-3">
                {others.map((e) => (
                  <ExpertRow key={e.id} e={e} unread={unread.get(e.id) ?? 0} canMessage={booked.has(e.id) || unread.has(e.id)} />
                ))}
              </div>
            </>
          )}

          {(past.data?.bookings.length ?? 0) > 0 && (
            <>
              <SectionTitle>{t("care.past")}</SectionTitle>
              <Card className="divide-y divide-line p-0">
                {past.data!.bookings.map((b) => (
                  <Link key={b.id} to={`/care/session/${b.id}`} className="flex items-center justify-between px-5 py-3.5 text-sm">
                    <span>
                      {b.expert_name}
                      {b.topic && <span className="text-ink-3"> · {b.topic}</span>}
                    </span>
                    <span className="text-ink-3">{fmtDate(b.starts_at)}</span>
                  </Link>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}

function ExpertRow({ e, unread, canMessage }: { e: Expert; unread: number; canMessage: boolean }) {
  const { t } = useI18n();
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Avatar name={e.name} role={e.role} size={48} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{e.name}</p>
          <p className="text-sm text-ink-2">
            {e.title || t(`role.${e.role}`)} · {e.session_minutes} {t("care.minutes")}
          </p>
          {e.bio && <p className="mt-1.5 line-clamp-2 text-sm text-ink-3">{e.bio}</p>}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Link to={`/care/book/${e.id}`} className="flex-1">
          <Button size="sm" className="w-full" disabled={!e.accepting}>
            {t("care.book")}
          </Button>
        </Link>
        {canMessage && (
          <Link to={`/care/chat/${e.id}`} className="relative">
            <Button size="sm" variant="secondary">
              <MessageCircle className="size-4" aria-hidden /> {t("care.message")}
            </Button>
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-coral text-[11px] font-semibold text-white">
                {unread}
              </span>
            )}
          </Link>
        )}
      </div>
    </Card>
  );
}
