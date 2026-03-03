import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";

// Related: https://github.com/remix-run/remix/issues/2835#issuecomment-1144102176
// Replace the host config with the Shopify app URL when deployed
if (
  process.env.HOST &&
  (!process.env.SHOPIFY_APP_URL ||
    process.env.SHOPIFY_APP_URL === process.env.HOST)
) {
  process.env.SHOPIFY_APP_URL = process.env.HOST;
}

let hmrConfig;
if (process.env.SHOPIFY_APP_URL) {
  const host = new URL(process.env.SHOPIFY_APP_URL);
  hmrConfig = {
    protocol: host.protocol === "https:" ? "wss" : "ws",
    host: host.hostname,
    port: Number(host.port || (host.protocol === "https:" ? 443 : 80)),
    clientPort: Number(host.port || (host.protocol === "https:" ? 443 : 80)),
  };
}

export default defineConfig({
  server: {
    port: Number(process.env.PORT || 3000),
    hmr: hmrConfig,
    fs: {
      allow: ["app", "node_modules"],
    },
  },
  plugins: [
    remix({
      ignoredRouteFiles: ["**/.*"],
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        v3_lazyRouteDiscovery: true,
        v3_singleFetch: true,
      },
    }),
  ],
  build: {
    assetsInlineLimit: 0,
  },
  resolve: {
    alias: {
      "~": "/app",
    },
  },
});
