import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Download, LogOut, Shield, Smartphone, Sparkles, Watch } from "lucide-react";
import { useFetch } from "../lib/useFetch";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { del, patch } from "../lib/api";
import { applyTheme, getTheme, type ThemePref } from "../lib/theme";
import { useInstall } from "../lib/install";
import { timeAgo } from "../lib/format";
import type { Device } from "../lib/types";
import { isLocal, isNative, openExternal } from "../lib/native";
import { Avatar, Button, Card, PageHeader, SectionTitle, Segmented } from "../components/ui";
import { company, type Locale } from "../../shared/company";

export function Profile({ onLocale }: { onLocale: (l: Locale) => void }) {
  const { t, locale } = useI18n();
  const { me, logout, refresh } = useSession();
  const devices = useFetch<{ devices: Device[] }>(me?.role === "member" ? "/devices" : null);
  const [theme, setTheme] = useState<ThemePref>(getTheme());
  const install = useInstall();
  if (!me) return null;
  const isMember = me.role === "member";
  const connected = devices.data?.devices ?? [];

  return (
    <>
      <PageHeader title={t("profile.title")} />
      <Card className="flex items-center gap-4">
        <Avatar name={me.name} role={me.role} size={56} />
        <div className="min-w-0">
          <p className="truncate text-lg font-medium">{me.name}</p>
          <p className="truncate text-sm text-ink-2">{me.email}</p>
          <p className="mt-0.5 text-xs text-ink-3">
            {isMember ? `${t("profile.plan")}: ${company.plans.find((p) => p.id === me.plan)?.name[locale] ?? "—"}` : t(`role.${me.role}`)}
          </p>
        </div>
      </Card>

      {isMember && me.goals.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {me.goals.map((g) => (
            <span key={g} className="rounded-full bg-surface-2 px-3 py-1 text-xs text-ink-2">
              {company.goals.find((x) => x.key === g)?.label[locale] ?? g}
            </span>
          ))}
        </div>
      )}

      {isMember && (
        <>
          <SectionTitle>{t("profile.devices")}</SectionTitle>
          <Link to="/devices">
            <Card className="flex items-center gap-4 p-4">
              <Watch className="size-5 text-gold" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t("data.devices")}</p>
                <p className="truncate text-xs text-ink-3">
                  {connected.length
                    ? connected.map((d) => `${d.name}${d.last_sync_at ? ` · ${timeAgo(d.last_sync_at, locale)}` : ""}`).join(" — ")
                    : t("profile.connect")}
                </p>
              </div>
              <ChevronRight className="size-5 text-ink-3" aria-hidden />
            </Card>
          </Link>
          <SectionTitle>{t("profile.details")}</SectionTitle>
          <DetailsForm />
        </>
      )}

      {Boolean(me.is_admin) && (
        <Link to="/admin" className="mt-3 block">
          <Card className="flex items-center gap-3 p-4">
            <Shield className="size-5 text-gold" aria-hidden />
            <span className="flex-1 font-medium">{t("profile.admin")}</span>
            <ChevronRight className="size-5 text-ink-3" aria-hidden />
          </Card>
        </Link>
      )}

      {!isMember && (
        <Link to="/expert/availability" className="mt-3 block">
          <Card className="flex items-center justify-between p-4">
            <span className="font-medium">{t("expert.availability")}</span>
            <ChevronRight className="size-5 text-ink-3" aria-hidden />
          </Card>
        </Link>
      )}

      {isLocal() && (
        <>
          <SectionTitle>{t("profile.ai")}</SectionTitle>
          <LocalAiKey />
        </>
      )}

      {!isNative && <SectionTitle>{t("profile.install")}</SectionTitle>}
      <Card className={isNative ? "hidden" : "flex items-start gap-4"}>
        <Smartphone className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden />
        <div className="flex-1 text-sm">
          {install.installed ? (
            <p className="text-ink-2">{t("profile.installed")}</p>
          ) : (
            <>
              <p className="text-ink-2">{t("profile.installHint")}</p>
              {install.canPrompt && (
                <Button size="sm" className="mt-3" onClick={install.prompt}>
                  {t("profile.install")}
                </Button>
              )}
              {install.ios && <p className="mt-2 text-ink-3">{t("profile.installIos")}</p>}
            </>
          )}
        </div>
      </Card>

      <SectionTitle>{t("profile.language")}</SectionTitle>
      <div className="flex flex-wrap gap-3">
        <Segmented
          value={locale}
          onChange={async (l: Locale) => {
            onLocale(l);
            await patch("/auth/me", { locale: l }).catch(() => undefined);
            void refresh();
          }}
          options={[
            { value: "el", label: "Ελληνικά" },
            { value: "en", label: "English" },
          ]}
        />
        <Segmented
          value={theme}
          onChange={(v: ThemePref) => {
            setTheme(v);
            applyTheme(v);
          }}
          options={[
            { value: "system", label: t("profile.theme.system") },
            { value: "dark", label: t("profile.theme.dark") },
            { value: "light", label: t("profile.theme.light") },
          ]}
        />
      </div>

      <SectionTitle>{t("profile.privacy")}</SectionTitle>
      <Card className="divide-y divide-line p-0">
        {!isNative && (
          <a href="/api/auth/me/export" className="flex items-center gap-4 px-5 py-4 text-sm">
            <Download className="size-5 text-ink-2" aria-hidden /> {t("profile.export")}
          </a>
        )}
        <DeleteAccount onDeleted={logout} />
      </Card>

      <Button variant="secondary" className="mt-6 w-full" onClick={logout}>
        <LogOut className="size-4" aria-hidden /> {t("profile.logout")}
      </Button>
      <p className="mt-6 text-center text-xs text-ink-3">
        {company.name} · {company.supportEmail}
      </p>
    </>
  );
}

function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="w-full px-5 py-4 text-left text-sm text-coral">
        {t("profile.delete")}
      </button>
    );
  return (
    <form
      className="space-y-3 px-5 py-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await del("/auth/me", { password: pw });
          onDeleted();
        } catch {
          setErr(true);
        }
      }}
    >
      <p className="text-sm text-ink-2">{t("profile.deleteConfirm")}</p>
      <input
        type="password"
        required
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        aria-label={t("auth.password")}
        className="h-11 w-full rounded-2xl border border-line bg-surface px-4 text-[16px] outline-none focus:border-coral"
      />
      {err && <p className="text-sm text-coral">{t("auth.invalid")}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="danger" size="sm">
          {t("profile.delete")}
        </Button>
      </div>
    </form>
  );
}

function DetailsForm() {
  const { t } = useI18n();
  const { me, refresh } = useSession();
  const [f, setF] = useState({ birthDate: me?.birth_date ?? "", sex: me?.sex ?? "", heightCm: me?.height_cm ? String(me.height_cm) : "" });
  const [saved, setSaved] = useState(false);
  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          await patch("/auth/me", {
            birthDate: f.birthDate || null,
            sex: f.sex || null,
            heightCm: f.heightCm ? Number(f.heightCm) : null,
          });
          await refresh();
          setSaved(true);
          setTimeout(() => setSaved(false), 1500);
        }}
      >
        <label className="block text-sm text-ink-2">
          {t("auth.birthDate")}
          <input type="date" value={f.birthDate} onChange={(e) => setF({ ...f, birthDate: e.target.value })} className="mt-1 block h-11 w-full rounded-2xl border border-line bg-surface px-3 text-[16px] text-ink" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm text-ink-2">
            {t("auth.sex")}
            <select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })} className="mt-1 block h-11 w-full rounded-2xl border border-line bg-surface px-3 text-[16px] text-ink">
              <option value="">—</option>
              <option value="female">{t("auth.sex.female")}</option>
              <option value="male">{t("auth.sex.male")}</option>
              <option value="other">{t("auth.sex.other")}</option>
            </select>
          </label>
          <label className="block text-sm text-ink-2">
            {t("auth.height")}
            <input inputMode="numeric" value={f.heightCm} onChange={(e) => setF({ ...f, heightCm: e.target.value })} className="mt-1 block h-11 w-full rounded-2xl border border-line bg-surface px-3 text-[16px] text-ink" />
          </label>
        </div>
        <Button type="submit" size="sm">
          {saved ? t("common.saved") : t("common.save")}
        </Button>
      </form>
    </Card>
  );
}

/** Local mode: the free Gemini key lives on this phone and the in-app API reads it at start. */
function LocalAiKey() {
  const { t } = useI18n();
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void import("../local/runtime").then(async (m) => {
      const k = await m.getGeminiKey();
      setSaved(k);
      setKey(k);
    });
  }, []);
  async function save() {
    setBusy(true);
    const m = await import("../local/runtime");
    await m.setGeminiKey(key);
    await m.saveNow();
    window.location.reload(); // the in-app API reads its configuration once at start
  }
  return (
    <Card className="text-sm">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-ink-2">{saved ? t("profile.aiOn") : t("profile.aiHint")}</p>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="AIza…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label={t("profile.aiKey")}
            className="mt-3 h-11 w-full rounded-2xl border border-line bg-surface px-3 font-mono text-[14px]"
          />
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={busy} disabled={saved === null || key.trim() === (saved ?? "")} onClick={save}>
              {t("common.save")}
            </Button>
            <button type="button" onClick={() => void openExternal("https://aistudio.google.com/apikey")} className="inline-flex items-center px-2 text-gold">
              {t("profile.aiGet")}
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}
