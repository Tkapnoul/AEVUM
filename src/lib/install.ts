import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
});

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** Android/desktop Chrome expose an install prompt; iOS needs manual "Add to Home Screen". */
export function useInstall() {
  const [canPrompt, setCanPrompt] = useState(Boolean(deferred));
  useEffect(() => {
    const on = () => setCanPrompt(true);
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  return {
    installed: isStandalone(),
    canPrompt,
    ios: isIos(),
    prompt: async () => {
      if (!deferred) return;
      await deferred.prompt();
      deferred = null;
      setCanPrompt(false);
    },
  };
}
