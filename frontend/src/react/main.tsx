import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles.css";

const legacyLoginGate = document.getElementById("loginGate");
const legacyAppRoot = document.getElementById("app");
legacyLoginGate?.classList.add("hidden");
legacyAppRoot?.classList.add("hidden");

let reactRoot = document.getElementById("reactRoot");
if (!reactRoot) {
  reactRoot = document.createElement("div");
  reactRoot.id = "reactRoot";
  document.body.appendChild(reactRoot);
}
reactRoot.classList.remove("hidden");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1
    }
  }
});

ReactDOM.createRoot(reactRoot).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
