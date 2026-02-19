const uiMode = typeof import.meta.env.VITE_UI_MODE === "string"
  ? import.meta.env.VITE_UI_MODE.trim().toLowerCase()
  : "legacy";

if (uiMode === "react") {
  import("./react/main.tsx");
} else {
  import("./main-legacy.js");
}
