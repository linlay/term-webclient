const uiMode = typeof import.meta.env.VITE_UI_MODE === "string"
  ? import.meta.env.VITE_UI_MODE.trim().toLowerCase()
  : "legacy";

if (window.location.pathname === "/") {
  window.location.replace("/term");
}

if (uiMode === "react") {
  import("./react/main.tsx");
} else {
  import("./main-legacy.js");
}
