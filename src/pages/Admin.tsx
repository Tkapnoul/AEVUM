import { useFetch } from "../lib/useFetch";
import { useI18n } from "../lib/i18n";
import { useSession } from "../lib/session";
import { patch } from "../lib/api";
import { timeAgo } from "../lib/format";
import { Avatar, Card, ErrorState, PageHeader, Spinner } from "../components/ui";

interface U {
  id: string;
  name: string;
  email: string;
  role: string;
  is_admin: number;
  last_sync: number | null;
}

const ROLES = ["member", "coach", "doctor", "nutritionist", "physio"] as const;

export function Admin() {
  const { t, locale } = useI18n();
  const { me, refresh } = useSession();
  const res = useFetch<{ users: U[] }>("/admin/users");
  if (res.loading && !res.data) return <Spinner />;
  if (res.error || !res.data) return <ErrorState onRetry={res.reload} />;

  async function change(id: string, body: { role?: string; isAdmin?: boolean }) {
    await patch(`/admin/users/${id}`, body);
    await res.reload();
    if (id === me?.id) await refresh();
  }

  return (
    <>
      <PageHeader title={t("admin.title")} subtitle={t("admin.hint")} back="/profile" />
      <div className="space-y-3">
        {res.data.users.map((u) => (
          <Card key={u.id} className="p-4">
            <div className="flex items-center gap-3">
              <Avatar name={u.name} role={u.role} size={40} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{u.name}</p>
                <p className="truncate text-xs text-ink-3">
                  {u.email}
                  {u.last_sync ? ` · ${timeAgo(u.last_sync, locale)}` : ""}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <select
                value={u.role}
                aria-label="role"
                onChange={(e) => void change(u.id, { role: e.target.value })}
                className="h-10 flex-1 rounded-xl border border-line bg-surface px-2 text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`role.${r}`)}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input
                  type="checkbox"
                  checked={Boolean(u.is_admin)}
                  disabled={u.id === me?.id}
                  onChange={(e) => void change(u.id, { isAdmin: e.target.checked })}
                  className="size-4 accent-[var(--gold)]"
                />
                {t("admin.admin")}
              </label>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
