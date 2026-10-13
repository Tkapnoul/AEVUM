import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Browser } from "@capacitor/browser";

/** True inside the Android/iOS app; false in the browser/PWA. */
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform() as "ios" | "android" | "web";

// Values cached in memory so every API call doesn't hit async storage.
let serverUrl = "";
let token: string | null = null;

/** Server value meaning "everything runs inside this app" (see src/local/runtime.ts). */
export const LOCAL = "local";

// Local mode can also be switched on in a desktop browser (localStorage "aevum_local" = "1"), which is how
// it is exercised in automated browser tests; real users get it in the phone app.
const webLocal = !isNative && typeof localStorage !== "undefined" && localStorage.getItem("aevum_local") === "1";

export async function loadNativeState() {
  if (webLocal) {
    serverUrl = LOCAL;
    token = (await Preferences.get({ key: "token" })).value;
    return;
  }
  if (!isNative) return;
  // With no server chosen, the app starts in local mode so it works straight after install.
  serverUrl = (await Preferences.get({ key: "server" })).value || (import.meta.env.VITE_DEFAULT_SERVER as string | undefined) || LOCAL;
  token = (await Preferences.get({ key: "token" })).value;
}

export const getServer = () => serverUrl;
export const isLocal = () => (isNative || webLocal) && serverUrl === LOCAL;
/** Sessions travel as a Bearer token (app, local mode) rather than a cookie (web). */
export const usesToken = () => isNative || isLocal();
export async function setServer(url: string) {
  serverUrl = url.trim().replace(/\/+$/, "");
  if (serverUrl && serverUrl !== LOCAL && !/^https?:\/\//.test(serverUrl)) serverUrl = `https://${serverUrl}`;
  await Preferences.set({ key: "server", value: serverUrl });
}

export const getToken = () => token;
export async function setToken(t: string | null) {
  token = t;
  if (t) await Preferences.set({ key: "token", value: t });
  else await Preferences.remove({ key: "token" });
}

/** Absolute URL for an API path in the native app; same-origin path on the web. */
export const apiUrl = (path: string) => (isNative && !isLocal() ? `${serverUrl}/api${path}` : `/api${path}`);

export const authHeaders = (): Record<string, string> => (usesToken() && token ? { authorization: `Bearer ${token}` } : {});

/** Video calls and external links: system browser in the app, new tab on the web. */
export async function openExternal(url: string) {
  if (isNative) await Browser.open({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
