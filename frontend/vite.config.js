import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 11949,
    allowedHosts: [
      "pty.linlay.cc",
      "13.212.113.109"
    ],
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
