import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

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

function requireEnvValue(
  values: Record<string, string>,
  name: string,
  sourceHint: string
): string {
  const raw = values[name];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw new Error(`[vite] missing ${name}; please set it in ${sourceHint}`);
  }
  return value;
}

function requireEnvPort(
  values: Record<string, string>,
  name: string,
  sourceHint: string
): number {
  const raw = requireEnvValue(values, name, sourceHint);
  const parsed = parsePort(raw);
  if (parsed == null) {
    throw new Error(`[vite] invalid ${name}=${raw}; expected integer in range 1-65535`);
  }
  return parsed;
}

export default defineConfig(({ mode }) => {
  const rootDir = path.resolve(process.cwd(), "..");
  const rootEnv = loadEnv(mode, rootDir, "");
  const rootSourceHint = `${rootDir}/.env`;

  const backendPort = requireEnvPort(rootEnv, "BACKEND_PORT", rootSourceHint);
  const frontendPort = requireEnvPort(rootEnv, "FRONTEND_PORT", rootSourceHint);
  const frontendHost = requireEnvValue(rootEnv, "FRONTEND_HOST", rootSourceHint);
  const backendHost = normalizeBackendHost(requireEnvValue(rootEnv, "BACKEND_HOST", rootSourceHint));
  const devProxyTarget = `http://${backendHost}:${backendPort}`;

  return {
    base: "./",
    plugins: [react()],
    server: {
      host: frontendHost,
      port: frontendPort,
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
