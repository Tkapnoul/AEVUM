import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { post, ApiError } from "../lib/api";
import { getServer, isNative, setToken } from "../lib/native";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { Button, Field, cx } from "../components/ui";
import { Brand } from "../components/Brand";
import { company } from "../../shared/company";

type Step = 0 | 1 | 2;

export function Register() {
  const { t, locale } = useI18n();
  const { refresh } = useSession();
  const nav = useNavigate();
  const [step, setStep] = useState<Step>(0);
  const [f, setF] = useState({ name: "", email: "", password: "", birthDate: "", sex: "", heightCm: "", goals: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (step < 2) return setStep((step + 1) as Step);
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ token?: string }>("/auth/register", {
        name: f.name,
        email: f.email,
        password: f.password,
        locale,
        birthDate: f.birthDate || undefined,
        sex: f.sex || undefined,
        heightCm: f.heightCm ? Number(f.heightCm) : undefined,
        goals: f.goals,
        client: isNative ? "native" : "web",
      });
      if (isNative && res.token) await setToken(res.token);
      await refresh();
      nav("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "email_taken") {
        setError(t("auth.emailTaken"));
        setStep(0);
      } else setError(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const steps = [t("auth.step.account"), t("auth.step.about"), t("auth.step.goals")];
  // In the app, the server address is chosen on the login screen first.
  if (isNative && !getServer()) return <Navigate to="/login" replace />;

  return (
    <div className="pt-safe mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-10">
      <div className="pt-6">
        <Brand />
      </div>
      <ol className="mt-8 flex gap-2" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={cx("h-1 rounded-full", i <= step ? "bg-gold" : "bg-line")} />
            <span className={cx("mt-2 block text-xs", i === step ? "text-ink" : "text-ink-3")}>{s}</span>
          </li>
        ))}
      </ol>

      <form onSubmit={submit} className="mt-8 flex flex-1 flex-col">
        <div className="flex-1 space-y-4">
          {step === 0 && (
            <>
              <Field label={t("auth.name")} required autoComplete="name" value={f.name} onChange={(e) => set("name", e.target.value)} />
              <Field label={t("auth.email")} type="email" required autoComplete="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
              <Field
                label={t("auth.password")}
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                hint={t("auth.passwordHint")}
                value={f.password}
                onChange={(e) => set("password", e.target.value)}
              />
            </>
          )}
          {step === 1 && (
            <>
              <Field label={t("auth.birthDate")} type="date" value={f.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
              <fieldset>
                <legend className="mb-1.5 text-sm text-ink-2">{t("auth.sex")}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {(["female", "male", "other"] as const).map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => set("sex", s)}
                      aria-pressed={f.sex === s}
                      className={cx("h-12 rounded-2xl border text-sm", f.sex === s ? "border-gold bg-gold-soft text-ink" : "border-line bg-surface text-ink-2")}
                    >
                      {t(`auth.sex.${s}`)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <Field label={t("auth.height")} type="number" inputMode="numeric" min={100} max={250} value={f.heightCm} onChange={(e) => set("heightCm", e.target.value)} />
            </>
          )}
          {step === 2 && (
            <>
              <div>
                <h2 className="font-display text-2xl">{t("auth.goalsTitle")}</h2>
                <p className="mt-1 text-sm text-ink-2">{t("auth.goalsHint")}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {company.goals.map((g) => {
                  const on = f.goals.includes(g.key);
                  return (
                    <button
                      type="button"
                      key={g.key}
                      aria-pressed={on}
                      onClick={() => set("goals", on ? f.goals.filter((x) => x !== g.key) : [...f.goals, g.key])}
                      className={cx(
                        "flex min-h-14 items-center justify-between gap-2 rounded-2xl border px-4 text-left text-sm",
                        on ? "border-gold bg-gold-soft text-ink" : "border-line bg-surface text-ink-2",
                      )}
                    >
                      {g.label[locale]}
                      {on && <Check className="size-4 text-gold" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {error && (
            <p className="text-sm text-coral" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="mt-8 flex gap-3">
          {step > 0 && (
            <Button type="button" variant="secondary" onClick={() => setStep((step - 1) as Step)}>
              {t("common.back")}
            </Button>
          )}
          <Button type="submit" className="flex-1" loading={busy}>
            {step < 2 ? t("common.continue") : t("auth.create")}
          </Button>
        </div>
      </form>
      <p className="mt-6 text-center text-sm text-ink-2">
        {t("auth.haveAccount")}{" "}
        <Link to="/login" className="font-medium text-gold">
          {t("auth.login")}
        </Link>
      </p>
    </div>
  );
}
