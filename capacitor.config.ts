import type { CapacitorConfig } from "@capacitor/cli";

// The native shell bundles the built PWA (dist/) and talks to the AEVUM server over HTTPS.
// The server URL is entered on the login screen (default: VITE_DEFAULT_SERVER at build time).
const config: CapacitorConfig = {
  appId: "app.aevum.health",
  appName: "AEVUM",
  webDir: "dist",
  backgroundColor: "#0E0F0C",
  android: { allowMixedContent: false },
  ios: { contentInset: "never" },
};

export default config;
