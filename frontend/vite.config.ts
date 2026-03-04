import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_DEV_PROXY_TARGET = "http://127.0.0.1:8080";

function parsePort(rawValue: string | undefined): number | null {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return null;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed;
  }
  return null;
}

function normalizeBackendHost(rawValue: string | undefined): string {
  const host = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!host || host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host;
}

export default defineConfig(({ mode }) => {
  const frontendEnv = loadEnv(mode, process.cwd(), "");
  const rootDir = path.resolve(process.cwd(), "..");
  const rootEnv = loadEnv(mode, rootDir, "");

  const rootBackendPortRaw = rootEnv.BACKEND_PORT;
  const rootBackendPort = parsePort(rootBackendPortRaw);
  const rootBackendHost = normalizeBackendHost(rootEnv.BACKEND_HOST);
  const fallbackProxyTarget = typeof frontendEnv.VITE_DEV_PROXY_TARGET === "string"
    ? frontendEnv.VITE_DEV_PROXY_TARGET.trim()
    : "";

  if (rootBackendPortRaw && rootBackendPort == null) {
    console.warn(`[vite] invalid root BACKEND_PORT=${rootBackendPortRaw}, fallback to frontend/.env or default target`);
  }

  const devProxyTarget = rootBackendPort != null
    ? `http://${rootBackendHost}:${rootBackendPort}`
    : (fallbackProxyTarget || DEFAULT_DEV_PROXY_TARGET);

  return {
    base: "./",
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      allowedHosts: true,
      proxy: {
        "/term/api": {
          target: devProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/term\/api/u, "/webapi")
        },
        "/appterm/api": {
          target: devProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/appterm\/api/u, "/appapi")
        },
        "/term/ws": {
          target: devProxyTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/term\/ws/u, "/ws")
        },
        "/appterm/ws": {
          target: devProxyTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/appterm\/ws/u, "/ws")
        }
      }
    }
  };
});
