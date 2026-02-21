import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseEnvValue(rawValue) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
}

function readEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }
  const values = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/u)) {
    const normalized = line.trim();
    if (!normalized || normalized.startsWith("#")) {
      continue;
    }
    const match = normalized.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    values[key] = parseEnvValue(rawValue);
  }
  return values;
}

function parsePort(rawValue, fallback, name) {
  const parsed = Number.parseInt(String(rawValue), 10);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed;
  }
  process.stderr.write(`[server] invalid ${name}=${rawValue}, fallback to ${fallback}\n`);
  return fallback;
}

const envCandidates = [
  process.env.ENV_FILE,
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(__dirname, ".env"),
  path.resolve(__dirname, "..", ".env")
].filter(Boolean);

const loadedEnvFiles = [];
const seenEnvFiles = new Set();
const fileEnv = {};
for (const envFile of envCandidates) {
  const resolved = path.resolve(envFile);
  if (seenEnvFiles.has(resolved)) {
    continue;
  }
  seenEnvFiles.add(resolved);
  const parsed = readEnvFile(resolved);
  if (parsed) {
    Object.assign(fileEnv, parsed);
    loadedEnvFiles.push(resolved);
  }
}

const HOST = fileEnv.FRONTEND_HOST || fileEnv.HOST || process.env.FRONTEND_HOST || process.env.HOST || "0.0.0.0";
const PORT = parsePort(
  fileEnv.FRONTEND_PORT || fileEnv.PORT || process.env.FRONTEND_PORT || process.env.PORT || "11931",
  11931,
  "PORT"
);
const backendHost = fileEnv.BACKEND_HOST || process.env.BACKEND_HOST || "127.0.0.1";
const backendPort = parsePort(fileEnv.BACKEND_PORT || process.env.BACKEND_PORT || "11930", 11930, "BACKEND_PORT");
const hasFileBackendAddress = Boolean(fileEnv.BACKEND_HOST || fileEnv.BACKEND_PORT);
const BACKEND_ORIGIN = fileEnv.BACKEND_ORIGIN
  || (hasFileBackendAddress ? `http://${backendHost}:${backendPort}` : null)
  || process.env.BACKEND_ORIGIN
  || `http://${backendHost}:${backendPort}`;

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
  if (loadedEnvFiles.length > 0) {
    process.stdout.write(`[server] loaded env file(s): ${loadedEnvFiles.join(", ")}\n`);
  }
  process.stdout.write(`[server] backend origin: ${BACKEND_ORIGIN}\n`);
  process.stdout.write(`Proxy server listening on http://${HOST}:${PORT}\n`);
});
