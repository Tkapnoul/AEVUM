import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CheckCircle2, MessageCircle, Video } from "lucide-react";
import { useFetch } from "../lib/useFetch";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { post } from "../lib/api";
import type { BookingDetail } from "../lib/types";
import { Avatar, Button, Card, ErrorState, PageHeader, SectionTitle, Spinner, cx } from "../components/ui";
import { canJoin } from "../components/SessionCard";
import { openExternal } from "../lib/native";

export function SessionPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { t, fmtDate } = useI18n();
  const { me } = useSession();
  const nav = useNavigate();
  const res = useFetch<BookingDetail>(`/care/bookings/${id}`, { pollMs: 30_000 });
  const [busy, setBusy] = useState(false);

  if (res.loading && !res.data) return <Spinner />;
  if (res.error || !res.data) return <ErrorState onRetry={res.reload} />;
  const b = res.data;
  const isExpert = me?.id === b.expert_id;
  const other = isExpert ? { name: b.member_name, role: "member", id: b.member_id } : { name: b.expert_name, role: b.expert_role, id: b.expert_id };
  const joinable = canJoin(b);

  return (
    <>
      <PageHeader title={b.topic || t("today.nextSession")} back={isExpert ? "/" : "/care"} />
      {search.get("booked") && (
        <p className="mb-4 flex items-center gap-2 rounded-2xl bg-sage-soft px-4 py-3 text-sm text-sage">
          <CheckCircle2 className="size-4" aria-hidden /> {t("care.booked")}
        </p>
      )}
      <Card>
        <div className="flex items-center gap-3">
          <Avatar name={other.name} role={other.role} size={52} />
          <div>
            <p className="font-medium">{other.name}</p>
            <p className="text-sm text-ink-2">{isExpert ? t("role.member") : b.expert_title || t(`role.${b.expert_role}`)}</p>
          </div>
          <span
            className={cx(
              "ml-auto rounded-full px-3 py-1 text-xs",
              b.status === "booked" ? "bg-gold-soft text-gold" : b.status === "completed" ? "bg-sage-soft text-sage" : "bg-surface-2 text-ink-3",
            )}
          >
            {t(`care.status.${b.status}`)}
          </span>
        </div>
        <p className="mt-4 font-display text-2xl capitalize">{fmtDate(b.starts_at, { weekday: "long", day: "numeric", month: "long" })}</p>
        <p className="text-ink-2 tabular">
          {fmtDate(b.starts_at, { hour: "2-digit", minute: "2-digit" })} – {fmtDate(b.ends_at, { hour: "2-digit", minute: "2-digit" })}
        </p>

        {b.status === "booked" && (
          <div className="mt-5 space-y-2">
            <Button className="w-full" disabled={!joinable} onClick={() => void openExternal(b.room_url)}>
              <Video className="size-5" aria-hidden /> {joinable ? t("care.join") : t("care.joinSoon")}
            </Button>
            <p className="text-center text-xs text-ink-3">{t("care.videoNote")}</p>
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Link to={isExpert ? `/expert/clients/${other.id}` : `/care/chat/${other.id}`} className="flex-1">
            <Button variant="secondary" size="sm" className="w-full">
              <MessageCircle className="size-4" aria-hidden /> {isExpert ? t("nav.data") : t("care.message")}
            </Button>
          </Link>
          {b.status === "booked" && b.starts_at > Date.now() && (
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              onClick={async () => {
                if (!confirm(t("care.cancelConfirm"))) return;
                setBusy(true);
                await post(`/care/bookings/${b.id}/cancel`).finally(() => setBusy(false));
                nav(isExpert ? "/" : "/care");
              }}
            >
              {t("care.cancelSession")}
            </Button>
          )}
        </div>
      </Card>

      <SectionTitle>{t("care.notes")}</SectionTitle>
      {b.notes.length === 0 ? (
        <p className="px-1 text-sm text-ink-3">{t("care.noNotes")}</p>
      ) : (
        <div className="space-y-3">
          {b.notes.map((n) => (
            <Card key={n.id} className="p-4">
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{n.content}</p>
              <p className="mt-2 text-xs text-ink-3">
                {n.author_name} · {fmtDate(n.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {isExpert && !n.visible_to_member && " · 🔒"}
              </p>
            </Card>
          ))}
        </div>
      )}
      {isExpert && <NoteForm bookingId={b.id} onSaved={res.reload} />}
    </>
  );
}

function NoteForm({ bookingId, onSaved }: { bookingId: string; onSaved: () => void }) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="mt-3">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await post(`/care/bookings/${bookingId}/notes`, { content, visibleToMember: visible }).finally(() => setBusy(false));
          setContent("");
          onSaved();
        }}
      >
        <label className="mb-2 block text-sm text-ink-2" htmlFor="note">
          {t("expert.addNote")}
        </label>
        <textarea
          id="note"
          required
          rows={4}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full rounded-2xl border border-line bg-surface p-3 text-[15px] outline-none focus:border-gold"
        />
        <div className="mt-3 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="size-4 accent-[var(--gold)]" />
            {t("expert.visibleToMember")}
          </label>
          <Button type="submit" size="sm" loading={busy}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
