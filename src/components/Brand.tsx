import { company } from "../../shared/company";

export function Mark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path d="M44.9 16.7A20 20 0 1 1 19.1 16.7" fill="none" stroke="var(--gold)" strokeWidth="5" />
      <circle cx="32" cy="12" r="3.6" fill="var(--ink)" />
      <circle cx="32" cy="32" r="4.6" fill="var(--gold)" />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-3">
      <Mark size={44} />
      <span className="font-display text-[34px] font-medium tracking-[0.18em]">{company.name}</span>
    </div>
  );
}
