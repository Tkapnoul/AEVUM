import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import { applyTheme, getTheme } from "./lib/theme";
import { isNative, loadNativeState } from "./lib/native";
import "./styles.css";

applyTheme(getTheme());
// The native app ships its assets inside the APK/IPA; a service worker only matters for the PWA.
if (!isNative && import.meta.env.VITE_EMBED !== "1") registerSW({ immediate: true });

await loadNativeState();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
