/** Circular 0–100 gauge. `null` renders an empty track. */
export function ScoreRing({ score, size = 132, stroke = 10 }: { score: number | null; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={score == null ? "—" : `${score}/100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--gold)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 700ms ease" }}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-ink font-display tabular" fontSize={size * 0.3} fontWeight={500}>
        {score ?? "—"}
      </text>
    </svg>
  );
}

export function PillarBar({ label, score }: { label: string; score: number | null }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-ink-2">{label}</span>
        <span className="tabular text-ink">{score ?? "—"}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-gold transition-[width] duration-700" style={{ width: `${score ?? 0}%` }} />
      </div>
    </div>
  );
}
