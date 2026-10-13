import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Download, LogOut, Smartphone, Watch } from "lucide-react";
import { useFetch } from "../lib/useFetch";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { del, patch } from "../lib/api";
import { applyTheme, getTheme, type ThemePref } from "../lib/theme";
import { useInstall } from "../lib/install";
import { timeAgo } from "../lib/format";
import type { Device } from "../lib/types";
import { Avatar, Button, Card, PageHeader, SectionTitle, Segmented } from "../components/ui";
import { company, type Locale } from "../../shared/company";

const FUTURE_DEVICES = ["Apple Health", "Health Connect (Android)", "Garmin", "Oura", "Withings"];

export function Profile({ onLocale }: { onLocale: (l: Locale) => void }) {
  const { t, locale } = useI18n();
  const { me, logout, refresh } = useSession();
  const devices = useFetch<{ devices: Device[] }>(me?.role === "member" ? "/devices" : null);
  const [theme, setTheme] = useState<ThemePref>(getTheme());
  const install = useInstall();
  if (!me) return null;
  const isMember = me.role === "member";
  const bip = devices.data?.devices.find((d) => d.kind === "amazfit_bip6");

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
          <Card className="divide-y divide-line p-0">
            <Link to="/devices/bip6" className="flex items-center gap-4 px-5 py-4">
              <Watch className="size-5 text-gold" aria-hidden />
              <div className="flex-1">
                <p className="font-medium">Amazfit Bip 6</p>
                <p className="text-xs text-ink-3">
                  {bip ? `${t("device.connected")} · ${t("today.lastSync")} ${bip.last_sync_at ? timeAgo(bip.last_sync_at, locale) : t("device.never")}` : t("profile.connect")}
                </p>
              </div>
              <ChevronRight className="size-5 text-ink-3" aria-hidden />
            </Link>
            {FUTURE_DEVICES.map((d) => (
              <div key={d} className="flex items-center gap-4 px-5 py-3.5 text-ink-3">
                <Watch className="size-5" aria-hidden />
                <span className="flex-1 text-sm">{d}</span>
                <span className="text-xs">{t("profile.comingSoon")}</span>
              </div>
            ))}
          </Card>
        </>
      )}

      {!isMember && (
        <Link to="/expert/availability" className="mt-3 block">
          <Card className="flex items-center justify-between p-4">
            <span className="font-medium">{t("expert.availability")}</span>
            <ChevronRight className="size-5 text-ink-3" aria-hidden />
          </Card>
        </Link>
      )}

      <SectionTitle>{t("profile.install")}</SectionTitle>
      <Card className="flex items-start gap-4">
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
        <a href="/api/auth/me/export" className="flex items-center gap-4 px-5 py-4 text-sm">
          <Download className="size-5 text-ink-2" aria-hidden /> {t("profile.export")}
        </a>
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
