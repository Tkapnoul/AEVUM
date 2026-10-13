import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Watch } from "lucide-react";
import { useFetch } from "../lib/useFetch";
import { useI18n, type MessageKey } from "../lib/i18n";
import { del, post } from "../lib/api";
import { timeAgo } from "../lib/format";
import type { Device } from "../lib/types";
import { Button, Card, PageHeader, cx } from "../components/ui";

export function ConnectBip6() {
  const { t, locale } = useI18n();
  const devices = useFetch<{ devices: Device[] }>("/devices");
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [justPaired, setJustPaired] = useState(false);
  const startedWith = useRef<string | null | undefined>(undefined);
  const current = devices.data?.devices.find((d) => d.kind === "amazfit_bip6") ?? null;

  // While a code is live, poll until a new device shows up.
  useEffect(() => {
    if (!code) return;
    const id = setInterval(() => {
      setNow(Date.now());
      void devices.reload();
    }, 3000);
    return () => clearInterval(id);
  }, [code, devices.reload]);
  useEffect(() => {
    if (code && current && current.id !== startedWith.current) {
      setCode(null);
      setJustPaired(true);
    }
  }, [code, current]);
  const paired = justPaired;

  const remaining = code ? Math.max(0, code.expiresAt - now) : 0;
  const steps: { title: MessageKey; body: MessageKey }[] = [
    { title: "device.step1.title", body: "device.step1.body" },
    { title: "device.step2.title", body: "device.step2.body" },
    { title: "device.step3.title", body: "device.step3.body" },
    { title: "device.step4.title", body: "device.step4.body" },
  ];

  return (
    <>
      <PageHeader title={t("device.bip6.title")} subtitle={t("device.bip6.intro")} back="/devices" />

      {current && (
        <Card className="mb-4 flex items-center gap-4 border-sage/40">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-sage-soft text-sage">
            {paired ? <CheckCircle2 className="size-5" aria-hidden /> : <Watch className="size-5" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{paired ? t("device.paired") : current.name}</p>
            <p className="text-sm text-ink-2">
              {t("device.connected")} · {t("today.lastSync")} {current.last_sync_at ? timeAgo(current.last_sync_at, locale) : t("device.never")}
            </p>
            <button
              className="mt-1 text-sm text-coral"
              onClick={async () => {
                await del(`/devices/${current.id}`);
                void devices.reload();
              }}
            >
              {t("profile.disconnect")}
            </button>
          </div>
        </Card>
      )}

      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Card className={cx("flex gap-4 p-4", i === 1 && "border-gold/40")}>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 font-display text-sm text-gold">{i + 1}</span>
              <div className="flex-1">
                <p className="font-medium">{t(s.title)}</p>
                <p className="mt-1 text-sm text-ink-2">{t(s.body)}</p>
                {i === 1 && (
                  <div className="mt-3">
                    {code && remaining > 0 ? (
                      <>
                        <p className="font-display text-4xl tracking-[0.3em] tabular select-all" aria-live="polite">
                          {code.code}
                        </p>
                        <p className="mt-1 text-xs text-ink-3">
                          {t("device.expires")} {Math.floor(remaining / 60000)}:{String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")} · {t("device.waiting")}
                        </p>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        loading={busy}
                        onClick={async () => {
                          setBusy(true);
                          startedWith.current = current?.id ?? null;
                          try {
                            setCode(await post("/devices/pairing-code", { kind: "amazfit_bip6" }));
                            setNow(Date.now());
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {t("device.step2.button")}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </>
  );
}
