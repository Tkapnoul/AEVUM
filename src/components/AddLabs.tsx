import { useRef, useState } from "react";
import { Camera, PenLine, Plus, Trash2 } from "lucide-react";
import { useI18n } from "../lib/i18n";
import { apiFetch, post } from "../lib/api";
import { Button, Card, cx } from "./ui";
import { LABS, labDef, type LabKey } from "../../shared/labs";

interface Row {
  markerKey: LabKey | null;
  marker: string;
  value: string;
  unit: string;
  refLow: string;
  refHigh: string;
}

const emptyRow = (): Row => ({ markerKey: null, marker: "", value: "", unit: "", refLow: "", refHigh: "" });
const today = () => new Date().toISOString().slice(0, 10);
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

/** Add lab results from a photo/PDF (AI extraction, then review) or by hand. */
export function AddLabs({ member, onSaved }: { member?: string; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const file = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [takenAt, setTakenAt] = useState(today());
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = member ? `?member=${member}` : "";

  async function extract(f: File) {
    setError(null);
    setReading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await apiFetch(`/labs/extract${q}`, { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      const out = (await res.json()) as { takenAt: string | null; results: { markerKey: LabKey | null; marker: string; value: number; unit: string; refLow: number | null; refHigh: number | null }[] };
      if (!out.results.length) throw new Error();
      if (out.takenAt) setTakenAt(out.takenAt);
      setRows(
        out.results.map((r) => ({
          markerKey: r.markerKey,
          marker: r.marker,
          value: String(r.value),
          unit: r.unit,
          refLow: r.refLow == null ? "" : String(r.refLow),
          refHigh: r.refHigh == null ? "" : String(r.refHigh),
        })),
      );
    } catch {
      setError(t("labs.readFailed"));
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!rows) return;
    const results = rows
      .filter((r) => r.value.trim() !== "" && (r.markerKey || r.marker.trim()))
      .map((r) => ({
        markerKey: r.markerKey,
        marker: r.marker.trim() || labDef(r.markerKey!)!.name[locale],
        value: Number(r.value.replace(",", ".")),
        unit: r.unit.trim() || (r.markerKey ? labDef(r.markerKey)!.unit : ""),
        refLow: numOrNull(r.refLow),
        refHigh: numOrNull(r.refHigh),
      }))
      .filter((r) => Number.isFinite(r.value));
    if (!results.length) return;
    setSaving(true);
    try {
      await post(`/labs/batch${q}`, { takenAt, results });
      setRows(null);
      onSaved();
    } catch {
      setError(t("common.error"));
    } finally {
      setSaving(false);
    }
  }

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (!rows)
    return (
      <Card className="mb-4">
        <p className="font-medium">{t("labs.add")}</p>
        <p className="mt-1 text-sm text-ink-2">{t("labs.uploadHint")}</p>
        <input
          ref={file}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void extract(f);
          }}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" loading={reading} onClick={() => file.current?.click()}>
            <Camera className="size-4" aria-hidden /> {reading ? t("labs.reading") : t("labs.upload")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setRows([emptyRow()])}>
            <PenLine className="size-4" aria-hidden /> {t("labs.manual")}
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-coral">{error}</p>}
      </Card>
    );

  return (
    <Card className="mb-4">
      <p className="font-medium">{t("labs.review")}</p>
      <label className="mt-3 block text-sm text-ink-2">
        {t("labs.takenAt")}
        <input type="date" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} className="mt-1 block h-11 w-full rounded-2xl border border-line bg-surface px-3 text-[16px]" />
      </label>
      <div className="mt-4 space-y-3">
        {rows.map((r, i) => {
          const def = r.markerKey ? labDef(r.markerKey) : null;
          const units = def ? [def.unit, ...Object.keys(def.alt ?? {})] : [];
          return (
            <div key={i} className="rounded-2xl border border-line p-3">
              <div className="flex gap-2">
                <select
                  aria-label={t("labs.pick")}
                  value={r.markerKey ?? ""}
                  onChange={(e) => {
                    const key = (e.target.value || null) as LabKey | null;
                    update(i, { markerKey: key, unit: key && !r.unit ? labDef(key)!.unit : r.unit });
                  }}
                  className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-2 text-sm"
                >
                  <option value="">{t("labs.other")}</option>
                  {LABS.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.name[locale]}
                    </option>
                  ))}
                </select>
                <button aria-label={t("labs.remove")} className="p-2 text-ink-3 hover:text-coral" onClick={() => setRows((rs) => rs!.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
              {(!r.markerKey || r.marker) && (
                <input
                  value={r.marker}
                  placeholder={t("expert.marker")}
                  onChange={(e) => update(i, { marker: e.target.value })}
                  className={cx("mt-2 h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm", r.markerKey && "text-ink-3")}
                />
              )}
              <div className="mt-2 grid grid-cols-4 gap-2">
                <input inputMode="decimal" value={r.value} placeholder={t("expert.value")} onChange={(e) => update(i, { value: e.target.value })} className="col-span-2 h-10 rounded-xl border border-line bg-surface px-3 text-[16px] tabular" />
                {units.length ? (
                  <select value={r.unit} onChange={(e) => update(i, { unit: e.target.value })} className="col-span-2 h-10 rounded-xl border border-line bg-surface px-2 text-sm">
                    {!units.includes(r.unit) && r.unit && <option value={r.unit}>{r.unit}</option>}
                    {units.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                ) : (
                  <input value={r.unit} placeholder={t("expert.unit")} onChange={(e) => update(i, { unit: e.target.value })} className="col-span-2 h-10 rounded-xl border border-line bg-surface px-3 text-sm" />
                )}
                <input inputMode="decimal" value={r.refLow} placeholder={t("expert.refLow")} onChange={(e) => update(i, { refLow: e.target.value })} className="col-span-2 h-9 rounded-xl border border-line bg-surface px-3 text-xs" />
                <input inputMode="decimal" value={r.refHigh} placeholder={t("expert.refHigh")} onChange={(e) => update(i, { refHigh: e.target.value })} className="col-span-2 h-9 rounded-xl border border-line bg-surface px-3 text-xs" />
              </div>
            </div>
          );
        })}
      </div>
      <button className="mt-3 inline-flex items-center gap-1 text-sm text-gold" onClick={() => setRows((rs) => [...rs!, emptyRow()])}>
        <Plus className="size-4" aria-hidden /> {t("labs.addRow")}
      </button>
      {error && <p className="mt-3 text-sm text-coral">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => setRows(null)}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" className="flex-1" loading={saving} onClick={save}>
          {t("labs.saveAll", { n: rows.filter((r) => r.value.trim()).length })}
        </Button>
      </div>
    </Card>
  );
}
