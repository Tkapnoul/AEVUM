import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useFetch } from "../../lib/useFetch";
import { useI18n, type MessageKey } from "../../lib/i18n";
import { put } from "../../lib/api";
import { Button, Card, PageHeader, Spinner } from "../../components/ui";

interface Win {
  weekday: number;
  startMin: number;
  endMin: number;
}
interface Res {
  timeZone: string;
  profile: { title: string; bio: string; session_minutes: number; accepting: number } | null;
  windows: { weekday: number; start_min: number; end_min: number }[];
}

const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fromTime = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

export function Availability() {
  const { t } = useI18n();
  const res = useFetch<Res>("/expert/availability");
  const [wins, setWins] = useState<Win[]>([]);
  const [len, setLen] = useState(45);
  const [accepting, setAccepting] = useState(true);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!res.data) return;
    setWins(res.data.windows.map((w) => ({ weekday: w.weekday, startMin: w.start_min, endMin: w.end_min })));
    setLen(res.data.profile?.session_minutes ?? 45);
    setAccepting(Boolean(res.data.profile?.accepting ?? 1));
  }, [res.data]);

  if (!res.data) return <Spinner />;
  const days = [1, 2, 3, 4, 5, 6, 0];

  return (
    <>
      <PageHeader title={t("expert.availability")} subtitle={`${t("expert.timeZone")}: ${res.data.timeZone}`} back="/profile" />
      <Card className="space-y-4">
        <label className="flex items-center justify-between text-sm">
          {t("expert.sessionLength")}
          <select value={len} onChange={(e) => setLen(Number(e.target.value))} className="h-10 rounded-xl border border-line bg-surface px-3">
            {[20, 30, 45, 60, 90].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between text-sm">
          {t("expert.accepting")}
          <input type="checkbox" checked={accepting} onChange={(e) => setAccepting(e.target.checked)} className="size-5 accent-[var(--gold)]" />
        </label>
      </Card>
      <div className="mt-4 space-y-3">
        {days.map((d) => (
          <Card key={d} className="p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">{t(`weekday.${d}` as MessageKey)}</p>
              <button
                className="inline-flex items-center gap-1 text-sm text-gold"
                onClick={() => setWins((w) => [...w, { weekday: d, startMin: 9 * 60, endMin: 13 * 60 }])}
              >
                <Plus className="size-4" aria-hidden /> {t("expert.addWindow")}
              </button>
            </div>
            {wins.map((w, i) =>
              w.weekday === d ? (
                <div key={i} className="mt-3 flex items-center gap-2">
                  <input
                    type="time"
                    step={900}
                    value={toTime(w.startMin)}
                    onChange={(e) => setWins((ws) => ws.map((x, j) => (j === i ? { ...x, startMin: fromTime(e.target.value) } : x)))}
                    className="h-10 flex-1 rounded-xl border border-line bg-surface px-3 tabular"
                  />
                  <span className="text-ink-3">–</span>
                  <input
                    type="time"
                    step={900}
                    value={toTime(w.endMin)}
                    onChange={(e) => setWins((ws) => ws.map((x, j) => (j === i ? { ...x, endMin: fromTime(e.target.value) } : x)))}
                    className="h-10 flex-1 rounded-xl border border-line bg-surface px-3 tabular"
                  />
                  <button aria-label="Remove" onClick={() => setWins((ws) => ws.filter((_, j) => j !== i))} className="p-2 text-ink-3 hover:text-coral">
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              ) : null,
            )}
          </Card>
        ))}
      </div>
      <Button
        className="mt-5 w-full"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await put("/expert/availability", { windows: wins.filter((w) => w.endMin > w.startMin), sessionMinutes: len, accepting });
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          } finally {
            setBusy(false);
          }
        }}
      >
        {saved ? t("common.saved") : t("common.save")}
      </Button>
    </>
  );
}
