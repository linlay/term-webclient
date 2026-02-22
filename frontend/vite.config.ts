import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devProxyTarget = env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:11947";

  return {
    base: "./",
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 11947,
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
