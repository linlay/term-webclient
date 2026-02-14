import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "./style.css";

const rawApiBase = typeof import.meta.env.VITE_API_BASE === "string"
  ? import.meta.env.VITE_API_BASE.trim()
  : "";
const API_BASE = rawApiBase.replace(/\/+$/, "");
const MAX_TABS = 10;

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

const newWindowModal = document.getElementById("newWindowModal");
const newWindowForm = document.getElementById("newWindowForm");
const cancelNewWindowBtn = document.getElementById("cancelNewWindowBtn");
const toolSelect = document.getElementById("toolSelect");
const workdirTree = document.getElementById("workdirTree");
const selectedWorkdirLabel = document.getElementById("selectedWorkdirLabel");
const advancedToggleBtn = document.getElementById("advancedToggleBtn");
const advancedSection = document.getElementById("advancedSection");
const titleInput = document.getElementById("titleInput");
const commandInput = document.getElementById("commandInput");
const argsInput = document.getElementById("argsInput");

const tabContextMenu = document.getElementById("tabContextMenu");
const contextRebuildBtn = document.getElementById("contextRebuildBtn");
const contextCloseBtn = document.getElementById("contextCloseBtn");

const tabs = new Map();
let tabOrder = [];
let activeTabId = null;
let noticeTimer = null;
let resizeTimer = null;
let fitTimer = null;
let layoutObserver = null;
let contextTabId = null;

const toolCounters = {
  terminal: 0,
  claude: 0,
  codex: 0,
  custom: 0
};

const modalState = {
  advancedOpen: false,
  rootPath: null,
  selectedPath: null,
  nodes: new Map(),
  loadingPaths: new Set()
};

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function wsBaseFromApiBase() {
  if (!API_BASE) {
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${window.location.host}`;
  }
  const apiUrlObj = new URL(API_BASE, window.location.origin);
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

function showNotice(message, type = "info", timeoutMs = 3000) {
  clearTimeout(noticeTimer);
  noticeBar.classList.remove("hidden", "info", "warn", "error", "success");
  noticeBar.classList.add(type);
  noticeBar.textContent = message;

  noticeTimer = setTimeout(() => {
    noticeBar.classList.add("hidden");
  }, timeoutMs);
}

function scheduleActiveFit(delay = 80) {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => {
    const active = getActiveTab();
    if (!active) {
      return;
    }
    fitAndResize(active);
  }, delay);
}

function updateEmptyState() {
  emptyState.classList.toggle("hidden", tabOrder.length > 0);
}

function canRebuild(tab) {
  return tab && (
    tab.lost
    || tab.connectionState === "disconnected"
    || tab.connectionState === "error"
    || tab.connectionState === "exited"
  );
}

function buildTabTooltip(tab) {
  const lines = [
    `Session: ${tab.sessionId || "-"}`,
    `Connection: ${tab.lost && tab.connectionState === "disconnected" ? "disconnected/lost" : tab.connectionState}`,
    `Exit: ${tab.exitCode ?? "-"}`,
    `Tool: ${tab.toolId || "custom"}`,
    `Workdir: ${tab.workdir || "."}`
  ];
  return lines.join("\n");
}

function createTabElement(tab) {
  const item = document.createElement("div");
  item.className = `tab-item${tab.tabId === activeTabId ? " active" : ""}`;
  item.dataset.tabId = tab.tabId;

  const mainBtn = document.createElement("button");
  mainBtn.type = "button";
  mainBtn.className = "tab-main";
  mainBtn.title = buildTabTooltip(tab);

  const dot = document.createElement("span");
  dot.className = `tab-dot ${tab.connectionState}`;

  const title = document.createElement("span");
  title.className = "tab-title";
  title.textContent = tab.lost ? `${tab.title} [lost]` : tab.title;

  mainBtn.appendChild(dot);
  mainBtn.appendChild(title);
  mainBtn.addEventListener("click", () => activateTab(tab.tabId));

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "tab-close";
  closeBtn.textContent = "x";
  closeBtn.title = "Close tab";
  closeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    void closeTab(tab.tabId);
  });

  item.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openTabContextMenu(event.clientX, event.clientY, tab.tabId);
  });

  item.appendChild(mainBtn);
  item.appendChild(closeBtn);
  return item;
}

function createPlusTabButton() {
  const plusBtn = document.createElement("button");
  plusBtn.type = "button";
  plusBtn.className = "tab-plus";
  plusBtn.textContent = "+";
  plusBtn.title = "New window";
  plusBtn.addEventListener("click", () => {
    openNewWindowModal();
  });
  return plusBtn;
}

function renderTabs() {
  tabBar.innerHTML = "";

  tabOrder.forEach((tabId) => {
    const tab = tabs.get(tabId);
    if (!tab) {
      return;
    }
    tabBar.appendChild(createTabElement(tab));
  });

  tabBar.appendChild(createPlusTabButton());
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
  return tab;
}

function setConnectionState(tab, state, options = {}) {
  tab.connectionState = state;
  if (Object.hasOwn(options, "lost")) {
    tab.lost = Boolean(options.lost);
  }
  renderTabs();
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

function attachSocket(tab) {
  if (!tab.wsUrl) {
    setConnectionState(tab, "error");
    return;
  }

  closeSocket(tab);
  setConnectionState(tab, "connecting", { lost: false });

  const socket = new WebSocket(buildWsUrl(tab.wsUrl));
  tab.socket = socket;

  socket.onopen = () => {
    if (tab.socket !== socket) {
      return;
    }
    setConnectionState(tab, "connected", { lost: false });
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
    if (tab.connectionState !== "error" && tab.connectionState !== "exited") {
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
  attachSocket(tab);
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

async function openTabWithSpec(spec) {
  if (tabOrder.length >= MAX_TABS) {
    showNotice(`Max ${MAX_TABS} windows reached`, "warn");
    return null;
  }

  const tab = createTab({
    title: spec.title,
    toolId: spec.toolId || "custom",
    command: spec.command,
    args: spec.args,
    workdir: spec.workdir,
    connectionState: "connecting",
    exitCode: "-",
    lost: false
  });

  activateTab(tab.tabId);
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

async function openPresetTab(toolId, workdir, advancedOverrides = {}) {
  const preset = TOOL_PRESETS[toolId];
  if (!preset) {
    showNotice(`Unknown tool: ${toolId}`, "error");
    return;
  }

  const command = advancedOverrides.command || preset.command;
  const args = Array.isArray(advancedOverrides.args) ? advancedOverrides.args : [...preset.args];
  const title = advancedOverrides.title || "";

  await openTabWithSpec({
    toolId: preset.toolId,
    title,
    command,
    args,
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
  updateEmptyState();
}

async function rebuildTab(tabId) {
  const tab = tabs.get(tabId);
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

    if (char === '"' || char === "'") {
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

function toArgsInput(args) {
  if (!Array.isArray(args) || args.length === 0) {
    return "";
  }

  return args
    .map((arg) => {
      if (/\s/.test(arg) || arg.includes('"')) {
        return `"${arg.replaceAll('"', '\\"')}"`;
      }
      return arg;
    })
    .join(" ");
}

function closeTabContextMenu() {
  tabContextMenu.classList.add("hidden");
  contextTabId = null;
}

function openTabContextMenu(x, y, tabId) {
  const tab = tabs.get(tabId);
  if (!tab) {
    return;
  }

  contextTabId = tabId;
  contextRebuildBtn.disabled = !canRebuild(tab);
  tabContextMenu.classList.remove("hidden");

  const menuRect = tabContextMenu.getBoundingClientRect();
  const left = Math.max(8, Math.min(x, window.innerWidth - menuRect.width - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - menuRect.height - 8));

  tabContextMenu.style.left = `${left}px`;
  tabContextMenu.style.top = `${top}px`;
}

function setAdvancedOpen(advancedOpen) {
  modalState.advancedOpen = Boolean(advancedOpen);
  advancedSection.classList.toggle("hidden", !modalState.advancedOpen);
  advancedToggleBtn.classList.toggle("active", modalState.advancedOpen);
}

function ensureNode(path, name, hasChildren, parentPath) {
  const existing = modalState.nodes.get(path);
  if (existing) {
    existing.name = name;
    existing.hasChildren = hasChildren;
    if (parentPath !== undefined) {
      existing.parentPath = parentPath;
    }
    return existing;
  }

  const node = {
    path,
    name,
    hasChildren,
    parentPath,
    loaded: false,
    expanded: false,
    children: []
  };

  modalState.nodes.set(path, node);
  return node;
}

function rootLabel(path) {
  return `~ ${path}`;
}

function selectWorkdir(path) {
  modalState.selectedPath = path;
  selectedWorkdirLabel.textContent = path || "-";
  renderWorkdirTree();
}

async function fetchWorkdirEntries(path) {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  const response = await fetch(apiUrl(`/api/workdirs${query}`));
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  return response.json();
}

async function loadWorkdir(path) {
  const key = path || "__root__";
  if (modalState.loadingPaths.has(key)) {
    return;
  }

  modalState.loadingPaths.add(key);
  renderWorkdirTree();
  let lastError = "";

  try {
    const data = await fetchWorkdirEntries(path);
    const rootPath = data.rootPath;
    const currentPath = data.currentPath;
    const entries = Array.isArray(data.entries) ? data.entries : [];

    if (!modalState.rootPath) {
      modalState.rootPath = rootPath;
      const rootNode = ensureNode(rootPath, rootLabel(rootPath), false, null);
      rootNode.loaded = true;
      rootNode.expanded = true;
      if (!modalState.selectedPath) {
        selectWorkdir(rootPath);
      }
    }

    const target = ensureNode(
      currentPath,
      currentPath === modalState.rootPath ? rootLabel(currentPath) : nameFromPath(currentPath),
      false,
      undefined
    );
    target.loaded = true;
    target.expanded = true;
    target.hasChildren = entries.length > 0;

    target.children = entries.map((entry) => entry.path);

    entries.forEach((entry) => {
      const node = ensureNode(entry.path, entry.name, Boolean(entry.hasChildren), currentPath);
      node.hasChildren = Boolean(entry.hasChildren);
      if (!Array.isArray(node.children)) {
        node.children = [];
      }
    });

  } catch (error) {
    showNotice(error.message, "error", 4200);
    lastError = `Failed to load workdirs: ${error.message}`;
  } finally {
    modalState.loadingPaths.delete(key);
    renderWorkdirTree(lastError);
  }
}

function nameFromPath(path) {
  const normalized = path.replace(/\\+/g, "/").replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  if (idx === -1) {
    return normalized;
  }
  return normalized.slice(idx + 1) || normalized;
}

function createTreeNodeElement(node, depth = 1) {
  const item = document.createElement("li");
  item.className = "tree-item";

  const row = document.createElement("div");
  row.className = "tree-row";
  row.style.paddingLeft = `${depth * 12}px`;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "tree-toggle";
  toggle.disabled = !node.hasChildren;
  toggle.textContent = node.hasChildren ? (node.expanded ? "-" : "+") : "";

  if (node.hasChildren) {
    toggle.addEventListener("click", () => {
      void toggleTreeNode(node.path);
    });
  }

  const label = document.createElement("button");
  label.type = "button";
  label.className = `tree-label${modalState.selectedPath === node.path ? " selected" : ""}`;
  label.textContent = node.name;
  label.title = node.path;
  label.addEventListener("click", () => {
    selectWorkdir(node.path);
  });

  row.appendChild(toggle);
  row.appendChild(label);
  item.appendChild(row);

  if (node.expanded && node.children.length > 0) {
    const list = document.createElement("ul");
    list.className = "tree-list";
    node.children.forEach((childPath) => {
      const child = modalState.nodes.get(childPath);
      if (!child) {
        return;
      }
      list.appendChild(createTreeNodeElement(child, depth + 1));
    });
    item.appendChild(list);
  }

  if (node.expanded && node.hasChildren && !node.loaded) {
    const loading = document.createElement("div");
    loading.className = "tree-inline-status";
    loading.textContent = "Loading...";
    item.appendChild(loading);
  }

  return item;
}

function renderWorkdirTree(errorText = "") {
  workdirTree.innerHTML = "";

  if (errorText) {
    const error = document.createElement("div");
    error.className = "tree-status error";
    error.textContent = errorText;
    workdirTree.appendChild(error);
    return;
  }

  if (!modalState.rootPath) {
    const status = document.createElement("div");
    status.className = "tree-status";
    status.textContent = "Loading workdirs...";
    workdirTree.appendChild(status);
    return;
  }

  const rootNode = modalState.nodes.get(modalState.rootPath);
  if (!rootNode) {
    const status = document.createElement("div");
    status.className = "tree-status";
    status.textContent = "No directories";
    workdirTree.appendChild(status);
    return;
  }

  const list = document.createElement("ul");
  list.className = "tree-list";
  list.appendChild(createTreeNodeElement(rootNode, 0));
  workdirTree.appendChild(list);
}

async function toggleTreeNode(path) {
  const node = modalState.nodes.get(path);
  if (!node || !node.hasChildren) {
    return;
  }

  if (!node.loaded) {
    await loadWorkdir(path);
    return;
  }

  node.expanded = !node.expanded;
  renderWorkdirTree();
}

function applyToolPresetToAdvanced(toolId) {
  const preset = TOOL_PRESETS[toolId];
  if (!preset) {
    return;
  }

  commandInput.value = preset.command;
  argsInput.value = toArgsInput(preset.args);
}

async function initializeWorkdirTree() {
  modalState.rootPath = null;
  modalState.selectedPath = null;
  modalState.nodes.clear();
  modalState.loadingPaths.clear();
  selectedWorkdirLabel.textContent = "-";
  renderWorkdirTree();
  await loadWorkdir(null);
}

async function openNewWindowModal() {
  if (tabOrder.length >= MAX_TABS) {
    showNotice(`Max ${MAX_TABS} windows reached`, "warn");
    return;
  }

  closeTabContextMenu();
  setAdvancedOpen(false);
  titleInput.value = "";
  toolSelect.value = "terminal";
  applyToolPresetToAdvanced("terminal");

  newWindowModal.classList.remove("hidden");
  newWindowModal.setAttribute("aria-hidden", "false");

  toolSelect.focus();
  await initializeWorkdirTree();
}

function closeNewWindowModal() {
  newWindowModal.classList.add("hidden");
  newWindowModal.setAttribute("aria-hidden", "true");
}

function bindEvents() {
  advancedToggleBtn.addEventListener("click", () => {
    setAdvancedOpen(!modalState.advancedOpen);
    if (modalState.advancedOpen) {
      commandInput.focus();
    }
  });

  toolSelect.addEventListener("change", () => {
    applyToolPresetToAdvanced(toolSelect.value);
  });

  cancelNewWindowBtn.addEventListener("click", () => {
    closeNewWindowModal();
  });

  newWindowModal.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.closeModal === "true") {
      closeNewWindowModal();
    }
  });

  newWindowForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const toolId = toolSelect.value;
    const workdir = modalState.selectedPath;
    if (!workdir) {
      showNotice("Please choose a workdir", "warn");
      return;
    }

    const advancedOverrides = {};

    if (modalState.advancedOpen) {
      const command = (commandInput.value || "").trim();
      if (!command) {
        showNotice("Command is required in advanced mode", "error");
        return;
      }

      let args = [];
      try {
        args = parseArgsInput(argsInput.value);
      } catch (error) {
        showNotice(error.message, "error", 4200);
        return;
      }

      advancedOverrides.command = command;
      advancedOverrides.args = args;
      advancedOverrides.title = (titleInput.value || "").trim();
    }

    closeNewWindowModal();
    void openPresetTab(toolId, workdir, advancedOverrides);
  });

  contextRebuildBtn.addEventListener("click", () => {
    const tabId = contextTabId;
    closeTabContextMenu();
    if (!tabId) {
      return;
    }
    if (activeTabId !== tabId) {
      activateTab(tabId);
    }
    void rebuildTab(tabId);
  });

  contextCloseBtn.addEventListener("click", () => {
    const tabId = contextTabId;
    closeTabContextMenu();
    if (!tabId) {
      return;
    }
    void closeTab(tabId);
  });

  document.addEventListener("click", (event) => {
    if (tabContextMenu.classList.contains("hidden")) {
      return;
    }
    if (!(event.target instanceof Node)) {
      closeTabContextMenu();
      return;
    }
    if (!tabContextMenu.contains(event.target)) {
      closeTabContextMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!newWindowModal.classList.contains("hidden")) {
        closeNewWindowModal();
        return;
      }
      closeTabContextMenu();
    }
  });

  window.addEventListener("resize", () => {
    closeTabContextMenu();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const active = getActiveTab();
      if (active) {
        fitAndResize(active);
      }
    }, 140);
  });

  window.addEventListener("beforeunload", () => {
    tabOrder.forEach((tabId) => {
      const tab = tabs.get(tabId);
      if (!tab) {
        return;
      }
      closeSocket(tab);
      if (tab.sessionId) {
        void deleteRemoteSession(tab.sessionId);
      }
    });
  });

  if (typeof ResizeObserver !== "undefined") {
    layoutObserver = new ResizeObserver(() => {
      scheduleActiveFit(30);
    });
    layoutObserver.observe(terminalArea);
  }
}

function bootstrap() {
  // Disable old restore behavior and clear stale localStorage from previous UI.
  try {
    localStorage.removeItem("pty.tabs.v1");
    localStorage.removeItem("pty.activeTab.v1");
  } catch {
    // Ignore storage failures.
  }

  bindEvents();
  renderTabs();
  updateEmptyState();
}

bootstrap();
