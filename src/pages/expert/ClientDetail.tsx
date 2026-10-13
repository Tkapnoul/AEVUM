import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { useFetch } from "../../lib/useFetch";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../lib/session";
import type { Summary } from "../../lib/types";
import { Button, Card, PageHeader, Segmented, Spinner, ErrorState } from "../../components/ui";
import { ScoreRing, PillarBar } from "../../components/ScoreRing";
import { DataPage } from "../Data";
import { SleepPage } from "../Sleep";
import { LabsPage } from "../Labs";
import { BioAgePage } from "../BioAge";

type Tab = "trends" | "sleep" | "labs" | "bio";

export function ClientDetail() {
  const { memberId } = useParams();
  const { t } = useI18n();
  const { me } = useSession();
  const [tab, setTab] = useState<Tab>("trends");
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
      <div className="no-scrollbar -mx-4 my-5 overflow-x-auto px-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "trends", label: t("nav.data") },
            { value: "sleep", label: t("data.sleep") },
            { value: "labs", label: t("data.labs") },
            { value: "bio", label: t("bio.title") },
          ]}
        />
      </div>
      {tab === "trends" && <DataPage member={memberId} />}
      {tab === "sleep" && <SleepPage member={memberId} />}
      {tab === "labs" && <LabsPage member={memberId} canEdit={me?.role === "doctor"} />}
      {tab === "bio" && <BioAgePage member={memberId} />}
    </>
  );
}
