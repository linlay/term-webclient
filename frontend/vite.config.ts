import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 11949,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:11948",
        changeOrigin: true
      },
      "/ws": {
        target: "http://127.0.0.1:11948",
        changeOrigin: true,
        ws: true
      }
    }
  }
});
