import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { SendHorizontal } from "lucide-react";
import { useFetch } from "../lib/useFetch";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { post, ApiError } from "../lib/api";
import type { Message } from "../lib/types";
import { PageHeader, Spinner, Empty, cx } from "../components/ui";

export function Chat({ backTo = "/care" }: { backTo?: string }) {
  const { otherId } = useParams();
  const { t, fmtDate } = useI18n();
  const { me } = useSession();
  const other = useFetch<{ name: string }>(me?.role === "member" ? `/care/experts/${otherId}` : null);
  const res = useFetch<{ messages: Message[] }>(`/care/threads/${otherId}`, { pollMs: 8_000 });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [res.data?.messages.length]);

  if (res.error instanceof ApiError && res.error.status === 403) return <Empty>{t("care.notOnTeam")}</Empty>;

  return (
    <div className="flex min-h-[calc(100dvh-9rem)] flex-col">
      <PageHeader title={other.data?.name ?? t("nav.messages")} back={backTo} />
      <div className="flex-1 space-y-2 pb-4">
        {res.loading && !res.data ? (
          <Spinner />
        ) : res.data?.messages.length === 0 ? (
          <Empty>{t("care.chatEmpty")}</Empty>
        ) : (
          res.data?.messages.map((m) => {
            const mine = m.sender_id === me?.id;
            return (
              <div key={m.id} className={cx("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cx("max-w-[80%] rounded-3xl px-4 py-2.5", mine ? "rounded-br-lg bg-gold text-[#16170f]" : "rounded-bl-lg border border-line bg-surface")}>
                  <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{m.body}</p>
                  <p className={cx("mt-1 text-[11px]", mine ? "text-[#16170f]/60" : "text-ink-3")}>
                    {fmtDate(m.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={end} />
      </div>
      <form
        className="sticky bottom-20 flex items-end gap-2 rounded-3xl border border-line bg-surface p-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          setSending(true);
          try {
            await post(`/care/threads/${otherId}`, { body: draft });
            setDraft("");
            await res.reload();
          } finally {
            setSending(false);
          }
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={1}
          placeholder={t("care.chatPlaceholder")}
          aria-label={t("care.chatPlaceholder")}
          className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[16px] outline-none placeholder:text-ink-3"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="flex size-10 items-center justify-center rounded-full bg-gold text-[#16170f] disabled:opacity-40"
          aria-label={t("common.send")}
        >
          <SendHorizontal className="size-5" aria-hidden />
        </button>
      </form>
    </div>
  );
}
