import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devProxyTarget = env.VITE_DEV_PROXY_TARGET || "http://127.0.0.1:11931";

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 11931,
      allowedHosts: true,
      proxy: {
        "/webapi": {
          target: devProxyTarget,
          changeOrigin: true
        },
        "/appapi": {
          target: devProxyTarget,
          changeOrigin: true
        },
        "/ws": {
          target: devProxyTarget,
          changeOrigin: true,
          ws: true
        }
      }
    }
  };
});
