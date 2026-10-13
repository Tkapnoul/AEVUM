import { useEffect } from "react";
import { App } from "@capacitor/app";
import { isNative } from "./native";

const MIN_INTERVAL = 30 * 60_000;

/**
 * In the native app, sync Apple Health / Health Connect when the app opens or returns to
 * the foreground (at most every 30 min), once the member has connected it the first time.
 */
export function useNativeAutoSync(enabled: boolean) {
  useEffect(() => {
    if (!isNative || !enabled) return;
    let running = false;
    const maybeSync = async () => {
      if (running) return;
      const hs = await import("./healthSync");
      const last = await hs.lastHealthSync();
      if (!last || Date.now() - last < MIN_INTERVAL) return;
      running = true;
      try {
        await hs.syncHealth();
      } catch (e) {
        console.warn("[health] background sync failed", e);
      } finally {
        running = false;
      }
    };
    void maybeSync();
    const sub = App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) void maybeSync();
    });
    return () => {
      void sub.then((h) => h.remove());
    };
  }, [enabled]);
}
