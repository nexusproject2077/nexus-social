// nexus-social/app/frontend/src/index.js

import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css"; // ✅ Correction : Chemin relatif pour le CSS
import "./i18n"; // Initialisation de l'internationalisation (react-i18next)
import App from "./App"; // ✅ Correction : Chemin relatif pour le composant App

// Repère de VERSION : permet de confirmer en un coup d'œil (console) quelle
// version du frontend tourne réellement (diagnostic cache/déploiement).
// eslint-disable-next-line no-console
console.log("🟢 NEXUS build = story-delete-v2 (2026-08-13)");

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Enregistre le service worker (nécessaire aux notifications push). Le SW ne
// met plus rien en cache (voir public/service-worker.js). Best-effort.
if ("serviceWorker" in navigator) {
  // Quand un nouveau SW prend la main (ex. remplacement de l'ancien SW qui
  // servait du cache périmé), on recharge UNE fois pour repartir sur du réseau
  // frais. Le drapeau évite toute boucle.
  let swReloaded = false;
  // Vrai si un SW contrôlait déjà la page (donc c'est une MISE À JOUR, ex. le
  // remplacement de l'ancien SW à cache). On ne recharge que dans ce cas — pas
  // à la toute première installation.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (swReloaded || !hadController) return;
    swReloaded = true;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").then((reg) => {
      // Force la vérification d'une mise à jour du SW à chaque chargement.
      try { reg.update(); } catch (e) { /* ignore */ }
    }).catch(() => {});
  });
}
