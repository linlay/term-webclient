import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import compression from "compression";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getErrorCode(error) {
  return error && typeof error === "object" && "code" in error
    ? error.code
    : null;
}

function isIgnorableSocketError(error) {
  const code = getErrorCode(error);
  return code === "EPIPE" || code === "ECONNRESET";
}

function safeWrite(stream, message) {
  if (!stream || stream.destroyed || stream.writableEnded) {
    return;
  }
  try {
    stream.write(message);
  } catch (error) {
    if (!isIgnorableSocketError(error)) {
      throw error;
    }
  }
}

function logServerError(scope, error, req) {
  if (isIgnorableSocketError(error)) {
    return;
  }
  const requestPath = req?.url ? ` url=${req.url}` : "";
  const message = error instanceof Error ? (error.stack || error.message) : String(error);
  safeWrite(process.stderr, `[server] ${scope}${requestPath} ${message}\n`);
}

function attachSocketErrorGuard(socket, scope, req) {
  socket.on("error", (error) => {
    logServerError(`${scope} socket error`, error, req);
  });
}

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
  safeWrite(process.stderr, `[server] invalid ${name}=${rawValue}, fallback to ${fallback}\n`);
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
  fileEnv.FRONTEND_PORT || fileEnv.PORT || process.env.FRONTEND_PORT || process.env.PORT || "11947",
  11947,
  "PORT"
);
const backendHost = fileEnv.BACKEND_HOST || process.env.BACKEND_HOST || "127.0.0.1";
const backendPort = parsePort(fileEnv.BACKEND_PORT || process.env.BACKEND_PORT || "11946", 11946, "BACKEND_PORT");
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

function createPrefixedProxy(pathFilter, targetPrefix, ws = false) {
  return createProxyMiddleware({
    pathFilter: (pathname) => pathname === pathFilter || pathname.startsWith(`${pathFilter}/`),
    target: BACKEND_ORIGIN,
    changeOrigin: true,
    ws,
    on: {
      error: (error, req) => {
        logServerError(`proxy error (${pathFilter})`, error, req);
      },
      econnreset: (error, req) => {
        logServerError(`proxy reset (${pathFilter})`, error, req);
      }
    },
    pathRewrite: (incomingPath) => (
      incomingPath.startsWith(pathFilter)
        ? `${targetPrefix}${incomingPath.slice(pathFilter.length)}`
        : incomingPath
    )
  });
}

const termApiProxy = createPrefixedProxy("/term/api", "/webapi");
const appTermApiProxy = createPrefixedProxy("/appterm/api", "/appapi");
const termWsProxy = createPrefixedProxy("/term/ws", "/ws", true);
const appTermWsProxy = createPrefixedProxy("/appterm/ws", "/ws", true);

app.use(termApiProxy);
app.use(appTermApiProxy);
app.use(termWsProxy);
app.use(appTermWsProxy);

app.use("/term", express.static(distDir, { index: false }));
app.use("/appterm", express.static(distDir, { index: false }));

app.use((req, res, next) => {
  if (req.method !== "GET") {
    next();
    return;
  }
  const isTermApiPath = req.path === "/term/api" || req.path.startsWith("/term/api/");
  const isAppTermApiPath = req.path === "/appterm/api" || req.path.startsWith("/appterm/api/");
  const isTermWsPath = req.path === "/term/ws" || req.path.startsWith("/term/ws/");
  const isAppTermWsPath = req.path === "/appterm/ws" || req.path.startsWith("/appterm/ws/");
  if (
    isTermApiPath
    || isAppTermApiPath
    || isTermWsPath
    || isAppTermWsPath
    || req.path === "/healthz"
  ) {
    next();
    return;
  }
  if (req.path === "/term") {
    res.redirect(302, "/term/");
    return;
  }
  if (req.path === "/appterm") {
    res.redirect(302, "/appterm/");
    return;
  }
  const isSpaEntryPath = req.path === "/term/" || req.path === "/appterm/";
  if (!isSpaEntryPath) {
    next();
    return;
  }
  res.sendFile(indexHtml);
});

const server = http.createServer(app);
server.on("clientError", (error, socket) => {
  if (isIgnorableSocketError(error)) {
    socket.destroy();
    return;
  }
  logServerError("client error", error);
  socket.destroy();
});

server.on("upgrade", (req, socket, head) => {
  attachSocketErrorGuard(socket, "upgrade", req);
  const pathName = req.url ? req.url.split("?", 1)[0] : "";
  if (pathName === "/term/ws" || pathName.startsWith("/term/ws/")) {
    termWsProxy.upgrade(req, socket, head);
    return;
  }
  if (pathName === "/appterm/ws" || pathName.startsWith("/appterm/ws/")) {
    appTermWsProxy.upgrade(req, socket, head);
    return;
  }
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  if (loadedEnvFiles.length > 0) {
    safeWrite(process.stdout, `[server] loaded env file(s): ${loadedEnvFiles.join(", ")}\n`);
  }
  safeWrite(process.stdout, `[server] backend origin: ${BACKEND_ORIGIN}\n`);
  safeWrite(process.stdout, `Proxy server listening on http://${HOST}:${PORT}\n`);
});
