import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { initials } from "../lib/format";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ children, className, as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" }) {
  // Callers that pass their own padding (p-0, p-4…) replace the default.
  const padded = !/(^|\s)p-\d/.test(className ?? "");
  return <As className={cx("rounded-3xl border border-line bg-surface", padded && "p-5", className)}>{children}</As>;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition active:scale-[0.98] disabled:opacity-50",
        size === "md" ? "h-12 px-6 text-[15px]" : "h-9 px-4 text-sm",
        variant === "primary" && "bg-gold text-[#16170f] hover:brightness-105",
        variant === "secondary" && "border border-line bg-surface-2 text-ink hover:bg-line/60",
        variant === "ghost" && "text-ink-2 hover:text-ink",
        variant === "danger" && "border border-coral/40 text-coral hover:bg-coral-soft",
        className,
      )}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm text-ink-2">{label}</span>
      <input
        {...rest}
        className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[16px] text-ink outline-none transition placeholder:text-ink-3 focus:border-gold"
      />
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function PageHeader({ title, subtitle, back, action }: { title: string; subtitle?: string; back?: string; action?: ReactNode }) {
  const { t } = useI18n();
  return (
    <header className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link to={back} className="-ml-1 mb-2 inline-flex items-center text-sm text-ink-2 hover:text-ink">
            <ChevronLeft className="size-4" aria-hidden /> {t("common.back")}
          </Link>
        )}
        <h1 className="font-display text-[30px] leading-tight font-medium tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-7 mb-3 flex items-center justify-between">
      <h2 className="text-[13px] font-semibold tracking-[0.08em] text-ink-3 uppercase">{children}</h2>
      {action}
    </div>
  );
}

export function Spinner() {
  const { t } = useI18n();
  return (
    <div className="flex justify-center py-10 text-ink-3" role="status">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <Card className="text-center text-sm text-ink-2">
      <p>{t("common.error")}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </Card>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-3xl border border-dashed border-line px-5 py-6 text-center text-sm text-ink-3">{children}</p>;
}

const ROLE_TINT: Record<string, string> = {
  coach: "bg-sage-soft text-sage",
  doctor: "bg-gold-soft text-gold",
  nutritionist: "bg-coral-soft text-coral",
  physio: "bg-surface-2 text-sky",
  member: "bg-surface-2 text-ink-2",
};

export function Avatar({ name, role, size = 44 }: { name: string; role?: string; size?: number }) {
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-display font-medium", ROLE_TINT[role ?? "member"])}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-full border border-line bg-surface p-1" role="tablist">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx("h-8 rounded-full px-3.5 text-sm transition", o.value === value ? "bg-ink text-bg" : "text-ink-2 hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
