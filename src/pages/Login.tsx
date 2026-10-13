import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { post, api, ApiError } from "../lib/api";
import { getServer, isNative, setServer, setToken } from "../lib/native";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { Button, Field } from "../components/ui";
import { Brand } from "../components/Brand";
import { company } from "../../shared/company";

export function Login() {
  const { t, locale } = useI18n();
  const { refresh } = useSession();
  const nav = useNavigate();
  const [server, setServerInput] = useState(getServer());
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
        await setServer(server);
        await api("/health").catch(() => {
          throw new ApiError(0, "server");
        });
      }
      const res = await post<{ token?: string }>("/auth/login", { email, password, client: isNative ? "native" : "web" });
      if (isNative && res.token) await setToken(res.token);
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
          {isNative && (
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
        <Link to="/register" className="font-medium text-gold">
          {t("auth.register")}
        </Link>
      </p>
    </div>
  );
}
