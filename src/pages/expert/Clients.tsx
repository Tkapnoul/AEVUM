import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useFetch } from "../../lib/useFetch";
import { useI18n } from "../../lib/i18n";
import { timeAgo } from "../../lib/format";
import { Avatar, Card, Empty, ErrorState, PageHeader, Spinner } from "../../components/ui";

interface Client {
  id: string;
  name: string;
  email: string;
  goals: string[];
  on_team: number;
  score: number | null;
  nextSession: number | null;
  lastSync: number | null;
}

export function Clients() {
  const { t, fmtDate, locale } = useI18n();
  const res = useFetch<{ clients: Client[] }>("/expert/clients");
  return (
    <>
      <PageHeader title={t("expert.clients")} />
      {res.loading && !res.data ? (
        <Spinner />
      ) : res.error ? (
        <ErrorState onRetry={res.reload} />
      ) : !res.data?.clients.length ? (
        <Empty>{t("expert.noClients")}</Empty>
      ) : (
        <div className="space-y-3">
          {res.data.clients.map((c) => (
            <Link key={c.id} to={`/expert/clients/${c.id}`}>
              <Card className="flex items-center gap-3 p-4">
                <Avatar name={c.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-xs text-ink-3">
                    {c.nextSession ? `${t("expert.next")}: ${fmtDate(c.nextSession, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : c.email}
                    {" · "}
                    {t("expert.lastSync")}: {c.lastSync ? timeAgo(c.lastSync, locale) : t("device.never")}
                  </p>
                </div>
                <span className="font-display text-2xl text-gold tabular">{c.score ?? "—"}</span>
                <ChevronRight className="size-5 text-ink-3" aria-hidden />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
