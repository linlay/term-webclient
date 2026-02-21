import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PORT || "11949", 10);
const HOST = process.env.HOST || "0.0.0.0";
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://127.0.0.1:11948";

const distDir = path.resolve(__dirname, "dist");
const indexHtml = path.join(distDir, "index.html");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(compression());

app.get("/healthz", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});

const webApiProxy = createProxyMiddleware({
  pathFilter: "/webapi",
  target: BACKEND_ORIGIN,
  changeOrigin: true,
  ws: false
});

const appApiProxy = createProxyMiddleware({
  pathFilter: "/appapi",
  target: BACKEND_ORIGIN,
  changeOrigin: true,
  ws: false
});

const wsProxy = createProxyMiddleware({
  pathFilter: "/ws",
  target: BACKEND_ORIGIN,
  changeOrigin: true,
  ws: true
});

app.use(webApiProxy);
app.use(appApiProxy);
app.use(wsProxy);

app.use(express.static(distDir, { index: false }));

app.use((req, res, next) => {
  if (req.method !== "GET") {
    next();
    return;
  }
  if (
    req.path.startsWith("/webapi")
    || req.path.startsWith("/appapi")
    || req.path.startsWith("/ws")
    || req.path === "/healthz"
  ) {
    next();
    return;
  }
  if (req.path === "/") {
    res.redirect(302, "/term");
    return;
  }
  const isSpaPath = req.path === "/term"
    || req.path === "/appterm"
    || req.path.startsWith("/term/")
    || req.path.startsWith("/appterm/");
  if (!isSpaPath) {
    next();
    return;
  }
  res.sendFile(indexHtml);
});

const server = http.createServer(app);
server.on("upgrade", (req, socket, head) => {
  if (req.url && req.url.startsWith("/ws/")) {
    wsProxy.upgrade(req, socket, head);
    return;
  }
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`Proxy server listening on http://${HOST}:${PORT}\n`);
});
