import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MessageCircle, Plus } from "lucide-react";
import { useFetch } from "../../lib/useFetch";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import { post } from "../../lib/api";
import type { Summary } from "../../lib/types";
import { Button, Card, Field, PageHeader, Segmented, Spinner, ErrorState } from "../../components/ui";
import { ScoreRing, PillarBar } from "../../components/ScoreRing";
import { DataPage } from "../Data";
import { SleepPage } from "../Sleep";
import { LabsPage } from "../Labs";

type Tab = "trends" | "sleep" | "labs";

export function ClientDetail() {
  const { memberId } = useParams();
  const { t } = useI18n();
  const { me } = useSession();
  const [tab, setTab] = useState<Tab>("trends");
  const [labsKey, setLabsKey] = useState(0);
  const summary = useFetch<Summary>(`/metrics/summary?member=${memberId}`);
  const clients = useFetch<{ clients: { id: string; name: string }[] }>("/expert/clients");
  const name = clients.data?.clients.find((c) => c.id === memberId)?.name ?? "";

  if (summary.loading && !summary.data) return <Spinner />;
  if (summary.error || !summary.data) return <ErrorState onRetry={summary.reload} />;
  const s = summary.data;

  return (
    <>
      <PageHeader
        title={name}
        back="/expert/clients"
        action={
          <Link to={`/expert/messages/${memberId}`}>
            <Button size="sm" variant="secondary">
              <MessageCircle className="size-4" aria-hidden /> {t("care.message")}
            </Button>
          </Link>
        }
      />
      <Card className="flex items-center gap-5">
        <ScoreRing score={s.score.score} size={110} />
        <div className="flex-1 space-y-2.5">
          {s.score.components.map((c) => (
            <PillarBar key={c.key} label={t(`pillar.${c.key}`)} score={c.score} />
          ))}
        </div>
      </Card>
      <div className="my-5">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "trends", label: t("nav.data") },
            { value: "sleep", label: t("data.sleep") },
            { value: "labs", label: t("data.labs") },
          ]}
        />
      </div>
      {tab === "trends" && <DataPage member={memberId} />}
      {tab === "sleep" && <SleepPage member={memberId} />}
      {tab === "labs" && (
        <LabsPage
          key={labsKey}
          member={memberId}
          onAdd={me?.role === "doctor" ? <AddLab memberId={memberId!} onSaved={() => setLabsKey((k) => k + 1)} /> : undefined}
        />
      )}
    </>
  );
}

function AddLab({ memberId, onSaved }: { memberId: string; onSaved: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ marker: "", value: "", unit: "", refLow: "", refHigh: "", takenAt: new Date().toISOString().slice(0, 10), note: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  if (!open)
    return (
      <Button variant="secondary" size="sm" className="mb-4" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> {t("expert.addLab")}
      </Button>
    );
  return (
    <Card className="mb-4">
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post(`/metrics/labs?member=${memberId}`, {
              marker: f.marker,
              value: Number(f.value),
              unit: f.unit,
              refLow: f.refLow ? Number(f.refLow) : null,
              refHigh: f.refHigh ? Number(f.refHigh) : null,
              takenAt: f.takenAt,
              note: f.note,
            });
            setOpen(false);
            onSaved();
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="col-span-2">
          <Field label={t("expert.marker")} required value={f.marker} onChange={set("marker")} />
        </div>
        <Field label={t("expert.value")} type="number" step="any" required value={f.value} onChange={set("value")} />
        <Field label={t("expert.unit")} required value={f.unit} onChange={set("unit")} />
        <Field label={t("expert.refLow")} type="number" step="any" value={f.refLow} onChange={set("refLow")} />
        <Field label={t("expert.refHigh")} type="number" step="any" value={f.refHigh} onChange={set("refHigh")} />
        <div className="col-span-2">
          <Field label={t("expert.date")} type="date" required value={f.takenAt} onChange={set("takenAt")} />
        </div>
        <div className="col-span-2 flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="sm" loading={busy}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
