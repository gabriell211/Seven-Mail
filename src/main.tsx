import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { applyTheme, savedTheme } from "./lib/theme";

// Set before React mounts to avoid a light flash during launch or unlock.
applyTheme(savedTheme(),window.matchMedia("(prefers-color-scheme: dark)").matches);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
