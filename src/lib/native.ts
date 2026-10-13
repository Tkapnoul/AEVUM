import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Browser } from "@capacitor/browser";

/** True inside the Android/iOS app; false in the browser/PWA. */
export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform() as "ios" | "android" | "web";

// Values cached in memory so every API call doesn't hit async storage.
let serverUrl = "";
let token: string | null = null;

export async function loadNativeState() {
  if (!isNative) return;
  serverUrl = (await Preferences.get({ key: "server" })).value ?? (import.meta.env.VITE_DEFAULT_SERVER as string | undefined) ?? "";
  token = (await Preferences.get({ key: "token" })).value;
}

export const getServer = () => serverUrl;
export async function setServer(url: string) {
  serverUrl = url.trim().replace(/\/+$/, "");
  if (serverUrl && !/^https?:\/\//.test(serverUrl)) serverUrl = `https://${serverUrl}`;
  await Preferences.set({ key: "server", value: serverUrl });
}

export const getToken = () => token;
export async function setToken(t: string | null) {
  token = t;
  if (t) await Preferences.set({ key: "token", value: t });
  else await Preferences.remove({ key: "token" });
}

/** Absolute URL for an API path in the native app; same-origin path on the web. */
export const apiUrl = (path: string) => (isNative ? `${serverUrl}/api${path}` : `/api${path}`);

export const authHeaders = (): Record<string, string> => (isNative && token ? { authorization: `Bearer ${token}` } : {});

/** Video calls and external links: system browser in the app, new tab on the web. */
export async function openExternal(url: string) {
  if (isNative) await Browser.open({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
}
