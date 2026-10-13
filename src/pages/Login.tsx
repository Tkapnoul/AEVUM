import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { post, api, ApiError } from "../lib/api";
import { getServer, isLocal, isNative, LOCAL, localOnly, setServer, setToken, usesToken } from "../lib/native";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { Button, Field } from "../components/ui";
import { Brand } from "../components/Brand";
import { company } from "../../shared/company";

export function Login() {
  const { t, locale } = useI18n();
  const { refresh } = useSession();
  const nav = useNavigate();
  // In the app: everything on this phone (no server needed), or an AEVUM server shared with friends.
  const [mode, setMode] = useState<"local" | "server">(isLocal() ? "local" : "server");
  const [server, setServerInput] = useState(isLocal() ? "" : getServer());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isNative) {
        await setServer(mode === "local" ? LOCAL : server);
        if (mode === "server")
          await api("/health").catch(() => {
            throw new ApiError(0, "server");
          });
      }
      const res = await post<{ token?: string }>("/auth/login", { email, password, client: usesToken() ? "native" : "web" });
      if (usesToken() && res.token) await setToken(res.token);
      await refresh();
      nav("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "server" ? t("auth.serverError") : err instanceof ApiError && err.status === 401 ? t("auth.invalid") : t("common.error"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-safe mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10">
      <div className="flex flex-1 flex-col justify-center">
        <Brand />
        <p className="mt-3 font-display text-2xl leading-snug text-ink-2">{company.tagline[locale]}</p>
        <form onSubmit={submit} className="mt-10 space-y-4">
          {isNative && !localOnly && (
            <div role="radiogroup" aria-label={t("auth.where")} className="grid grid-cols-2 gap-1 rounded-2xl border border-line bg-surface p-1 text-sm">
              {(["local", "server"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={mode === m ? "rounded-xl bg-surface-2 py-2 font-medium text-ink" : "rounded-xl py-2 text-ink-2"}
                >
                  {t(m === "local" ? "auth.modeLocal" : "auth.modeServer")}
                </button>
              ))}
            </div>
          )}
          {isNative && mode === "local" && <p className="text-sm text-ink-2">{t("auth.modeLocalHint")}</p>}
          {isNative && mode === "server" && (
            <Field
              label={t("auth.server")}
              hint={t("auth.serverHint")}
              type="url"
              inputMode="url"
              autoCapitalize="none"
              required
              value={server}
              onChange={(e) => setServerInput(e.target.value)}
            />
          )}
          <Field label={t("auth.email")} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field
            label={t("auth.password")}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p className="text-sm text-coral" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" loading={busy}>
            {t("auth.login")}
          </Button>
        </form>
      </div>
      <p className="text-center text-sm text-ink-2">
        {t("auth.noAccount")}{" "}
        <Link
          to="/register"
          className="font-medium text-gold"
          onClick={async (e) => {
            // In the app, registration needs to know which server to create the account on.
            if (!isNative) return;
            e.preventDefault();
            if (mode === "server" && !server.trim()) return setError(t("auth.serverHint"));
            await setServer(mode === "local" ? LOCAL : server);
            nav("/register");
          }}
        >
          {t("auth.register")}
        </Link>
      </p>
    </div>
  );
}
