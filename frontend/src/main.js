import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "./style.css";

const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:8080").replace(/\/+$/, "");
const MAX_TABS = 10;
const STORAGE_TABS_KEY = "pty.tabs.v1";
const STORAGE_ACTIVE_TAB_KEY = "pty.activeTab.v1";

const TOOL_PRESETS = {
  terminal: {
    toolId: "terminal",
    title: "terminal",
    command: "/bin/zsh",
    args: ["-l"]
  },
  claude: {
    toolId: "claude",
    title: "claude",
    command: "claude",
    args: []
  },
  codex: {
    toolId: "codex",
    title: "codex",
    command: "codex",
    args: []
  }
};

const tabBar = document.getElementById("tabBar");
const terminalArea = document.getElementById("terminalArea");
const emptyState = document.getElementById("emptyState");
const noticeBar = document.getElementById("noticeBar");
const sessionPill = document.getElementById("sessionPill");
const connPill = document.getElementById("connPill");
const exitPill = document.getElementById("exitPill");
const toolPill = document.getElementById("toolPill");
const rebuildBtn = document.getElementById("rebuildBtn");
const workdirInput = document.getElementById("workdirInput");
const toolSelect = document.getElementById("toolSelect");
const newWindowBtn = document.getElementById("newWindowBtn");
const toggleAdvancedBtn = document.getElementById("toggleAdvancedBtn");
const advancedForm = document.getElementById("advancedForm");
const titleInput = document.getElementById("titleInput");
const commandInput = document.getElementById("commandInput");
const argsInput = document.getElementById("argsInput");
const advancedWorkdirInput = document.getElementById("advancedWorkdirInput");
const quickToolButtons = document.querySelectorAll(".tool-btn[data-tool]");

const tabs = new Map();
let tabOrder = [];
let activeTabId = null;
let noticeTimer = null;
let resizeTimer = null;

const toolCounters = {
  terminal: 0,
  claude: 0,
  codex: 0,
  custom: 0
};

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function wsBaseFromApiBase() {
  const apiUrlObj = new URL(API_BASE);
  const wsProtocol = apiUrlObj.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${apiUrlObj.host}`;
}

function buildWsUrl(wsPath) {
  if (wsPath.startsWith("ws://") || wsPath.startsWith("wss://")) {
    return wsPath;
  }
  return `${wsBaseFromApiBase()}${wsPath}`;
}

function nextTabId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nextTitle(toolId, command) {
  const normalizedTool = toolId && typeof toolId === "string" ? toolId : "custom";
  if (!Object.hasOwn(toolCounters, normalizedTool)) {
    toolCounters.custom += 1;
    return `${normalizedTool}-${toolCounters.custom}`;
  }
  toolCounters[normalizedTool] += 1;
  if (normalizedTool === "custom" && command) {
    return `${command}-${toolCounters.custom}`;
  }
  return `${normalizedTool}-${toolCounters[normalizedTool]}`;
}

function getActiveTab() {
  if (!activeTabId) {
    return null;
  }
  return tabs.get(activeTabId) || null;
}

function getWorkdirValue() {
  const value = (workdirInput.value || "").trim();
  return value || ".";
}

function showNotice(message, type = "info", timeoutMs = 3000) {
  clearTimeout(noticeTimer);
  noticeBar.classList.remove("hidden", "info", "warn", "error", "success");
  noticeBar.classList.add(type);
  noticeBar.textContent = message;
  noticeTimer = setTimeout(() => {
    noticeBar.classList.add("hidden");
  }, timeoutMs);
}

function setPillValue(pill, value, stateClass) {
  pill.classList.remove("connected", "connecting", "disconnected", "exited", "error");
  if (stateClass) {
    pill.classList.add(stateClass);
  }
  pill.querySelector("strong").textContent = value;
}

function updateStatusBar() {
  const tab = getActiveTab();
  if (!tab) {
    setPillValue(sessionPill, "-", "");
    setPillValue(connPill, "disconnected", "disconnected");
    setPillValue(exitPill, "-", "");
    setPillValue(toolPill, "-", "");
    rebuildBtn.classList.add("hidden");
    return;
  }

  const connText = tab.lost && tab.connectionState === "disconnected"
    ? "disconnected/lost"
    : tab.connectionState;

  setPillValue(sessionPill, tab.sessionId || "-", "");
  setPillValue(connPill, connText, tab.connectionState);
  setPillValue(exitPill, String(tab.exitCode ?? "-"), "");
  setPillValue(toolPill, tab.toolId || "custom", "");

  if (canRebuild(tab)) {
    rebuildBtn.classList.remove("hidden");
  } else {
    rebuildBtn.classList.add("hidden");
  }
}

function updateEmptyState() {
  if (tabOrder.length === 0) {
    emptyState.classList.remove("hidden");
  } else {
    emptyState.classList.add("hidden");
  }
}

function canRebuild(tab) {
  return tab.lost || tab.connectionState === "disconnected" || tab.connectionState === "error" || tab.connectionState === "exited";
}

function serializeTab(tab) {
  return {
    tabId: tab.tabId,
    title: tab.title,
    toolId: tab.toolId,
    command: tab.command,
    args: tab.args,
    workdir: tab.workdir,
    sessionId: tab.sessionId,
    wsUrl: tab.wsUrl,
    connectionState: tab.connectionState,
    exitCode: tab.exitCode,
    isRestored: tab.isRestored,
    lost: tab.lost
  };
}

function persistState() {
  try {
    const persistedTabs = tabOrder
      .map((tabId) => tabs.get(tabId))
      .filter(Boolean)
      .map(serializeTab);

    localStorage.setItem(STORAGE_TABS_KEY, JSON.stringify(persistedTabs));
    if (activeTabId) {
      localStorage.setItem(STORAGE_ACTIVE_TAB_KEY, activeTabId);
    } else {
      localStorage.removeItem(STORAGE_ACTIVE_TAB_KEY);
    }
  } catch {
    // Ignore localStorage failures in private mode or restricted contexts.
  }
}

function loadPersistedState() {
  try {
    const rawTabs = localStorage.getItem(STORAGE_TABS_KEY);
    const rawActiveTabId = localStorage.getItem(STORAGE_ACTIVE_TAB_KEY);

    if (!rawTabs) {
      return { tabs: [], activeTabId: rawActiveTabId };
    }

    const parsed = JSON.parse(rawTabs);
    if (!Array.isArray(parsed)) {
      return { tabs: [], activeTabId: rawActiveTabId };
    }

    return {
      tabs: parsed,
      activeTabId: rawActiveTabId
    };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

function normalizeStoredTab(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const command = typeof item.command === "string" ? item.command.trim() : "";
  if (!command) {
    return null;
  }

  const args = Array.isArray(item.args)
    ? item.args.filter((arg) => typeof arg === "string")
    : [];

  return {
    tabId: typeof item.tabId === "string" && item.tabId ? item.tabId : nextTabId(),
    title: typeof item.title === "string" ? item.title : "",
    toolId: typeof item.toolId === "string" && item.toolId ? item.toolId : "custom",
    command,
    args,
    workdir: typeof item.workdir === "string" && item.workdir.trim() ? item.workdir.trim() : ".",
    sessionId: typeof item.sessionId === "string" && item.sessionId ? item.sessionId : null,
    wsUrl: typeof item.wsUrl === "string" && item.wsUrl ? item.wsUrl : null,
    connectionState: typeof item.connectionState === "string" ? item.connectionState : "disconnected",
    exitCode: item.exitCode == null ? "-" : String(item.exitCode),
    isRestored: true,
    lost: Boolean(item.lost)
  };
}

function renderTabs() {
  tabBar.innerHTML = "";

  tabOrder.forEach((tabId) => {
    const tab = tabs.get(tabId);
    if (!tab) {
      return;
    }

    const item = document.createElement("div");
    item.className = `tab-item${tabId === activeTabId ? " active" : ""}`;
    item.dataset.tabId = tabId;

    const mainBtn = document.createElement("button");
    mainBtn.type = "button";
    mainBtn.className = "tab-main";
    mainBtn.title = `${tab.title} (${tab.command} ${tab.args.join(" ")})`;

    const dot = document.createElement("span");
    dot.className = `tab-dot ${tab.connectionState}`;

    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = tab.lost ? `${tab.title} [lost]` : tab.title;

    mainBtn.appendChild(dot);
    mainBtn.appendChild(title);
    mainBtn.addEventListener("click", () => activateTab(tabId));

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tab-close";
    closeBtn.textContent = "x";
    closeBtn.title = "Close tab";
    closeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tabId);
    });

    item.appendChild(mainBtn);
    item.appendChild(closeBtn);
    tabBar.appendChild(item);
  });
}

function createTab(spec) {
  const tabId = spec.tabId && !tabs.has(spec.tabId) ? spec.tabId : nextTabId();

  const panel = document.createElement("div");
  panel.className = "terminal-panel";
  panel.dataset.tabId = tabId;
  terminalArea.appendChild(panel);

  const term = new Terminal({
    cursorBlink: true,
    convertEol: true,
    scrollback: 5000,
    fontSize: 14,
    theme: {
      background: "#09101a"
    }
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(panel);

  const tab = {
    tabId,
    title: spec.title || nextTitle(spec.toolId, spec.command),
    toolId: spec.toolId || "custom",
    command: spec.command,
    args: Array.isArray(spec.args) ? spec.args : [],
    workdir: spec.workdir || ".",
    sessionId: spec.sessionId || null,
    wsUrl: spec.wsUrl || null,
    connectionState: spec.connectionState || "disconnected",
    exitCode: spec.exitCode ?? "-",
    isRestored: Boolean(spec.isRestored),
    lost: Boolean(spec.lost),
    panel,
    term,
    fitAddon,
    socket: null
  };

  term.onData((text) => {
    if (activeTabId !== tab.tabId) {
      return;
    }
    sendInput(tab, text);
  });

  tabs.set(tabId, tab);
  tabOrder.push(tabId);

  if (!activeTabId) {
    activeTabId = tabId;
  }

  renderTabs();
  updateEmptyState();
  updateStatusBar();
  persistState();
  return tab;
}

function setConnectionState(tab, state, options = {}) {
  tab.connectionState = state;
  if (Object.hasOwn(options, "lost")) {
    tab.lost = Boolean(options.lost);
  }
  renderTabs();
  updateStatusBar();
  persistState();
}

function activateTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) {
    return;
  }

  activeTabId = tabId;

  tabOrder.forEach((id) => {
    const candidate = tabs.get(id);
    if (!candidate) {
      return;
    }
    candidate.panel.classList.toggle("hidden", id !== tabId);
  });

  renderTabs();
  updateStatusBar();
  persistState();

  requestAnimationFrame(() => {
    fitAndResize(tab);
    tab.term.focus();
  });
}

function fitAndResize(tab) {
  if (!tab || tab.panel.classList.contains("hidden")) {
    return;
  }

  try {
    tab.fitAddon.fit();
  } catch {
    return;
  }

  sendResize(tab);
}

function sendResize(tab) {
  if (!tab || !tab.socket || tab.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const cols = Math.max(tab.term.cols || 120, 2);
  const rows = Math.max(tab.term.rows || 30, 2);

  tab.socket.send(
    JSON.stringify({
      type: "resize",
      cols,
      rows
    })
  );
}

function sendInput(tab, data) {
  if (!tab || !tab.socket || tab.socket.readyState !== WebSocket.OPEN) {
    return;
  }

  if (tab.connectionState === "exited") {
    return;
  }

  tab.socket.send(
    JSON.stringify({
      type: "input",
      data
    })
  );
}

function parseMessage(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function closeSocket(tab) {
  if (!tab.socket) {
    return;
  }

  const socket = tab.socket;
  tab.socket = null;
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;

  try {
    socket.close();
  } catch {
    // Ignore close failures.
  }
}

function attachSocket(tab, options = {}) {
  const restoring = Boolean(options.restoring);
  if (!tab.wsUrl) {
    setConnectionState(tab, "error");
    return;
  }

  closeSocket(tab);
  setConnectionState(tab, "connecting", { lost: false });

  const socket = new WebSocket(buildWsUrl(tab.wsUrl));
  tab.socket = socket;
  let opened = false;

  socket.onopen = () => {
    if (tab.socket !== socket) {
      return;
    }
    opened = true;
    setConnectionState(tab, "connected", { lost: false });
    if (restoring) {
      tab.term.writeln(`\r\n[restored] session ${tab.sessionId}`);
    }
    if (activeTabId === tab.tabId) {
      fitAndResize(tab);
      tab.term.focus();
    }
  };

  socket.onmessage = (event) => {
    if (tab.socket !== socket) {
      return;
    }

    const msg = parseMessage(event.data);
    if (!msg || typeof msg !== "object") {
      return;
    }

    if (msg.type === "output") {
      tab.term.write(msg.data || "");
      return;
    }

    if (msg.type === "exit") {
      tab.exitCode = String(msg.exitCode ?? "-");
      setConnectionState(tab, "exited");
      return;
    }

    if (msg.type === "error") {
      const message = msg.message || "unknown server error";
      tab.term.writeln(`\r\n[server-error] ${message}`);
      if (/Session not found/i.test(message)) {
        setConnectionState(tab, "disconnected", { lost: true });
      } else {
        setConnectionState(tab, "error");
      }
    }
  };

  socket.onclose = () => {
    if (tab.socket !== socket) {
      return;
    }

    tab.socket = null;

    if (tab.connectionState === "exited") {
      persistState();
      return;
    }

    if (restoring && !opened) {
      tab.term.writeln("\r\n[restore] session unavailable, click Rebuild Session.");
      setConnectionState(tab, "disconnected", { lost: true });
      return;
    }

    if (tab.connectionState !== "error") {
      setConnectionState(tab, "disconnected");
    }
  };

  socket.onerror = () => {
    if (tab.socket !== socket) {
      return;
    }
    if (tab.connectionState === "connecting") {
      setConnectionState(tab, "error");
    }
  };
}

async function extractErrorMessage(response) {
  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await response.json();
      if (body && typeof body.error === "string" && body.error) {
        return body.error;
      }
      if (body && typeof body.message === "string" && body.message) {
        return body.message;
      }
    } else {
      const text = await response.text();
      if (text) {
        return text;
      }
    }
  } catch {
    // Ignore response parse failures.
  }
  return `request failed (${response.status})`;
}

async function createRemoteSession(tab) {
  const payload = {
    command: tab.command,
    args: tab.args,
    workdir: tab.workdir,
    cols: Math.max(tab.term.cols || 120, 2),
    rows: Math.max(tab.term.rows || 30, 2)
  };

  const response = await fetch(apiUrl("/api/sessions"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  const data = await response.json();
  tab.sessionId = data.sessionId;
  tab.wsUrl = data.wsUrl;
  tab.exitCode = "-";
  tab.isRestored = false;
  persistState();
  attachSocket(tab, { restoring: false });
}

async function deleteRemoteSession(sessionId) {
  if (!sessionId) {
    return;
  }

  try {
    await fetch(apiUrl(`/api/sessions/${sessionId}`), {
      method: "DELETE",
      keepalive: true
    });
  } catch {
    // Ignore cleanup failures.
  }
}

async function openTabWithSpec(spec, options = {}) {
  const restoring = Boolean(options.restoring);

  if (tabOrder.length >= MAX_TABS) {
    showNotice(`Max ${MAX_TABS} windows reached`, "warn");
    return null;
  }

  const tab = createTab({
    tabId: spec.tabId,
    title: spec.title,
    toolId: spec.toolId || "custom",
    command: spec.command,
    args: spec.args,
    workdir: spec.workdir,
    sessionId: spec.sessionId,
    wsUrl: spec.wsUrl,
    connectionState: "connecting",
    exitCode: spec.exitCode ?? "-",
    isRestored: restoring,
    lost: Boolean(spec.lost)
  });

  activateTab(tab.tabId);

  if (restoring) {
    if (tab.sessionId && tab.wsUrl) {
      tab.term.writeln(`[restore] reconnecting session ${tab.sessionId}...`);
      attachSocket(tab, { restoring: true });
    } else {
      tab.term.writeln("[restore] no session found, click Rebuild Session.");
      setConnectionState(tab, "disconnected", { lost: true });
    }
    return tab;
  }

  tab.term.writeln(`Starting ${tab.command}...`);

  try {
    await createRemoteSession(tab);
  } catch (error) {
    tab.term.writeln(`\r\n[create-error] ${error.message}`);
    setConnectionState(tab, "error");
    showNotice(error.message, "error", 4200);
  }

  return tab;
}

async function openPresetTab(toolId, workdir) {
  const preset = TOOL_PRESETS[toolId];
  if (!preset) {
    showNotice(`Unknown tool: ${toolId}`, "error");
    return;
  }

  await openTabWithSpec({
    toolId: preset.toolId,
    command: preset.command,
    args: [...preset.args],
    workdir
  });
}

async function closeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) {
    return;
  }

  const removedIndex = tabOrder.indexOf(tabId);

  closeSocket(tab);
  if (tab.sessionId) {
    void deleteRemoteSession(tab.sessionId);
  }

  tab.term.dispose();
  tab.panel.remove();

  tabs.delete(tabId);
  tabOrder = tabOrder.filter((id) => id !== tabId);

  if (activeTabId === tabId) {
    activeTabId = null;
    const nextId = tabOrder[removedIndex] || tabOrder[removedIndex - 1] || null;
    if (nextId) {
      activateTab(nextId);
    }
  }

  if (!activeTabId && tabOrder[0]) {
    activateTab(tabOrder[0]);
  }

  renderTabs();
  updateStatusBar();
  updateEmptyState();
  persistState();
}

async function rebuildActiveTab() {
  const tab = getActiveTab();
  if (!tab) {
    return;
  }

  closeSocket(tab);
  if (tab.sessionId) {
    void deleteRemoteSession(tab.sessionId);
  }

  tab.sessionId = null;
  tab.wsUrl = null;
  tab.exitCode = "-";
  tab.lost = false;
  tab.term.writeln("\r\n[rebuild] creating fresh session...");
  setConnectionState(tab, "connecting", { lost: false });

  try {
    await createRemoteSession(tab);
    showNotice(`Rebuilt ${tab.title}`, "success", 2200);
  } catch (error) {
    tab.term.writeln(`\r\n[create-error] ${error.message}`);
    setConnectionState(tab, "error");
    showNotice(error.message, "error", 4200);
  }
}

function parseArgsInput(value) {
  const source = (value || "").trim();
  if (!source) {
    return [];
  }

  if (source.startsWith("[") && source.endsWith("]")) {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("args JSON must be an array of strings");
    }
    return parsed;
  }

  const args = [];
  let current = "";
  let quote = null;
  let escapeNext = false;

  for (const char of source) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      escapeNext = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escapeNext || quote) {
    throw new Error("args has an invalid escape or unclosed quote");
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function restoreTabs() {
  const persisted = loadPersistedState();
  const normalized = persisted.tabs
    .map(normalizeStoredTab)
    .filter(Boolean)
    .slice(0, MAX_TABS);

  if (normalized.length === 0) {
    return false;
  }

  normalized.forEach((item) => {
    void openTabWithSpec(item, { restoring: true });
  });

  if (persisted.activeTabId && tabs.has(persisted.activeTabId)) {
    activateTab(persisted.activeTabId);
  } else if (tabOrder[0]) {
    activateTab(tabOrder[0]);
  }

  showNotice("Attempting to restore previous terminal windows", "info", 2200);
  return true;
}

function bindEvents() {
  quickToolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const toolId = button.dataset.tool;
      void openPresetTab(toolId, getWorkdirValue());
    });
  });

  newWindowBtn.addEventListener("click", () => {
    void openPresetTab(toolSelect.value, getWorkdirValue());
  });

  toggleAdvancedBtn.addEventListener("click", () => {
    const shouldOpen = advancedForm.classList.contains("hidden");
    advancedForm.classList.toggle("hidden", !shouldOpen);
    if (shouldOpen) {
      advancedWorkdirInput.value = getWorkdirValue();
      commandInput.focus();
    }
  });

  advancedForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const command = (commandInput.value || "").trim();
    if (!command) {
      showNotice("Command is required", "error");
      return;
    }

    let args = [];
    try {
      args = parseArgsInput(argsInput.value);
    } catch (error) {
      showNotice(error.message, "error", 4200);
      return;
    }

    const customWorkdir = (advancedWorkdirInput.value || "").trim() || getWorkdirValue();
    workdirInput.value = customWorkdir;

    void openTabWithSpec({
      toolId: "custom",
      title: (titleInput.value || "").trim(),
      command,
      args,
      workdir: customWorkdir
    });
  });

  rebuildBtn.addEventListener("click", () => {
    void rebuildActiveTab();
  });

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const active = getActiveTab();
      if (active) {
        fitAndResize(active);
      }
    }, 140);
  });

  window.addEventListener("beforeunload", () => {
    persistState();
  });
}

async function bootstrap() {
  bindEvents();

  const restored = restoreTabs();
  if (!restored) {
    await openPresetTab("terminal", getWorkdirValue());
  }

  updateStatusBar();
  updateEmptyState();
}

bootstrap().catch((error) => {
  showNotice(`Fatal: ${error.message}`, "error", 6000);
});
