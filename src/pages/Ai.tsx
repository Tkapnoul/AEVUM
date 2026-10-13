import { useEffect, useRef, useState } from "react";
import { ArrowUp, Plus, Sparkles } from "lucide-react";
import { useFetch } from "../lib/useFetch";
import { useI18n, type MessageKey } from "../lib/i18n";
import { post } from "../lib/api";
import type { AppConfig } from "../lib/types";
import { Card, PageHeader, cx } from "../components/ui";
import { RichText } from "../components/RichText";

interface Msg {
  role: "user" | "assistant";
  text: string;
  status?: string;
  error?: boolean;
}

type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; name: string }
  | { type: "refusal" }
  | { type: "error"; code: string }
  | { type: "done" };

async function* readSSE(res: Response): AsyncGenerator<StreamEvent> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) yield JSON.parse(data) as StreamEvent;
    }
  }
}

export function Ai() {
  const { t } = useI18n();
  const config = useFetch<AppConfig>("/config");
  const history = useFetch<{ messages: Msg[] }>("/ai/history");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (history.data) setMsgs(history.data.messages);
  }, [history.data]);
  useEffect(() => end.current?.scrollIntoView({ block: "end", behavior: "smooth" }), [msgs]);

  const update = (fn: (m: Msg) => Msg) => setMsgs((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setDraft("");
    setBusy(true);
    setMsgs((prev) => [...prev, { role: "user", text }, { role: "assistant", text: "", status: "…" }]);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) {
        const code = res.status === 503 ? "ai.notConfigured" : "ai.failed";
        update((m) => ({ ...m, status: undefined, error: true, text: t(code) }));
        return;
      }
      for await (const ev of readSSE(res)) {
        if (ev.type === "text") update((m) => ({ ...m, text: m.text + ev.delta, status: undefined }));
        else if (ev.type === "tool") update((m) => ({ ...m, status: t(`ai.tool.${ev.name}` as MessageKey) }));
        else if (ev.type === "refusal") update((m) => ({ ...m, status: undefined, text: m.text || t("ai.refusal") }));
        else if (ev.type === "error") update((m) => ({ ...m, status: undefined, error: true, text: m.text ? `${m.text}\n\n${t("ai.failed")}` : t("ai.failed") }));
      }
    } catch {
      update((m) => ({ ...m, status: undefined, error: true, text: t("ai.failed") }));
    } finally {
      update((m) => ({ ...m, status: undefined }));
      setBusy(false);
    }
  }

  const disabled = config.data && !config.data.aiEnabled;
  const suggestions: MessageKey[] = ["ai.suggest.1", "ai.suggest.2", "ai.suggest.3", "ai.suggest.4"];

  return (
    <div className="flex min-h-[calc(100dvh-8rem)] flex-col">
      <PageHeader
        title={t("ai.title")}
        action={
          msgs.length > 0 && (
            <button
              onClick={async () => {
                await post("/ai/new");
                setMsgs([]);
              }}
              className="inline-flex h-9 items-center gap-1 rounded-full border border-line px-3 text-sm text-ink-2 hover:text-ink"
            >
              <Plus className="size-4" aria-hidden /> {t("ai.new")}
            </button>
          )
        }
      />

      <div className="flex-1 space-y-4 pb-4" aria-live="polite">
        {msgs.length === 0 && (
          <>
            <Card className="border-gold/30 bg-gold-soft/40">
              <Sparkles className="size-5 text-gold" aria-hidden />
              <p className="mt-2 text-[15px] text-ink">{disabled ? t("ai.notConfigured") : t("ai.subtitle")}</p>
            </Card>
            {!disabled && (
              <div className="grid gap-2">
                {suggestions.map((k) => (
                  <button key={k} onClick={() => send(t(k))} className="rounded-2xl border border-line bg-surface px-4 py-3 text-left text-sm text-ink-2 hover:text-ink">
                    {t(k)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cx("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-surface-2 px-4 py-2.5 text-[15px] whitespace-pre-wrap">{m.text}</div>
            ) : (
              <div className={cx("max-w-full text-[15px] leading-relaxed", m.error && "text-coral")}>
                {m.text ? <RichText text={m.text} /> : null}
                {m.status && (
                  <p className="flex items-center gap-2 text-sm text-ink-3">
                    <span className="size-2 animate-pulse rounded-full bg-gold" aria-hidden /> {m.status}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>

      <div className="sticky bottom-20">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className="flex items-end gap-2 rounded-3xl border border-line bg-surface p-2 shadow-lg shadow-black/5"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !("ontouchstart" in window)) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={1}
            disabled={disabled || busy}
            placeholder={t("ai.placeholder")}
            aria-label={t("ai.placeholder")}
            className="max-h-36 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[16px] outline-none placeholder:text-ink-3"
          />
          <button
            type="submit"
            disabled={disabled || busy || !draft.trim()}
            className="flex size-10 items-center justify-center rounded-full bg-gold text-[#16170f] disabled:opacity-40"
            aria-label={t("common.send")}
          >
            <ArrowUp className="size-5" aria-hidden />
          </button>
        </form>
        <p className="mt-2 text-center text-[11px] text-ink-3">{t("ai.disclaimer")}</p>
      </div>
    </div>
  );
}
