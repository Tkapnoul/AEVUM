import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "AEVUM",
        short_name: "AEVUM",
        description: "Your health data, your care team and AI guidance in one place.",
        lang: "el",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#0E0F0C",
        theme_color: "#0E0F0C",
        categories: ["health", "fitness", "medical"],
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        shortcuts: [
          { name: "AEVUM AI", url: "/ai" },
          { name: "Sessions", url: "/care" },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        runtimeCaching: [
          {
            // Last-seen data stays readable offline. Cleared on logout.
            urlPattern: ({ url }) => url.pathname.startsWith("/api/metrics/") || url.pathname === "/api/care/bookings",
            handler: "NetworkFirst",
            options: { cacheName: "aevum-data", networkTimeoutSeconds: 4, expiration: { maxEntries: 80, maxAgeSeconds: 7 * 86400 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: false } },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: { VITEST: "true", DATABASE_PATH: ":memory:", ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" },
    alias: { "@zos/sensor": new URL("./tests/mocks/zos-sensor.ts", import.meta.url).pathname },
  },
});
