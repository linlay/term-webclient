import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

const rawApiBase = typeof import.meta.env.VITE_API_BASE === "string"
  ? import.meta.env.VITE_API_BASE.trim()
  : "";
const API_BASE = rawApiBase.replace(/\/+$/, "");
const rawCopilotRefreshMs = Number.parseInt(import.meta.env.VITE_COPILOT_REFRESH_MS || "2000", 10);
const COPILOT_REFRESH_MS = Number.isFinite(rawCopilotRefreshMs) && rawCopilotRefreshMs >= 500
  ? rawCopilotRefreshMs
  : 2000;
const SHARED_SESSIONS_SYNC_MS = 2000;
const MAX_TABS = 10;
const RECONNECT_MIN_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
const AUTH_DISABLED_USERNAME = "anonymous";
const MOBILE_BREAKPOINT_PX = 900;
const DESKTOP_TERMINAL_FONT_SIZE = 14;
const MOBILE_TERMINAL_FONT_SIZE = 10;
const MOBILE_SHORTCUTS = [
  { label: "ESC", seq: "\u001b" },
  { label: "1", seq: "1" },
  { label: "2", seq: "2" },
  { label: "3", seq: "3" },
  { label: "4", seq: "4" },
  { label: "↑", seq: "\u001b[A" },
  { label: "收起", action: "collapse" },
  { label: "TAB", seq: "\t" },
  { label: "CTRL+C", seq: "\u0003" },
  { label: "CTRL+D", seq: "\u0004" },
  { label: "CTRL+Z", seq: "\u001a" },
  { label: "←", seq: "\u001b[D" },
  { label: "↓", seq: "\u001b[B" },
  { label: "→", seq: "\u001b[C" }
];
const QUICK_KEY_SEQUENCES = new Map([
  ["tab", "\t"],
  ["esc", "\u001b"],
  ["escape", "\u001b"],
  ["enter", "\r"],
  ["return", "\r"],
  ["up", "\u001b[A"],
  ["down", "\u001b[B"],
  ["left", "\u001b[D"],
  ["right", "\u001b[C"],
  ["ctrl+c", "\u0003"],
  ["ctrl+d", "\u0004"],
  ["ctrl+z", "\u001a"]
]);

const BUILTIN_TOOL_PRESETS = {
  terminal: {
    toolId: "terminal",
    sessionType: "LOCAL_PTY",
    title: "terminal",
    command: "/bin/zsh",
    args: ["-l"]
  },
  ssh: {
    toolId: "ssh",
    sessionType: "SSH_SHELL",
    title: "ssh",
    command: "",
    args: [],
    ssh: {
      term: "xterm-256color"
    }
  }
};

const tabBar = document.getElementById("tabBar");
const terminalArea = document.getElementById("terminalArea");
const emptyState = document.getElementById("emptyState");
const mobileShortcutBar = document.getElementById("mobileShortcutBar");
const mobileShortcutToggleBtn = document.getElementById("mobileShortcutToggleBtn");
const mobileShortcutKeys = document.getElementById("mobileShortcutKeys");
const noticeBar = document.getElementById("noticeBar");
const appRoot = document.getElementById("app");

const loginGate = document.getElementById("loginGate");
const loginForm = document.getElementById("loginForm");
const loginUsernameInput = document.getElementById("loginUsernameInput");
const loginPasswordInput = document.getElementById("loginPasswordInput");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");

const newWindowModal = document.getElementById("newWindowModal");
const newWindowForm = document.getElementById("newWindowForm");
const cancelNewWindowBtn = document.getElementById("cancelNewWindowBtn");
const toolSelect = document.getElementById("toolSelect");
const workdirSection = document.getElementById("workdirSection");
const workdirTree = document.getElementById("workdirTree");
const selectedWorkdirLabel = document.getElementById("selectedWorkdirLabel");
const advancedSection = document.getElementById("advancedSection");
const titleInput = document.getElementById("titleInput");
const commandInput = document.getElementById("commandInput");
const argsInput = document.getElementById("argsInput");
const sshSection = document.getElementById("sshSection");
const sshCredentialList = document.getElementById("sshCredentialList");
const sshSelectedCredentialIdLabel = document.getElementById("sshSelectedCredentialIdLabel");
const sshRefreshCredentialsBtn = document.getElementById("sshRefreshCredentialsBtn");
const sshOpenCreateModalBtn = document.getElementById("sshOpenCreateModalBtn");
const sshCreateModal = document.getElementById("sshCreateModal");
const sshCreateForm = document.getElementById("sshCreateForm");
const cancelSshCreateBtn = document.getElementById("cancelSshCreateBtn");
const sshCreateHostInput = document.getElementById("sshCreateHostInput");
const sshCreatePortInput = document.getElementById("sshCreatePortInput");
const sshCreateUsernameInput = document.getElementById("sshCreateUsernameInput");
const sshCreateAuthTypeSelect = document.getElementById("sshCreateAuthTypeSelect");
const sshCreatePasswordField = document.getElementById("sshCreatePasswordField");
const sshCreatePasswordInput = document.getElementById("sshCreatePasswordInput");
const sshCreatePrivateKeyField = document.getElementById("sshCreatePrivateKeyField");
const sshCreatePrivateKeyInput = document.getElementById("sshCreatePrivateKeyInput");
const sshCreatePrivateKeyPassphraseField = document.getElementById("sshCreatePrivateKeyPassphraseField");
const sshCreatePrivateKeyPassphraseInput = document.getElementById("sshCreatePrivateKeyPassphraseInput");
const sshCreateCredentialBtn = document.getElementById("sshCreateCredentialBtn");
const sshHostInput = document.getElementById("sshHostInput");
const sshPortInput = document.getElementById("sshPortInput");
const sshUsernameInput = document.getElementById("sshUsernameInput");
const sshTermInput = document.getElementById("sshTermInput");

const copilotPanelToggleBtn = document.getElementById("copilotPanelToggleBtn");
const copilotMobileBackdrop = document.getElementById("copilotMobileBackdrop");
const copilotSummaryTabBtn = document.getElementById("copilotSummaryTabBtn");
const copilotAgentTabBtn = document.getElementById("copilotAgentTabBtn");
const copilotSummaryPanel = document.getElementById("copilotSummaryPanel");
const copilotAgentPanel = document.getElementById("copilotAgentPanel");
const refreshSessionSummaryBtn = document.getElementById("refreshSessionSummaryBtn");
const copySessionContextBtn = document.getElementById("copySessionContextBtn");
const copySessionTranscriptBtn = document.getElementById("copySessionTranscriptBtn");
const sessionSummaryContextText = document.getElementById("sessionSummaryContextText");
const sessionSummaryTranscriptText = document.getElementById("sessionSummaryTranscriptText");

const agentSidebar = document.getElementById("agentSidebar");
const agentSessionLabel = document.getElementById("agentSessionLabel");
const agentInstructionInput = document.getElementById("agentInstructionInput");
const agentSelectedPathsInput = document.getElementById("agentSelectedPathsInput");
const agentStartRunBtn = document.getElementById("agentStartRunBtn");
const agentApproveBtn = document.getElementById("agentApproveBtn");
const agentApproveRiskBtn = document.getElementById("agentApproveRiskBtn");
const agentAbortBtn = document.getElementById("agentAbortBtn");
const agentRefreshBtn = document.getElementById("agentRefreshBtn");
const agentRunStatus = document.getElementById("agentRunStatus");
const agentStepsList = document.getElementById("agentStepsList");
const agentQuickCommandInput = document.getElementById("agentQuickCommandInput");
const agentQuickSendBtn = document.getElementById("agentQuickSendBtn");

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
let appInitialized = false;
let copilotActiveTab = "summary";
let copilotRefreshTimer = null;
let summaryRefreshInFlight = false;
let agentRefreshInFlight = false;
let mobileShortcutsExpanded = false;
let sharedSessionsSyncTimer = null;
let sharedSessionsSyncInFlight = false;
let terminalClientCatalog = [];
let authState = {
  enabled: false,
  authenticated: false,
  username: AUTH_DISABLED_USERNAME
};

const toolCounters = {
  terminal: 0,
  ssh: 0,
  custom: 0
};

const modalState = {
  rootPath: null,
  selectedPath: null,
  nodes: new Map(),
  loadingPaths: new Set(),
  sshCredentials: [],
  selectedSshCredentialId: null,
  sshCredentialsLoading: false,
  sshCredentialsError: ""
};

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function isMobileViewport() {
  return window.innerWidth <= MOBILE_BREAKPOINT_PX;
}

function resolveMobileViewportHeight() {
  const visualViewportHeight = window.visualViewport?.height;
  if (Number.isFinite(visualViewportHeight) && visualViewportHeight > 0) {
    return Math.round(visualViewportHeight);
  }
  const fallbackHeight = window.innerHeight;
  if (Number.isFinite(fallbackHeight) && fallbackHeight > 0) {
    return Math.round(fallbackHeight);
  }
  return 0;
}

function syncMobileViewportHeight() {
  const viewportHeight = resolveMobileViewportHeight();
  if (viewportHeight > 0) {
    document.documentElement.style.setProperty("--app-vh", `${viewportHeight}px`);
    document.documentElement.style.setProperty("--mobile-vh", `${viewportHeight}px`);
  }
  syncMobileShortcutInset();
  scheduleActiveFit(30);
}

function syncMobileShortcutInset() {
  if (!isMobileViewport() || !mobileShortcutBar) {
    document.documentElement.style.setProperty("--mobile-shortcut-inset", "0px");
    return;
  }
  const computed = window.getComputedStyle(mobileShortcutBar);
  if (computed.display === "none") {
    document.documentElement.style.setProperty("--mobile-shortcut-inset", "0px");
    return;
  }
  const height = Math.max(0, Math.round(mobileShortcutBar.getBoundingClientRect().height));
  const bottom = Number.parseFloat(computed.bottom) || 0;
  const inset = Math.max(0, Math.round(height + bottom));
  document.documentElement.style.setProperty("--mobile-shortcut-inset", `${inset}px`);
}

function resolveTerminalFontSize() {
  return isMobileViewport() ? MOBILE_TERMINAL_FONT_SIZE : DESKTOP_TERMINAL_FONT_SIZE;
}

function applyTerminalFontSize(tab, fontSize) {
  if (!tab?.term || tab.currentFontSize === fontSize) {
    return;
  }
  tab.term.options.fontSize = fontSize;
  tab.currentFontSize = fontSize;
}

function syncTerminalFontSizes() {
  const fontSize = resolveTerminalFontSize();
  tabOrder.forEach((tabId) => {
    const tab = tabs.get(tabId);
    if (!tab) {
      return;
    }
    applyTerminalFontSize(tab, fontSize);
  });
}

function setMobileShortcutsExpanded(expanded) {
  mobileShortcutsExpanded = Boolean(expanded);
  if (!mobileShortcutBar) {
    return;
  }
  mobileShortcutBar.classList.toggle("collapsed", !mobileShortcutsExpanded);
  mobileShortcutBar.classList.toggle("expanded", mobileShortcutsExpanded);
  terminalArea.classList.toggle("mobile-shortcuts-expanded", mobileShortcutsExpanded);
  if (mobileShortcutToggleBtn) {
    mobileShortcutToggleBtn.setAttribute("aria-expanded", String(mobileShortcutsExpanded));
  }
  syncMobileShortcutInset();
  scheduleActiveFit(30);
}

function sendMobileShortcut(sequence) {
  const tab = getActiveTab();
  if (!tab) {
    showNotice("No active tab", "warn");
    return;
  }
  sendInput(tab, sequence);
  tab.term.focus();
}

function renderMobileShortcutKeys() {
  if (!mobileShortcutKeys) {
    return;
  }
  mobileShortcutKeys.innerHTML = "";
  MOBILE_SHORTCUTS.forEach((shortcut) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mobile-shortcut-key";
    if (shortcut.action) {
      button.dataset.action = shortcut.action;
    } else {
      button.dataset.seq = shortcut.seq;
    }
    button.textContent = shortcut.label;
    mobileShortcutKeys.appendChild(button);
  });
}

function showLoginError(message) {
  if (!message) {
    loginError.classList.add("hidden");
    loginError.textContent = "";
    return;
  }
  loginError.classList.remove("hidden");
  loginError.textContent = message;
}

function renderAuthGate() {
  const shouldShowLogin = authState.enabled && !authState.authenticated;
  loginGate.classList.toggle("hidden", !shouldShowLogin);
  appRoot.classList.toggle("hidden", shouldShowLogin);
  if (shouldShowLogin) {
    loginUsernameInput.focus();
  }
}

function disconnectAllTabsForAuth() {
  tabOrder.forEach((tabId) => {
    const tab = tabs.get(tabId);
    if (!tab) {
      return;
    }
    closeSocket(tab, { manual: true });
    clearReconnectTimer(tab);
    if (tab.connectionState !== "exited") {
      setConnectionState(tab, "disconnected", { lost: tab.lost });
    }
  });
}

function enterLoggedOutState() {
  stopCopilotRefresh();
  stopSharedSessionsSync();
  disconnectAllTabsForAuth();
  authState.authenticated = false;
  authState.username = AUTH_DISABLED_USERNAME;
  renderAuthGate();
}

async function apiFetch(path, options = {}) {
  const fetchOptions = {
    credentials: "include",
    ...options
  };
  const response = await fetch(apiUrl(path), fetchOptions);
  if (response.status === 401) {
    enterLoggedOutState();
  }
  return response;
}

async function fetchAuthStatus() {
  const response = await apiFetch("/api/auth/me");
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  const body = await response.json();
  authState = {
    enabled: Boolean(body?.enabled),
    authenticated: Boolean(body?.authenticated),
    username: body?.username || AUTH_DISABLED_USERNAME
  };
  renderAuthGate();
}

async function verifyAuthForReconnect() {
  if (!authState.enabled) {
    return true;
  }
  try {
    const response = await fetch(apiUrl("/api/auth/me"), {
      method: "GET",
      credentials: "include"
    });
    if (response.status === 401) {
      enterLoggedOutState();
      return false;
    }
    if (!response.ok) {
      return true;
    }
    const body = await response.json();
    authState = {
      enabled: Boolean(body?.enabled),
      authenticated: Boolean(body?.authenticated),
      username: body?.username || AUTH_DISABLED_USERNAME
    };
    renderAuthGate();
    if (authState.enabled && !authState.authenticated) {
      enterLoggedOutState();
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

async function loginWithForm() {
  const username = (loginUsernameInput.value || "").trim();
  const password = loginPasswordInput.value || "";
  if (!username || !password) {
    showLoginError("Username and password are required");
    return false;
  }

  const response = await apiFetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  if (!response.ok) {
    showLoginError(await extractErrorMessage(response));
    return false;
  }

  const body = await response.json();
  authState = {
    enabled: Boolean(body?.enabled),
    authenticated: Boolean(body?.authenticated),
    username: body?.username || AUTH_DISABLED_USERNAME
  };
  loginPasswordInput.value = "";
  showLoginError("");
  renderAuthGate();
  return authState.authenticated;
}

async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch {
    // ignore network errors during logout
  }
  enterLoggedOutState();
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

function cloneSshConfig(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const ssh = {};
  ["credentialId"].forEach((key) => {
    if (Object.hasOwn(value, key) && value[key] !== undefined && value[key] !== null && value[key] !== "") {
      ssh[key] = value[key];
    }
  });
  return Object.keys(ssh).length > 0 ? ssh : null;
}

function sanitizeTerminalClient(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  if (!id) {
    return null;
  }
  const label = typeof entry.label === "string" && entry.label.trim()
    ? entry.label.trim()
    : id;
  const defaultWorkdir = typeof entry.defaultWorkdir === "string" && entry.defaultWorkdir.trim()
    ? entry.defaultWorkdir.trim()
    : ".";
  return { id, label, defaultWorkdir };
}

function getTerminalClientById(clientId) {
  return terminalClientCatalog.find((entry) => entry.id === clientId) || null;
}

function renderToolOptions(selectedValue = null) {
  const preferred = selectedValue || toolSelect.value || "terminal";
  toolSelect.innerHTML = "";

  const options = [
    { value: "terminal", label: "terminal" },
    ...terminalClientCatalog.map((entry) => ({ value: entry.id, label: entry.label })),
    { value: "ssh", label: "ssh" }
  ];

  options.forEach((optionItem) => {
    const option = document.createElement("option");
    option.value = optionItem.value;
    option.textContent = optionItem.label;
    toolSelect.appendChild(option);
  });

  if (options.some((item) => item.value === preferred)) {
    toolSelect.value = preferred;
  } else {
    toolSelect.value = "terminal";
  }
}

function persistTabsState() {
  // Tab/session state is synchronized from backend shared sessions.
}

function findTabBySessionId(sessionId) {
  if (!sessionId) {
    return null;
  }
  for (const tabId of tabOrder) {
    const tab = tabs.get(tabId);
    if (tab && tab.sessionId === sessionId) {
      return tab;
    }
  }
  return null;
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
    `Type: ${tab.sessionType || "LOCAL_PTY"}`,
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

  const terminalFontSize = resolveTerminalFontSize();
  const term = new Terminal({
    cursorBlink: true,
    convertEol: true,
    scrollback: 5000,
    fontSize: terminalFontSize,
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
    clientId: spec.clientId || null,
    sessionType: spec.sessionType || "LOCAL_PTY",
    ssh: cloneSshConfig(spec.ssh),
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
    socket: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    manualClose: false,
    recoveringSnapshot: false,
    currentFontSize: terminalFontSize,
    lastSeenSeq: Number.isFinite(Number(spec.lastSeenSeq)) ? Number(spec.lastSeenSeq) : 0,
    agentRunId: spec.agentRunId || null,
    lastAgentRun: null
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
  persistTabsState();
  return tab;
}

function setConnectionState(tab, state, options = {}) {
  tab.connectionState = state;
  if (Object.hasOwn(options, "lost")) {
    tab.lost = Boolean(options.lost);
  }
  renderTabs();
  persistTabsState();
  renderAgentSidebar();
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
  persistTabsState();
  renderAgentSidebar();
  if (!agentSidebar.classList.contains("hidden")) {
    void refreshCopilotActiveTab({ silent: true });
    startCopilotRefresh();
  }
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
    return false;
  }

  if (tab.connectionState === "exited") {
    return false;
  }

  tab.socket.send(
    JSON.stringify({
      type: "input",
      data
    })
  );
  return true;
}

function resolveQuickKey(command) {
  const normalized = (command || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (/^[0-9]$/.test(normalized)) {
    return { sequence: normalized, label: normalized };
  }

  const directSequence = QUICK_KEY_SEQUENCES.get(normalized);
  if (directSequence) {
    return { sequence: directSequence, label: normalized };
  }

  const keyMatch = normalized.match(/^key\s*:\s*(.+)$/);
  if (!keyMatch) {
    return null;
  }

  const keyName = keyMatch[1].trim();
  if (!keyName) {
    return null;
  }

  if (/^[0-9]$/.test(keyName) || /^[a-z]$/.test(keyName)) {
    return { sequence: keyName, label: `key:${keyName}` };
  }

  const keySequence = QUICK_KEY_SEQUENCES.get(keyName);
  if (!keySequence) {
    return null;
  }
  return { sequence: keySequence, label: `key:${keyName}` };
}

function parseMessage(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearReconnectTimer(tab) {
  if (!tab || !tab.reconnectTimer) {
    return;
  }
  clearTimeout(tab.reconnectTimer);
  tab.reconnectTimer = null;
}

function closeSocket(tab, options = {}) {
  if (!tab.socket) {
    if (options.manual) {
      tab.manualClose = true;
      clearReconnectTimer(tab);
    }
    return;
  }

  if (options.manual) {
    tab.manualClose = true;
    clearReconnectTimer(tab);
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

function buildSessionSocketUrl(tab) {
  const baseUrl = new URL(buildWsUrl(tab.wsUrl), window.location.href);
  baseUrl.searchParams.set("clientId", tab.tabId);
  baseUrl.searchParams.set("lastSeenSeq", String(Math.max(0, Number(tab.lastSeenSeq) || 0)));
  return baseUrl.toString();
}

function reconnectDelay(attempt) {
  const exp = Math.max(0, attempt - 1);
  return Math.min(RECONNECT_MIN_DELAY_MS * (2 ** exp), RECONNECT_MAX_DELAY_MS);
}

function shouldReconnect(tab) {
  return Boolean(
    tab
    && !tab.manualClose
    && !tab.lost
    && tab.sessionId
    && tab.connectionState !== "exited"
  );
}

function scheduleReconnect(tab) {
  if (!shouldReconnect(tab)) {
    return;
  }

  clearReconnectTimer(tab);
  tab.reconnectAttempt += 1;
  const delay = reconnectDelay(tab.reconnectAttempt);

  tab.reconnectTimer = setTimeout(() => {
    tab.reconnectTimer = null;
    if (!tabs.has(tab.tabId) || !shouldReconnect(tab)) {
      return;
    }
    void (async () => {
      const authenticated = await verifyAuthForReconnect();
      if (!authenticated) {
        return;
      }
      if (!tabs.has(tab.tabId) || !shouldReconnect(tab)) {
        return;
      }
      attachSocket(tab);
    })();
  }, delay);
}

async function fetchSnapshot(tab, afterSeq) {
  const response = await apiFetch(
    `/api/sessions/${encodeURIComponent(tab.sessionId)}/snapshot?afterSeq=${encodeURIComponent(afterSeq)}`
  );
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  return response.json();
}

async function recoverFromTruncated(tab, message) {
  if (!tab || !tab.sessionId || tab.recoveringSnapshot) {
    return;
  }

  tab.recoveringSnapshot = true;
  try {
    const requested = Number(message?.requestedAfterSeq);
    const afterSeq = Number.isFinite(requested) ? requested : (Number(tab.lastSeenSeq) || 0);
    const snapshot = await fetchSnapshot(tab, afterSeq);
    if (!snapshot || !Array.isArray(snapshot.chunks)) {
      return;
    }

    snapshot.chunks.forEach((chunk) => {
      const seq = Number(chunk?.seq);
      if (!Number.isFinite(seq) || seq <= tab.lastSeenSeq) {
        return;
      }
      tab.term.write(chunk?.data || "");
      tab.lastSeenSeq = seq;
    });
  } catch (error) {
    tab.term.writeln(`\r\n[snapshot-error] ${error.message}`);
  } finally {
    tab.recoveringSnapshot = false;
  }
}

function attachSocket(tab) {
  if (!tab.wsUrl) {
    setConnectionState(tab, "error");
    return;
  }

  closeSocket(tab);
  setConnectionState(tab, "connecting", { lost: false });

  const socket = new WebSocket(buildSessionSocketUrl(tab));
  tab.socket = socket;

  socket.onopen = () => {
    if (tab.socket !== socket) {
      return;
    }
    tab.reconnectAttempt = 0;
    clearReconnectTimer(tab);
    tab.manualClose = false;
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
      const seq = Number(msg.seq);
      if (Number.isFinite(seq)) {
        if (seq <= tab.lastSeenSeq) {
          return;
        }
        tab.lastSeenSeq = seq;
      }
      tab.term.write(msg.data || "");
      return;
    }

    if (msg.type === "truncated") {
      void recoverFromTruncated(tab, msg);
      return;
    }

    if (msg.type === "exit") {
      tab.exitCode = String(msg.exitCode ?? "-");
      clearReconnectTimer(tab);
      setConnectionState(tab, "exited");
      return;
    }

    if (msg.type === "error") {
      const message = msg.message || "unknown server error";
      tab.term.writeln(`\r\n[server-error] ${message}`);
      if (/Session not found/i.test(message)) {
        tab.lost = true;
        clearReconnectTimer(tab);
        closeSocket(tab, { manual: true });
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
      setConnectionState(tab, "disconnected", { lost: tab.lost });
    }
    scheduleReconnect(tab);
  };

  socket.onerror = () => {
    if (tab.socket !== socket) {
      return;
    }
    // Reconnect is handled by onclose with backoff.
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
  const cols = Math.max(tab.term.cols || 120, 2);
  const rows = Math.max(tab.term.rows || 30, 2);

  const payload = tab.sessionType === "SSH_SHELL"
    ? {
      sessionType: "SSH_SHELL",
      ssh: cloneSshConfig(tab.ssh) || {},
      cols,
      rows
    }
    : {
      sessionType: "LOCAL_PTY",
      toolId: tab.toolId || "terminal",
      tabTitle: tab.title || "",
      cols,
      rows
    };

  if (tab.clientId) {
    payload.clientId = tab.clientId;
    if (tab.workdir) {
      payload.workdir = tab.workdir;
    }
  } else {
    payload.command = tab.command;
    payload.args = tab.args;
    payload.workdir = tab.workdir;
  }

  const response = await apiFetch("/api/sessions", {
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
  tab.lastSeenSeq = 0;
  tab.lost = false;
  tab.manualClose = false;
  tab.reconnectAttempt = 0;
  clearReconnectTimer(tab);
  persistTabsState();
  attachSocket(tab);
}

async function deleteRemoteSession(sessionId) {
  if (!sessionId) {
    return;
  }

  try {
    await apiFetch(`/api/sessions/${sessionId}`, {
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
    clientId: spec.clientId || null,
    sessionType: spec.sessionType || "LOCAL_PTY",
    ssh: cloneSshConfig(spec.ssh),
    command: spec.command,
    args: spec.args,
    workdir: spec.workdir,
    connectionState: "connecting",
    exitCode: "-",
    lost: false
  });

  activateTab(tab.tabId);
  tab.term.writeln(tab.sessionType === "SSH_SHELL"
    ? "Starting SSH shell..."
    : `Starting ${tab.command}...`);

  try {
    await createRemoteSession(tab);
  } catch (error) {
    let message = error.message;
    if (tab.sessionType === "SSH_SHELL" && /SSH credential not found/i.test(message || "")) {
      message = `${message}. Please select a saved SSH config again or create a new one.`;
    }
    tab.term.writeln(`\r\n[create-error] ${message}`);
    setConnectionState(tab, "error");
    showNotice(message, "error", 4200);
  }

  return tab;
}

async function openToolTab(toolId, workdir, advancedOverrides = {}) {
  if (toolId === "ssh") {
    await openTabWithSpec({
      toolId: "ssh",
      title: advancedOverrides.title || "",
      sessionType: "SSH_SHELL",
      ssh: cloneSshConfig(advancedOverrides.ssh),
      command: "",
      args: [],
      workdir: "."
    });
    return;
  }

  if (toolId === "terminal") {
    const preset = BUILTIN_TOOL_PRESETS.terminal;
    await openTabWithSpec({
      toolId: preset.toolId,
      title: advancedOverrides.title || "",
      clientId: null,
      sessionType: "LOCAL_PTY",
      ssh: null,
      command: advancedOverrides.command || preset.command,
      args: Array.isArray(advancedOverrides.args) ? advancedOverrides.args : [...preset.args],
      workdir
    });
    return;
  }

  const client = getTerminalClientById(toolId);
  if (!client) {
    showNotice(`Unknown tool: ${toolId}`, "error");
    return;
  }

  await openTabWithSpec({
    toolId: client.id,
    title: advancedOverrides.title || "",
    clientId: client.id,
    sessionType: "LOCAL_PTY",
    ssh: null,
    command: client.id,
    args: [],
    workdir: workdir || client.defaultWorkdir || "."
  });
}

async function closeTab(tabId, options = {}) {
  const tab = tabs.get(tabId);
  if (!tab) {
    return;
  }
  const shouldDeleteRemote = options.deleteRemote !== false;

  const removedIndex = tabOrder.indexOf(tabId);

  closeSocket(tab, { manual: true });
  clearReconnectTimer(tab);
  if (shouldDeleteRemote && tab.sessionId) {
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
  persistTabsState();
  renderAgentSidebar();
}

async function rebuildTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) {
    return;
  }

  closeSocket(tab, { manual: true });
  clearReconnectTimer(tab);
  if (tab.sessionId) {
    void deleteRemoteSession(tab.sessionId);
  }

  tab.sessionId = null;
  tab.wsUrl = null;
  tab.exitCode = "-";
  tab.lost = false;
  tab.lastSeenSeq = 0;
  tab.manualClose = false;
  tab.reconnectAttempt = 0;
  persistTabsState();
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

function normalizeRemoteConnectionState(state) {
  if (state === "exited") {
    return "exited";
  }
  if (state === "error") {
    return "error";
  }
  return "disconnected";
}

async function fetchSharedSessions() {
  const response = await apiFetch("/api/sessions");
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  return response.json();
}

async function fetchTerminalClients() {
  const response = await apiFetch("/api/terminal/clients");
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  return response.json();
}

async function loadTerminalClients(options = {}) {
  const silent = Boolean(options.silent);
  try {
    const raw = await fetchTerminalClients();
    terminalClientCatalog = Array.isArray(raw)
      ? raw.map((entry) => sanitizeTerminalClient(entry)).filter(Boolean)
      : [];
  } catch (error) {
    terminalClientCatalog = [];
    if (!silent) {
      showNotice(`Failed to load CLI clients: ${error.message}`, "warn", 3200);
    }
  } finally {
    renderToolOptions(toolSelect.value || "terminal");
    applyToolMode(toolSelect.value);
  }
}

function upsertSharedSessionTab(entry) {
  if (!entry || typeof entry !== "object" || !entry.sessionId) {
    return null;
  }
  const sessionId = String(entry.sessionId);
  const sessionType = entry.sessionType === "SSH_SHELL" ? "SSH_SHELL" : "LOCAL_PTY";
  const toolId = typeof entry.toolId === "string" && entry.toolId ? entry.toolId : (sessionType === "SSH_SHELL" ? "ssh" : "terminal");
  const title = typeof entry.title === "string" && entry.title ? entry.title : toolId;
  const workdir = typeof entry.workdir === "string" && entry.workdir ? entry.workdir : ".";
  const wsUrl = typeof entry.wsUrl === "string" && entry.wsUrl ? entry.wsUrl : `/ws/${sessionId}`;
  const remoteState = normalizeRemoteConnectionState(entry.connectionState);
  const inferredClientId = sessionType === "LOCAL_PTY" && toolId !== "terminal" ? toolId : null;

  let tab = findTabBySessionId(sessionId);
  if (!tab) {
    tab = createTab({
      title,
      toolId,
      clientId: inferredClientId,
      sessionType,
      command: toolId,
      args: [],
      workdir,
      sessionId,
      wsUrl,
      connectionState: remoteState,
      exitCode: "-",
      lost: false
    });
  } else {
    tab.title = title;
    tab.toolId = toolId;
    tab.clientId = inferredClientId;
    tab.sessionType = sessionType;
    tab.workdir = workdir;
    tab.wsUrl = wsUrl;
    tab.lost = false;
    if (remoteState === "exited") {
      tab.connectionState = "exited";
    } else if (tab.connectionState !== "connecting" && tab.connectionState !== "connected") {
      tab.connectionState = remoteState;
    }
  }

  if (remoteState === "exited") {
    clearReconnectTimer(tab);
    closeSocket(tab, { manual: true });
    tab.connectionState = "exited";
    return tab;
  }

  if (!tab.socket && tab.sessionId && tab.wsUrl && authState.authenticated) {
    tab.manualClose = false;
    attachSocket(tab);
  }
  return tab;
}

async function syncSharedSessions(options = {}) {
  if (sharedSessionsSyncInFlight) {
    return;
  }
  if (authState.enabled && !authState.authenticated) {
    return;
  }
  sharedSessionsSyncInFlight = true;
  const silent = Boolean(options.silent);
  try {
    const payload = await fetchSharedSessions();
    const rows = Array.isArray(payload) ? payload : [];
    const sessionIds = new Set();

    rows.forEach((entry) => {
      if (!entry || !entry.sessionId) {
        return;
      }
      sessionIds.add(String(entry.sessionId));
      upsertSharedSessionTab(entry);
    });

    for (const tabId of [...tabOrder]) {
      const tab = tabs.get(tabId);
      if (!tab || !tab.sessionId) {
        continue;
      }
      if (sessionIds.has(tab.sessionId)) {
        continue;
      }
      await closeTab(tabId, { deleteRemote: false });
    }

    if (!activeTabId && tabOrder[0]) {
      activateTab(tabOrder[0]);
    }
    renderTabs();
    updateEmptyState();
    renderAgentSidebar();
  } catch (error) {
    if (!silent) {
      showNotice(`Failed to sync sessions: ${error.message}`, "warn", 3200);
    }
  } finally {
    sharedSessionsSyncInFlight = false;
  }
}

function stopSharedSessionsSync() {
  if (!sharedSessionsSyncTimer) {
    return;
  }
  clearInterval(sharedSessionsSyncTimer);
  sharedSessionsSyncTimer = null;
}

function startSharedSessionsSync() {
  stopSharedSessionsSync();
  void syncSharedSessions({ silent: true });
  sharedSessionsSyncTimer = setInterval(() => {
    void syncSharedSessions({ silent: true });
  }, SHARED_SESSIONS_SYNC_MS);
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
  const response = await apiFetch(`/api/workdirTree${query}`);
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
  label.addEventListener("click", async () => {
    selectWorkdir(node.path);
    if (!node.hasChildren) {
      return;
    }
    if (!node.loaded) {
      await loadWorkdir(node.path);
      return;
    }
    if (!node.expanded) {
      node.expanded = true;
      renderWorkdirTree();
    }
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
  const preset = BUILTIN_TOOL_PRESETS[toolId];
  if (!preset) {
    return;
  }

  commandInput.value = preset.command || "";
  argsInput.value = toArgsInput(preset.args);
}

function formatCreatedAt(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
}

function resetSshOverrideInputs() {
  sshHostInput.value = "";
  sshPortInput.value = "";
  sshUsernameInput.value = "";
  sshTermInput.value = "xterm-256color";
}

function resetSshCreateForm() {
  sshCreateHostInput.value = "";
  sshCreatePortInput.value = "22";
  sshCreateUsernameInput.value = "";
  sshCreateAuthTypeSelect.value = "password";
  sshCreatePasswordInput.value = "";
  sshCreatePrivateKeyInput.value = "";
  sshCreatePrivateKeyPassphraseInput.value = "";
  updateSshAuthCreateFields();
}

function resetSshInputs() {
  modalState.selectedSshCredentialId = null;
  sshSelectedCredentialIdLabel.textContent = "-";
  modalState.sshCredentialsError = "";
  resetSshOverrideInputs();
  resetSshCreateForm();
}

function findSshCredentialById(credentialId) {
  return modalState.sshCredentials.find((item) => item.credentialId === credentialId) || null;
}

function setSelectedSshCredential(credentialId, hydrateOverrides = true) {
  modalState.selectedSshCredentialId = credentialId || null;
  sshSelectedCredentialIdLabel.textContent = modalState.selectedSshCredentialId || "-";
  void hydrateOverrides;
  renderSshCredentialList();
}

function renderSshCredentialList() {
  sshCredentialList.innerHTML = "";
  if (modalState.sshCredentialsLoading) {
    const status = document.createElement("div");
    status.className = "tree-status";
    status.textContent = "Loading SSH configs...";
    sshCredentialList.appendChild(status);
    return;
  }

  if (modalState.sshCredentialsError) {
    const status = document.createElement("div");
    status.className = "tree-status error";
    status.textContent = modalState.sshCredentialsError;
    sshCredentialList.appendChild(status);
    return;
  }

  if (!Array.isArray(modalState.sshCredentials) || modalState.sshCredentials.length === 0) {
    const status = document.createElement("div");
    status.className = "tree-status";
    status.textContent = "No saved SSH configs";
    sshCredentialList.appendChild(status);
    return;
  }

  modalState.sshCredentials.forEach((credential) => {
    const row = document.createElement("div");
    row.className = "ssh-credential-row";

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = `ssh-credential-item${modalState.selectedSshCredentialId === credential.credentialId ? " selected" : ""}`;
    selectBtn.title = credential.credentialId;

    const main = document.createElement("div");
    main.className = "ssh-credential-main";
    main.textContent = `${credential.username}@${credential.host}:${credential.port}`;

    const meta = document.createElement("div");
    meta.className = "ssh-credential-meta";
    meta.textContent = `${credential.authType || "UNKNOWN"} | ${credential.credentialId} | ${formatCreatedAt(credential.createdAt)}`;

    selectBtn.appendChild(main);
    selectBtn.appendChild(meta);
    selectBtn.addEventListener("click", () => {
      setSelectedSshCredential(credential.credentialId);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost-btn ssh-delete-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      void handleDeleteSshCredential(credential.credentialId);
    });

    row.appendChild(selectBtn);
    row.appendChild(deleteBtn);
    sshCredentialList.appendChild(row);
  });
}

async function fetchSshCredentials() {
  const response = await apiFetch("/api/ssh/credentials");
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  return response.json();
}

async function createSshCredential(payload) {
  const response = await apiFetch("/api/ssh/credentials", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  return response.json();
}

async function preflightSshCredential(credentialId) {
  const response = await apiFetch(`/api/ssh/credentials/${encodeURIComponent(credentialId)}/preflight`, {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  return response.json();
}

async function deleteSshCredential(credentialId) {
  const response = await apiFetch(`/api/ssh/credentials/${encodeURIComponent(credentialId)}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
}

async function loadSshCredentials(preferredCredentialId = null) {
  modalState.sshCredentialsLoading = true;
  modalState.sshCredentialsError = "";
  renderSshCredentialList();
  try {
    const credentials = await fetchSshCredentials();
    modalState.sshCredentials = Array.isArray(credentials) ? credentials : [];
    const existing = modalState.selectedSshCredentialId;
    const preferred = preferredCredentialId || existing;
    if (preferred && findSshCredentialById(preferred)) {
      setSelectedSshCredential(preferred, false);
    } else if (modalState.sshCredentials.length > 0) {
      setSelectedSshCredential(modalState.sshCredentials[0].credentialId);
    } else {
      setSelectedSshCredential(null, false);
      resetSshOverrideInputs();
    }
  } catch (error) {
    modalState.sshCredentials = [];
    setSelectedSshCredential(null, false);
    modalState.sshCredentialsError = `Failed to load SSH configs: ${error.message}`;
    showNotice(error.message, "error", 4200);
  } finally {
    modalState.sshCredentialsLoading = false;
    renderSshCredentialList();
  }
}

function updateSshAuthCreateFields() {
  const authType = sshCreateAuthTypeSelect.value;
  const isPassword = authType === "password";
  sshCreatePasswordField.classList.toggle("hidden", !isPassword);
  sshCreatePrivateKeyField.classList.toggle("hidden", isPassword);
  sshCreatePrivateKeyPassphraseField.classList.toggle("hidden", isPassword);
}

function applyToolMode(toolId) {
  const isSsh = toolId === "ssh";
  const isTerminal = toolId === "terminal";
  workdirSection.classList.toggle("hidden", isSsh);
  sshSection.classList.toggle("hidden", !isSsh);
  advancedSection.classList.toggle("hidden", !isTerminal);
  if (isSsh) {
    void loadSshCredentials();
  }
}

function buildSshOverrides() {
  const credentialId = modalState.selectedSshCredentialId;
  if (!credentialId) {
    throw new Error("Please select a saved SSH config");
  }
  if (!findSshCredentialById(credentialId)) {
    throw new Error("Selected SSH config no longer exists, please refresh and select again");
  }
  return { credentialId };
}

async function handleDeleteSshCredential(credentialId) {
  const credential = findSshCredentialById(credentialId);
  if (!credential) {
    await loadSshCredentials();
    return;
  }

  const label = `${credential.username}@${credential.host}:${credential.port}`;
  const confirmed = window.confirm(`Delete SSH config ${label} (${credentialId})?`);
  if (!confirmed) {
    return;
  }

  await deleteSshCredential(credentialId);
  if (modalState.selectedSshCredentialId === credentialId) {
    setSelectedSshCredential(null, false);
  }
  await loadSshCredentials();
  showNotice(`Deleted SSH config ${credentialId}`, "success", 2400);
}

async function handleCreateSshCredential() {
  const host = (sshCreateHostInput.value || "").trim();
  const username = (sshCreateUsernameInput.value || "").trim();
  const portRaw = (sshCreatePortInput.value || "").trim();
  const authType = sshCreateAuthTypeSelect.value;

  if (!host) {
    throw new Error("SSH host is required");
  }
  if (!username) {
    throw new Error("SSH username is required");
  }

  const payload = {
    host,
    username
  };

  if (portRaw) {
    const port = Number.parseInt(portRaw, 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error("SSH port must be between 1 and 65535");
    }
    payload.port = port;
  }

  if (authType === "password") {
    const password = sshCreatePasswordInput.value || "";
    if (!password) {
      throw new Error("SSH password is required");
    }
    payload.password = password;
  } else {
    const privateKey = sshCreatePrivateKeyInput.value || "";
    if (!privateKey.trim()) {
      throw new Error("SSH private key is required");
    }
    payload.privateKey = privateKey;
    const passphrase = sshCreatePrivateKeyPassphraseInput.value || "";
    if (passphrase) {
      payload.privateKeyPassphrase = passphrase;
    }
  }

  const created = await createSshCredential(payload);
  resetSshCreateForm();
  await loadSshCredentials(created.credentialId);
  closeSshCreateModal();

  const preflight = await preflightSshCredential(created.credentialId);
  if (preflight?.success) {
    showNotice(`Saved SSH config ${created.credentialId}. Preflight OK.`, "success", 2600);
  } else {
    const reason = preflight?.message || "SSH preflight failed";
    showNotice(`Saved SSH config ${created.credentialId}. ${reason}`, "warn", 4200);
  }
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
  closeSshCreateModal();
  titleInput.value = "";
  resetSshInputs();
  await loadTerminalClients({ silent: true });
  renderToolOptions("terminal");
  applyToolMode("terminal");
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

function openSshCreateModal() {
  sshCreateModal.classList.remove("hidden");
  sshCreateModal.setAttribute("aria-hidden", "false");
  sshCreateHostInput.focus();
}

function closeSshCreateModal() {
  sshCreateModal.classList.add("hidden");
  sshCreateModal.setAttribute("aria-hidden", "true");
}

async function fetchSessionContext(tab) {
  if (!tab?.sessionId) {
    throw new Error("No active session");
  }
  const response = await apiFetch(`/api/sessions/${encodeURIComponent(tab.sessionId)}/context?commandLimit=120&eventLimit=300`);
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  return response.json();
}

async function fetchSessionTranscript(tab) {
  if (!tab?.sessionId) {
    throw new Error("No active session");
  }
  const response = await apiFetch(`/api/sessions/${encodeURIComponent(tab.sessionId)}/transcript?afterSeq=0&stripAnsi=false`);
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  return response.json();
}

async function refreshSessionSummary(options = {}) {
  if (summaryRefreshInFlight) {
    return;
  }
  summaryRefreshInFlight = true;
  const silent = Boolean(options.silent);
  try {
    const tab = getActiveTab();
    if (!tab) {
      if (!silent) {
        showNotice("No active tab", "warn");
      }
      return;
    }
    const [context, transcript] = await Promise.all([
      fetchSessionContext(tab),
      fetchSessionTranscript(tab)
    ]);
    sessionSummaryContextText.value = JSON.stringify(context, null, 2);
    sessionSummaryTranscriptText.value = transcript?.transcript || "";
  } catch (error) {
    if (!silent) {
      showNotice(error.message, "error", 4200);
    }
  } finally {
    summaryRefreshInFlight = false;
  }
}

function parseSelectedPaths() {
  return (agentSelectedPathsInput.value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderAgentSteps(run) {
  agentStepsList.innerHTML = "";
  const steps = Array.isArray(run?.steps) ? run.steps : [];
  if (steps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "tree-status";
    empty.textContent = "No steps";
    agentStepsList.appendChild(empty);
    return;
  }

  steps.forEach((step) => {
    const item = document.createElement("div");
    item.className = "agent-step-item";
    const head = document.createElement("div");
    head.className = "agent-step-head";
    head.textContent = `#${step.stepIndex} ${step.tool}`;
    const status = document.createElement("span");
    status.textContent = step.status;
    head.appendChild(status);
    item.appendChild(head);

    const body = document.createElement("div");
    body.className = "agent-step-body";
    const lines = [];
    if (step.title) {
      lines.push(step.title);
    }
    if (step.highRisk) {
      lines.push("[high-risk]");
    }
    if (step.error) {
      lines.push(`error: ${step.error}`);
    }
    if (step.resultSummary) {
      lines.push(step.resultSummary);
    }
    if (!step.error && !step.resultSummary && step.arguments) {
      lines.push(JSON.stringify(step.arguments));
    }
    body.textContent = lines.join("\n");
    item.appendChild(body);
    agentStepsList.appendChild(item);
  });
}

function renderAgentSidebar() {
  const tab = getActiveTab();
  if (!tab) {
    agentSessionLabel.textContent = "-";
    agentRunStatus.textContent = "No active tab";
    agentStepsList.innerHTML = "";
    return;
  }
  if (!authState.authenticated) {
    agentSessionLabel.textContent = "-";
    agentRunStatus.textContent = "Login required";
    agentStepsList.innerHTML = "";
    return;
  }
  agentSessionLabel.textContent = tab.sessionId || "-";
  if (!tab.lastAgentRun) {
    agentRunStatus.textContent = tab.agentRunId
      ? `runId=${tab.agentRunId}`
      : "No run";
    agentStepsList.innerHTML = "";
    if (tab.agentRunId) {
      void refreshAgentRun(tab).catch(() => {});
    }
    return;
  }
  const run = tab.lastAgentRun;
  agentRunStatus.textContent = `${run.status} | ${run.message || ""}`.trim();
  renderAgentSteps(run);
}

async function refreshAgentRun(tab) {
  if (!tab?.sessionId || !tab.agentRunId) {
    return null;
  }
  const response = await apiFetch(`/api/sessions/${encodeURIComponent(tab.sessionId)}/agent/runs/${encodeURIComponent(tab.agentRunId)}`);
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  const run = await response.json();
  tab.lastAgentRun = run;
  persistTabsState();
  renderAgentSidebar();
  return run;
}

async function createAgentRunForTab(tab) {
  if (!tab?.sessionId) {
    throw new Error("No active session");
  }

  const response = await apiFetch(`/api/sessions/${encodeURIComponent(tab.sessionId)}/agent/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      instruction: (agentInstructionInput.value || "").trim(),
      selectedPaths: parseSelectedPaths(),
      includeGitDiff: true
    })
  });
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  const run = await response.json();
  tab.agentRunId = run.runId;
  tab.lastAgentRun = run;
  persistTabsState();
  renderAgentSidebar();
  return run;
}

async function approveAgentRun(tab, confirmRisk = false) {
  if (!tab?.sessionId || !tab.agentRunId) {
    throw new Error("No agent run for this tab");
  }
  const response = await apiFetch(
    `/api/sessions/${encodeURIComponent(tab.sessionId)}/agent/runs/${encodeURIComponent(tab.agentRunId)}/approve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmRisk })
    }
  );
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  const run = await response.json();
  tab.lastAgentRun = run;
  persistTabsState();
  renderAgentSidebar();
  return run;
}

async function abortAgentRun(tab) {
  if (!tab?.sessionId || !tab.agentRunId) {
    throw new Error("No agent run for this tab");
  }
  const response = await apiFetch(
    `/api/sessions/${encodeURIComponent(tab.sessionId)}/agent/runs/${encodeURIComponent(tab.agentRunId)}/abort`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "aborted from sidebar" })
    }
  );
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }
  const run = await response.json();
  tab.lastAgentRun = run;
  persistTabsState();
  renderAgentSidebar();
  return run;
}

async function sendQuickCommand(tab) {
  if (!tab?.sessionId) {
    throw new Error("No active session");
  }
  const command = (agentQuickCommandInput.value || "").trim();
  if (!command) {
    throw new Error("Quick command is empty");
  }

  const quickKey = resolveQuickKey(command);
  const payload = quickKey ? quickKey.sequence : `${command}\n`;
  const sent = sendInput(tab, payload);
  if (!sent) {
    throw new Error("Terminal is not connected");
  }
  if (quickKey) {
    tab.term.writeln(`\r\n[quick-key] ${quickKey.label}`);
  } else {
    tab.term.writeln(`\r\n[quick-send] ${command}`);
  }
  tab.term.focus();
  agentQuickCommandInput.value = "";
}

function renderCopilotPanels() {
  const isSummary = copilotActiveTab === "summary";
  copilotSummaryTabBtn.classList.toggle("active", isSummary);
  copilotAgentTabBtn.classList.toggle("active", !isSummary);
  copilotSummaryPanel.classList.toggle("hidden", !isSummary);
  copilotAgentPanel.classList.toggle("hidden", isSummary);
}

async function refreshCopilotActiveTab(options = {}) {
  const silent = Boolean(options.silent);
  if (copilotActiveTab === "summary") {
    await refreshSessionSummary({ silent });
    return;
  }

  const tab = getActiveTab();
  if (!tab?.agentRunId) {
    if (!silent) {
      showNotice("No agent run for this tab", "warn");
    }
    return;
  }
  if (agentRefreshInFlight) {
    return;
  }

  agentRefreshInFlight = true;
  try {
    await refreshAgentRun(tab);
  } catch (error) {
    if (!silent) {
      showNotice(error.message, "error", 4200);
    }
  } finally {
    agentRefreshInFlight = false;
  }
}

function stopCopilotRefresh() {
  if (!copilotRefreshTimer) {
    return;
  }
  clearInterval(copilotRefreshTimer);
  copilotRefreshTimer = null;
}

function startCopilotRefresh() {
  stopCopilotRefresh();
  if (agentSidebar.classList.contains("hidden") || !authState.authenticated) {
    return;
  }
  copilotRefreshTimer = setInterval(() => {
    void refreshCopilotActiveTab({ silent: true });
  }, COPILOT_REFRESH_MS);
}

function setCopilotTab(tabName) {
  copilotActiveTab = tabName === "agent" ? "agent" : "summary";
  renderCopilotPanels();
  void refreshCopilotActiveTab({ silent: true });
}

function isMobileCopilotMode() {
  return isMobileViewport();
}

function openCopilotMobileModal() {
  agentSidebar.classList.remove("hidden");
  agentSidebar.setAttribute("aria-hidden", "false");
  agentSidebar.setAttribute("aria-modal", "true");
  if (copilotMobileBackdrop) {
    copilotMobileBackdrop.classList.remove("hidden");
    copilotMobileBackdrop.setAttribute("aria-hidden", "false");
  }
  copilotPanelToggleBtn.setAttribute("aria-expanded", "true");
  renderCopilotPanels();
  renderAgentSidebar();
  void refreshCopilotActiveTab({ silent: true });
  startCopilotRefresh();
  scheduleActiveFit(20);
}

function closeCopilotMobileModal() {
  agentSidebar.classList.add("hidden");
  agentSidebar.setAttribute("aria-hidden", "true");
  agentSidebar.removeAttribute("aria-modal");
  if (copilotMobileBackdrop) {
    copilotMobileBackdrop.classList.add("hidden");
    copilotMobileBackdrop.setAttribute("aria-hidden", "true");
  }
  copilotPanelToggleBtn.setAttribute("aria-expanded", "false");
  stopCopilotRefresh();
  scheduleActiveFit(20);
}

function syncCopilotPresentationMode() {
  const isMobile = isMobileCopilotMode();
  const isOpen = !agentSidebar.classList.contains("hidden");
  if (!isMobile) {
    if (copilotMobileBackdrop) {
      copilotMobileBackdrop.classList.add("hidden");
      copilotMobileBackdrop.setAttribute("aria-hidden", "true");
    }
    agentSidebar.removeAttribute("aria-modal");
    agentSidebar.setAttribute("aria-hidden", isOpen ? "false" : "true");
    copilotPanelToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    if (isOpen) {
      startCopilotRefresh();
    } else {
      stopCopilotRefresh();
    }
    return;
  }
  if (isOpen) {
    agentSidebar.setAttribute("aria-hidden", "false");
    agentSidebar.setAttribute("aria-modal", "true");
    if (copilotMobileBackdrop) {
      copilotMobileBackdrop.classList.remove("hidden");
      copilotMobileBackdrop.setAttribute("aria-hidden", "false");
    }
    copilotPanelToggleBtn.setAttribute("aria-expanded", "true");
    startCopilotRefresh();
    return;
  }
  agentSidebar.setAttribute("aria-hidden", "true");
  agentSidebar.removeAttribute("aria-modal");
  if (copilotMobileBackdrop) {
    copilotMobileBackdrop.classList.add("hidden");
    copilotMobileBackdrop.setAttribute("aria-hidden", "true");
  }
  copilotPanelToggleBtn.setAttribute("aria-expanded", "false");
  stopCopilotRefresh();
}

function toggleCopilotSidebar() {
  if (isMobileCopilotMode()) {
    if (agentSidebar.classList.contains("hidden")) {
      openCopilotMobileModal();
    } else {
      closeCopilotMobileModal();
    }
    return;
  }
  agentSidebar.classList.toggle("hidden");
  const isOpen = !agentSidebar.classList.contains("hidden");
  agentSidebar.setAttribute("aria-hidden", isOpen ? "false" : "true");
  copilotPanelToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  if (!isOpen) {
    stopCopilotRefresh();
  } else {
    agentSidebar.removeAttribute("aria-modal");
    renderCopilotPanels();
    void refreshCopilotActiveTab({ silent: true });
    startCopilotRefresh();
  }
  if (copilotMobileBackdrop) {
    copilotMobileBackdrop.classList.add("hidden");
    copilotMobileBackdrop.setAttribute("aria-hidden", "true");
  }
  renderAgentSidebar();
  scheduleActiveFit(20);
}

function bindEvents() {
  renderMobileShortcutKeys();
  renderToolOptions("terminal");
  setMobileShortcutsExpanded(false);
  syncMobileViewportHeight();
  syncCopilotPresentationMode();

  mobileShortcutToggleBtn?.addEventListener("click", () => {
    setMobileShortcutsExpanded(!mobileShortcutsExpanded);
  });

  copilotMobileBackdrop?.addEventListener("click", () => {
    if (isMobileCopilotMode() && !agentSidebar.classList.contains("hidden")) {
      closeCopilotMobileModal();
    }
  });

  mobileShortcutKeys?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const button = target.closest("button.mobile-shortcut-key");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const action = button.dataset.action;
    if (action === "collapse") {
      setMobileShortcutsExpanded(false);
      return;
    }
    const sequence = button.dataset.seq;
    if (!sequence) {
      return;
    }
    sendMobileShortcut(sequence);
  });

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      try {
        const ok = await loginWithForm();
        if (ok) {
          initializeApp();
        }
      } catch (error) {
        showLoginError(error.message || "Login failed");
      }
    })();
  });

  logoutBtn.addEventListener("click", () => {
    void logout();
  });

  copilotPanelToggleBtn.addEventListener("click", () => {
    toggleCopilotSidebar();
  });

  copilotSummaryTabBtn.addEventListener("click", () => {
    setCopilotTab("summary");
    startCopilotRefresh();
  });

  copilotAgentTabBtn.addEventListener("click", () => {
    setCopilotTab("agent");
    startCopilotRefresh();
  });

  toolSelect.addEventListener("change", () => {
    applyToolMode(toolSelect.value);
    if (toolSelect.value === "terminal") {
      applyToolPresetToAdvanced(toolSelect.value);
    }
  });

  sshRefreshCredentialsBtn.addEventListener("click", () => {
    void loadSshCredentials();
  });

  sshOpenCreateModalBtn.addEventListener("click", () => {
    openSshCreateModal();
  });

  sshCreateAuthTypeSelect.addEventListener("change", () => {
    updateSshAuthCreateFields();
  });

  sshCreateCredentialBtn.addEventListener("click", () => {
    void (async () => {
      try {
        await handleCreateSshCredential();
      } catch (error) {
        showNotice(error.message, "error", 4200);
      }
    })();
  });

  cancelSshCreateBtn.addEventListener("click", () => {
    closeSshCreateModal();
  });

  sshCreateModal.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.closeSshCreateModal === "true") {
      closeSshCreateModal();
    }
  });

  sshCreateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sshCreateCredentialBtn.click();
  });

  refreshSessionSummaryBtn.addEventListener("click", () => {
    void refreshSessionSummary();
  });

  copySessionContextBtn.addEventListener("click", () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(sessionSummaryContextText.value || "");
        showNotice("Copied context JSON", "success", 1800);
      } catch {
        showNotice("Copy failed in this browser context", "warn", 2600);
      }
    })();
  });

  copySessionTranscriptBtn.addEventListener("click", () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(sessionSummaryTranscriptText.value || "");
        showNotice("Copied transcript", "success", 1800);
      } catch {
        showNotice("Copy failed in this browser context", "warn", 2600);
      }
    })();
  });

  agentStartRunBtn.addEventListener("click", () => {
    const tab = getActiveTab();
    if (!tab) {
      showNotice("No active tab", "warn");
      return;
    }
    void (async () => {
      try {
        const run = await createAgentRunForTab(tab);
        showNotice(`Agent run created: ${run.runId}`, "success", 2400);
      } catch (error) {
        showNotice(error.message, "error", 4200);
      }
    })();
  });

  agentRefreshBtn.addEventListener("click", () => {
    const tab = getActiveTab();
    if (!tab) {
      showNotice("No active tab", "warn");
      return;
    }
    void (async () => {
      try {
        await refreshAgentRun(tab);
      } catch (error) {
        showNotice(error.message, "error", 4200);
      }
    })();
  });

  agentApproveBtn.addEventListener("click", () => {
    const tab = getActiveTab();
    if (!tab) {
      showNotice("No active tab", "warn");
      return;
    }
    void (async () => {
      try {
        await approveAgentRun(tab, false);
      } catch (error) {
        showNotice(error.message, "error", 4200);
      }
    })();
  });

  agentApproveRiskBtn.addEventListener("click", () => {
    const tab = getActiveTab();
    if (!tab) {
      showNotice("No active tab", "warn");
      return;
    }
    void (async () => {
      try {
        await approveAgentRun(tab, true);
      } catch (error) {
        showNotice(error.message, "error", 4200);
      }
    })();
  });

  agentAbortBtn.addEventListener("click", () => {
    const tab = getActiveTab();
    if (!tab) {
      showNotice("No active tab", "warn");
      return;
    }
    void (async () => {
      try {
        await abortAgentRun(tab);
      } catch (error) {
        showNotice(error.message, "error", 4200);
      }
    })();
  });

  agentQuickSendBtn.addEventListener("click", () => {
    const tab = getActiveTab();
    if (!tab) {
      showNotice("No active tab", "warn");
      return;
    }
    void (async () => {
      try {
        await sendQuickCommand(tab);
      } catch (error) {
        showNotice(error.message, "error", 4200);
      }
    })();
  });

  agentQuickCommandInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    agentQuickSendBtn.click();
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
    const workdir = modalState.selectedPath || ".";
    if (toolId !== "ssh" && !modalState.selectedPath) {
      showNotice("Please choose a workdir", "warn");
      return;
    }

    const advancedOverrides = {};
    const title = (titleInput.value || "").trim();
    if (title) {
      advancedOverrides.title = title;
    }

    if (toolId === "ssh") {
      try {
        advancedOverrides.sessionType = "SSH_SHELL";
        advancedOverrides.ssh = buildSshOverrides();
      } catch (error) {
        showNotice(error.message, "error", 4200);
        return;
      }
    }

    if (toolId === "terminal") {
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
    }

    closeNewWindowModal();
    void openToolTab(toolId, workdir, advancedOverrides);
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
      if (!sshCreateModal.classList.contains("hidden")) {
        closeSshCreateModal();
        return;
      }
      if (!newWindowModal.classList.contains("hidden")) {
        closeNewWindowModal();
        return;
      }
      if (isMobileCopilotMode() && !agentSidebar.classList.contains("hidden")) {
        closeCopilotMobileModal();
        return;
      }
      closeTabContextMenu();
    }
  });

  window.addEventListener("resize", () => {
    syncMobileViewportHeight();
    syncCopilotPresentationMode();
    closeTabContextMenu();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      syncTerminalFontSizes();
      const active = getActiveTab();
      if (active) {
        fitAndResize(active);
      }
    }, 140);
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      syncMobileViewportHeight();
    });
    window.visualViewport.addEventListener("scroll", () => {
      syncMobileViewportHeight();
    });
  }

  window.addEventListener("beforeunload", () => {
    stopCopilotRefresh();
    stopSharedSessionsSync();
    persistTabsState();
    tabOrder.forEach((tabId) => {
      const tab = tabs.get(tabId);
      if (!tab) {
        return;
      }
      closeSocket(tab, { manual: true });
    });
  });

  if (typeof ResizeObserver !== "undefined") {
    layoutObserver = new ResizeObserver(() => {
      scheduleActiveFit(30);
    });
    layoutObserver.observe(terminalArea);
  }

  renderCopilotPanels();
}

function initializeApp() {
  if (appInitialized) {
    startSharedSessionsSync();
    void loadTerminalClients({ silent: true });
    renderAgentSidebar();
    startCopilotRefresh();
    return;
  }
  renderToolOptions("terminal");
  renderTabs();
  updateEmptyState();
  renderAgentSidebar();
  renderCopilotPanels();
  void loadTerminalClients({ silent: true });
  startSharedSessionsSync();
  startCopilotRefresh();
  appInitialized = true;
}

async function bootstrap() {
  bindEvents();
  try {
    await fetchAuthStatus();
  } catch (error) {
    showLoginError(`Auth check failed: ${error.message}`);
    authState = {
      enabled: true,
      authenticated: false,
      username: AUTH_DISABLED_USERNAME
    };
    renderAuthGate();
    return;
  }

  if (authState.enabled) {
    showLoginError("");
    if (authState.authenticated) {
      initializeApp();
      return;
    }
    return;
  }

  if (!authState.enabled) {
    initializeApp();
  }
}

void bootstrap();
