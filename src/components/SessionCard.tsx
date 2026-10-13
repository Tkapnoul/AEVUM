import { Link } from "react-router-dom";
import { Video } from "lucide-react";
import type { Booking } from "../lib/types";
import { useI18n } from "../lib/i18n";
import { Avatar, Button } from "./ui";

const JOIN_WINDOW_MS = 10 * 60_000;

export const canJoin = (b: Booking, now = Date.now()) => b.status === "booked" && now >= b.starts_at - JOIN_WINDOW_MS && now <= b.ends_at;

export function SessionCard({ booking, viewAs = "member" }: { booking: Booking; viewAs?: "member" | "expert" }) {
  const { t, fmtDate } = useI18n();
  const name = viewAs === "member" ? booking.expert_name : booking.member_name;
  const role = viewAs === "member" ? booking.expert_role : "member";
  const joinable = canJoin(booking);
  return (
    <div className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-4">
      <Link to={`/care/session/${booking.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={name} role={role} />
        <div className="min-w-0">
          <p className="truncate font-medium">{name}</p>
          <p className="truncate text-sm text-ink-2">
            {fmtDate(booking.starts_at, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
            {booking.topic ? ` · ${booking.topic}` : ""}
          </p>
        </div>
      </Link>
      {joinable && (
        <a href={booking.room_url} target="_blank" rel="noopener noreferrer">
          <Button size="sm">
            <Video className="size-4" aria-hidden /> {t("care.join")}
          </Button>
        </a>
      )}
    </div>
  );
}
