import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
    throw new Error("Root element #root not found");
}

createRoot(rootEl).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);

// Register a simple Service Worker for offline support in production/preview
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/sw.js")
            .catch((err) => console.error("SW registration failed:", err));
    });
}
