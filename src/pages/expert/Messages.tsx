import { Link } from "react-router-dom";
import { useFetch } from "../../lib/useFetch";
import { useI18n } from "../../lib/i18n";
import { timeAgo } from "../../lib/format";
import type { Thread } from "../../lib/types";
import { Avatar, Card, Empty, PageHeader, Spinner } from "../../components/ui";

export function ExpertMessages() {
  const { t, locale } = useI18n();
  const res = useFetch<{ threads: Thread[] }>("/care/threads", { pollMs: 15_000 });
  return (
    <>
      <PageHeader title={t("nav.messages")} />
      {res.loading && !res.data ? (
        <Spinner />
      ) : !res.data?.threads.length ? (
        <Empty>{t("care.chatEmpty")}</Empty>
      ) : (
        <Card className="divide-y divide-line p-0">
          {res.data.threads.map((th) => (
            <Link key={th.other_id} to={`/expert/messages/${th.other_id}`} className="flex items-center gap-3 px-4 py-3.5">
              <Avatar name={th.other_name} size={40} />
              <div className="min-w-0 flex-1">
                <p className="flex justify-between gap-2">
                  <span className="truncate font-medium">{th.other_name}</span>
                  <span className="shrink-0 text-xs text-ink-3">{timeAgo(th.last_at, locale)}</span>
                </p>
                <p className="truncate text-sm text-ink-2">{th.last_body}</p>
              </div>
              {th.unread > 0 && <span className="flex size-5 items-center justify-center rounded-full bg-coral text-[11px] font-semibold text-white">{th.unread}</span>}
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
