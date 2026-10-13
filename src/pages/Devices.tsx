import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, Apple, Check, ChevronRight, Copy, FileArchive, Smartphone, Watch, Webhook } from "lucide-react";
import { useFetch } from "../lib/useFetch";
import { useI18n } from "../lib/i18n";
import { post } from "../lib/api";
import { getServer, isLocal, isNative, platform } from "../lib/native";
import { timeAgo } from "../lib/format";
import type { Device } from "../lib/types";
import { Button, Card, PageHeader, SectionTitle } from "../components/ui";
import type { Locale } from "../../shared/company";

// Which app each brand writes through. Shown so members know what to switch on in their watch's app.
const BRANDS: { brand: string; via: Record<Locale, string> }[] = [
  { brand: "Apple Watch", via: { el: "αυτόματα στο Apple Health", en: "automatically into Apple Health" } },
  { brand: "Garmin", via: { el: "Garmin Connect → Apple Health / Health Connect", en: "Garmin Connect → Apple Health / Health Connect" } },
  { brand: "Samsung Galaxy Watch", via: { el: "Samsung Health → Health Connect", en: "Samsung Health → Health Connect" } },
  { brand: "Google Pixel Watch / Fitbit", via: { el: "Fitbit → Health Connect / Apple Health", en: "Fitbit → Health Connect / Apple Health" } },
  { brand: "Amazfit / Zepp", via: { el: "Zepp → Apple Health / Health Connect", en: "Zepp → Apple Health / Health Connect" } },
  { brand: "Oura, Whoop, Withings, Polar, Coros, Xiaomi, Suunto", via: { el: "η εφαρμογή τους → Apple Health / Health Connect", en: "their app → Apple Health / Health Connect" } },
];

export function Devices() {
  const { t, locale } = useI18n();
  const devices = useFetch<{ devices: Device[] }>("/devices");
  const byKind = (k: string) => devices.data?.devices.find((d) => d.kind === k);
  const syncedLabel = (d?: Device) => (d?.last_sync_at ? `${t("today.lastSync")} ${timeAgo(d.last_sync_at, locale)}` : null);

  return (
    <>
      <PageHeader title={t("data.devices")} subtitle={t("devices.intro")} back="/profile" />

      {isNative ? <NativeHealth device={byKind(platform === "ios" ? "apple_health" : "health_connect")} onSynced={devices.reload} /> : (
        <Card className="flex gap-4">
          <Smartphone className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden />
          <div>
            <p className="font-medium">{t("devices.getApp")}</p>
            <p className="mt-1 text-sm text-ink-2">{t(isLocal() ? "devices.getAppTextLocal" : "devices.getAppText")}</p>
          </div>
        </Card>
      )}

      <SectionTitle>{t("devices.which")}</SectionTitle>
      <Card className="divide-y divide-line p-0">
        {BRANDS.map((b) => (
          <div key={b.brand} className="px-5 py-3 text-sm">
            <p className="font-medium">{b.brand}</p>
            <p className="text-ink-2">{b.via[locale]}</p>
          </div>
        ))}
      </Card>

      {(!isNative || platform === "ios") && (
        <>
          <SectionTitle>iPhone</SectionTitle>
          <div className="space-y-3">
            {/* Health Auto Export, the Zepp mini-app and the API push to a server address: not possible in local mode. */}
            {!isLocal() && <TokenCard
              kind="health_auto_export"
              icon={<Apple className="size-5" aria-hidden />}
              title={t("devices.hae.title")}
              body={t("devices.hae.body")}
              path="/api/device/ingest/hae"
              extra={t("devices.hae.settings")}
              status={syncedLabel(byKind("health_auto_export"))}
            />}
            <ExportImport status={syncedLabel(byKind("apple_health_export"))} onDone={devices.reload} />
          </div>
        </>
      )}

      {isLocal() ? (
        <p className="mt-6 text-sm text-ink-3">{t(isNative ? "devices.localNote" : "devices.localNoteWeb")}</p>
      ) : (
        <>
          <SectionTitle>{t("devices.zepp")}</SectionTitle>
          <Link to="/devices/bip6">
            <Card className="flex items-center gap-4 p-4">
              <Watch className="size-5 text-gold" aria-hidden />
              <div className="flex-1">
                <p className="font-medium">Amazfit Bip 6</p>
                <p className="text-xs text-ink-3">{syncedLabel(byKind("amazfit_bip6")) ?? t("devices.zeppHint")}</p>
              </div>
              <ChevronRight className="size-5 text-ink-3" aria-hidden />
            </Card>
          </Link>

          <SectionTitle>API</SectionTitle>
          <TokenCard
            kind="api"
            icon={<Webhook className="size-5" aria-hidden />}
            title={t("devices.api.title")}
            body={t("devices.api.body")}
            path="/api/device/ingest/generic"
            status={syncedLabel(byKind("api"))}
          />
        </>
      )}
    </>
  );
}

function NativeHealth({ device, onSynced }: { device?: Device; onSynced: () => void }) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<{ busy: boolean; msg: string | null; error: boolean }>({ busy: false, msg: null, error: false });
  const name = platform === "ios" ? "Apple Health" : "Health Connect";

  async function connectAndSync() {
    setState({ busy: true, msg: null, error: false });
    try {
      const hs = await import("../lib/healthSync");
      const avail = await hs.healthAvailable();
      if (!avail.available) {
        setState({ busy: false, msg: t("devices.unavailable"), error: true });
        return;
      }
      await hs.connectHealth();
      const r = await hs.syncHealth({ full: !device });
      setState({ busy: false, msg: t("devices.synced", { m: r.metrics, n: r.nights }), error: false });
      onSynced();
    } catch (e) {
      setState({ busy: false, msg: `${t("devices.syncFailed")}: ${e instanceof Error ? e.message : ""}`, error: true });
    }
  }

  return (
    <Card>
      <div className="flex items-center gap-4">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-sage-soft text-sage">
          <Activity className="size-5" aria-hidden />
        </span>
        <div className="flex-1">
          <p className="font-medium">{name}</p>
          <p className="text-sm text-ink-2">
            {t("today.lastSync")}: {device?.last_sync_at ? timeAgo(device.last_sync_at, locale) : t("device.never")}
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-3">{t("devices.auto")}</p>
      <div className="mt-4 flex gap-2">
        <Button className="flex-1" size="sm" loading={state.busy} onClick={connectAndSync}>
          {state.busy ? t("devices.syncing") : device ? t("devices.sync") : t("devices.connect")}
        </Button>
        {platform === "android" && (
          <Button variant="secondary" size="sm" onClick={async () => (await import("../lib/healthSync")).openHealthSettings()}>
            {t("devices.permissions")}
          </Button>
        )}
      </div>
      {state.msg && <p className={`mt-3 text-sm ${state.error ? "text-coral" : "text-sage"}`}>{state.msg}</p>}
    </Card>
  );
}

function TokenCard({ kind, icon, title, body, path, extra, status }: { kind: string; icon: React.ReactNode; title: string; body: string; path: string; extra?: string; status: string | null }) {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = isNative ? getServer() : window.location.origin;
  return (
    <Card>
      <div className="flex items-start gap-4">
        <span className="mt-0.5 text-gold">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          {status && <p className="text-xs text-sage">{status}</p>}
          <p className="mt-1 text-sm text-ink-2">{body}</p>
          <dl className="mt-3 space-y-2 text-sm">
            <CopyRow label="URL" value={`${base}${path}`} />
            {token ? (
              <>
                <CopyRow label="Header" value={`Authorization: Bearer ${token}`} />
                <p className="text-xs text-gold">{t("devices.token.once")}</p>
              </>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setToken((await post<{ token: string }>("/devices/token", { kind })).token);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("devices.token.create")}
              </Button>
            )}
          </dl>
          {extra && <p className="mt-3 text-xs text-ink-3">{extra}</p>}
        </div>
      </div>
    </Card>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2 py-1.5 text-xs">{value}</code>
        <button
          className="shrink-0 rounded-lg p-1.5 text-ink-2 hover:text-ink"
          aria-label={t("devices.copy")}
          onClick={async () => {
            await navigator.clipboard.writeText(value).catch(() => undefined);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check className="size-4 text-sage" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </button>
      </dd>
    </div>
  );
}

function ExportImport({ status, onDone }: { status: string | null; onDone: () => void }) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [mb, setMb] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  return (
    <Card>
      <div className="flex items-start gap-4">
        <FileArchive className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden />
        <div className="flex-1">
          <p className="font-medium">{t("devices.export.title")}</p>
          {status && <p className="text-xs text-sage">{status}</p>}
          <p className="mt-1 text-sm text-ink-2">{t("devices.export.body")}</p>
          <input
            ref={input}
            type="file"
            accept=".zip,.xml,application/zip,text/xml"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setMsg(null);
              setMb(0);
              try {
                const { importAppleExport } = await import("../lib/appleExport");
                const r = await importAppleExport(file, setMb);
                setMsg({ text: t("devices.export.done", { m: r.metrics, n: r.nights }), error: false });
                onDone();
              } catch {
                setMsg({ text: t("devices.export.failed"), error: true });
              } finally {
                setMb(null);
              }
            }}
          />
          <Button size="sm" variant="secondary" className="mt-3" loading={mb != null} onClick={() => input.current?.click()}>
            {mb != null ? t("devices.export.progress", { mb }) : t("devices.export.pick")}
          </Button>
          {msg && <p className={`mt-3 text-sm ${msg.error ? "text-coral" : "text-sage"}`}>{msg.text}</p>}
        </div>
      </div>
    </Card>
  );
}
