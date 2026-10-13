import { NavLink, Outlet } from "react-router-dom";
import { Activity, CalendarDays, CircleUser, House, MessagesSquare, Sparkles, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../lib/i18n";
import { useSession } from "../lib/session";
import { EXPERT_ROLES } from "../../shared/metrics";
import { cx } from "./ui";

const MEMBER_TABS: { to: string; label: MessageKey; icon: typeof House }[] = [
  { to: "/", label: "nav.today", icon: House },
  { to: "/data", label: "nav.data", icon: Activity },
  { to: "/ai", label: "nav.ai", icon: Sparkles },
  { to: "/care", label: "nav.care", icon: MessagesSquare },
  { to: "/profile", label: "nav.profile", icon: CircleUser },
];

const EXPERT_TABS: typeof MEMBER_TABS = [
  { to: "/", label: "nav.schedule", icon: CalendarDays },
  { to: "/expert/clients", label: "nav.clients", icon: Users },
  { to: "/expert/messages", label: "nav.messages", icon: MessagesSquare },
  { to: "/profile", label: "nav.profile", icon: CircleUser },
];

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function AppShell() {
  const { t } = useI18n();
  const { me } = useSession();
  const online = useOnline();
  const tabs = me && EXPERT_ROLES.includes(me.role) ? EXPERT_TABS : MEMBER_TABS;
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      {!online && <div className="bg-gold-soft px-4 py-2 text-center text-xs text-gold">{t("common.offline")}</div>}
      <main className="pt-safe flex-1 px-4 pb-28">
        <Outlet />
      </main>
      <nav
        className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/85 backdrop-blur-xl"
        aria-label="Main"
      >
        <ul className="mx-auto flex max-w-xl">
          {tabs.map(({ to, label, icon: Icon }) => (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  cx("flex h-16 flex-col items-center justify-center gap-1 text-[11px] transition", isActive ? "text-gold" : "text-ink-3 hover:text-ink-2")
                }
              >
                <Icon className="size-[22px]" strokeWidth={1.75} aria-hidden />
                {t(label)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
