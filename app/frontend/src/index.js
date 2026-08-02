// nexus-social/app/frontend/src/index.js

import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css"; // ✅ Correction : Chemin relatif pour le CSS
import "./i18n"; // Initialisation de l'internationalisation (react-i18next)
import App from "./App"; // ✅ Correction : Chemin relatif pour le composant App

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Enregistre le service worker (push + offline). Best-effort : sans lui, le
// handler `push` du SW ne peut jamais s'activer.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}
