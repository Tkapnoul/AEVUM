import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { BrowserRouter, MemoryRouter, Navigate, Route, Routes } from "react-router-dom";

// Embedded in a sandboxed viewer (VITE_EMBED=1, e.g. a claude.ai artifact) the page URL isn't ours to route on.
const Router = import.meta.env.VITE_EMBED === "1" ? MemoryRouter : BrowserRouter;
import { I18nProvider, detectLocale } from "./lib/i18n";
import { SessionProvider, useSession } from "./lib/session";
import { AppShell } from "./components/AppShell";
import { Spinner } from "./components/ui";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { Today } from "./pages/Today";
import { SleepPage } from "./pages/Sleep";
import { LabsPage } from "./pages/Labs";
import { Care } from "./pages/Care";
import { Book } from "./pages/Book";
import { SessionPage } from "./pages/Session";
import { Chat } from "./pages/Chat";
import { Ai } from "./pages/Ai";
import { Profile } from "./pages/Profile";
import { ConnectBip6 } from "./pages/ConnectBip6";
import { Devices } from "./pages/Devices";
import { BioAgePage } from "./pages/BioAge";
import { Admin } from "./pages/Admin";
import { useNativeAutoSync } from "./lib/useNativeAutoSync";
import { ExpertHome } from "./pages/expert/ExpertHome";
import { Clients } from "./pages/expert/Clients";
import { ExpertMessages } from "./pages/expert/Messages";
import { Availability } from "./pages/expert/Availability";
import { EXPERT_ROLES } from "../shared/metrics";
import type { Locale } from "../shared/company";

// Charts (recharts) are the heaviest dependency; load them only on screens that draw them.
const DataPage = lazy(() => import("./pages/Data").then((m) => ({ default: m.DataPage })));
const ClientDetail = lazy(() => import("./pages/expert/ClientDetail").then((m) => ({ default: m.ClientDetail })));

function Routed({ onLocale }: { onLocale: (l: Locale) => void }) {
  const { me, loading } = useSession();
  // First login on a device: follow the language saved on the account.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("aevum.locale");
    } catch {
      /* storage unavailable */
    }
    if (me && !saved) onLocale(me.locale);
  }, [me, onLocale]);
  useNativeAutoSync(me?.role === "member");
  if (loading) return <Spinner />;
  if (!me)
    return (
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  const expert = EXPERT_ROLES.includes(me.role);
  return (
    <Routes>
      <Route element={<AppShell />}>
        {expert ? (
          <>
            <Route index element={<ExpertHome />} />
            <Route path="expert/clients" element={<Clients />} />
            <Route path="expert/clients/:memberId" element={<ClientDetail />} />
            <Route path="expert/clients/:memberId/data/:metric" element={<ClientDetail />} />
            <Route path="expert/messages" element={<ExpertMessages />} />
            <Route path="expert/messages/:otherId" element={<Chat backTo="/expert/messages" />} />
            <Route path="expert/availability" element={<Availability />} />
          </>
        ) : (
          <>
            <Route index element={<Today />} />
            <Route path="data" element={<DataPage />} />
            <Route path="data/sleep-detail" element={<SleepPage />} />
            <Route path="data/sleep" element={<SleepPage />} />
            <Route path="data/labs" element={<LabsPage />} />
            <Route path="data/:metric" element={<DataPage />} />
            <Route path="care" element={<Care />} />
            <Route path="care/book/:expertId" element={<Book />} />
            <Route path="care/chat/:otherId" element={<Chat />} />
            <Route path="ai" element={<Ai />} />
            <Route path="devices" element={<Devices />} />
            <Route path="devices/bip6" element={<ConnectBip6 />} />
            <Route path="bioage" element={<BioAgePage />} />
          </>
        )}
        <Route path="care/session/:id" element={<SessionPage />} />
        {Boolean(me.is_admin) && <Route path="admin" element={<Admin />} />}
        <Route path="profile" element={<Profile onLocale={onLocale} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  const [locale, setLocale] = useState<Locale>(detectLocale());
  const changeLocale = useCallback((l: Locale) => {
    setLocale(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem("aevum.locale", l);
    } catch {
      /* storage unavailable */
    }
  }, []);
  return (
    <I18nProvider locale={locale}>
      <SessionProvider>
        <Router basename={import.meta.env.VITE_EMBED === "1" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Suspense fallback={<Spinner />}>
            <Routed onLocale={changeLocale} />
          </Suspense>
        </Router>
      </SessionProvider>
    </I18nProvider>
  );
}
