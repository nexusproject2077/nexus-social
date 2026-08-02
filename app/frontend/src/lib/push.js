// ─────────────────────────────────────────────────────────────────────────────
// Web Push côté navigateur : enregistrement du service worker + abonnement
// push (clé VAPID récupérée du backend). Tout est best-effort et silencieux :
// si le navigateur ne supporte pas le push, ou si le serveur n'est pas
// configuré (VAPID absent), on ne fait rien — l'in-app + le temps réel
// WebSocket continuent de fonctionner.
// ─────────────────────────────────────────────────────────────────────────────
import axios from "axios";
import { API } from "@/App";

const pushSupported = () =>
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  typeof window !== "undefined" &&
  "PushManager" in window &&
  "Notification" in window;

// Enregistre le service worker (idempotent). Renvoie l'enregistrement ou null.
export async function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/service-worker.js");
  } catch {
    return null;
  }
}

// Convertit la clé publique VAPID (base64url) en Uint8Array attendu par l'API.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Abonne le navigateur au push et enregistre l'abonnement côté serveur.
// `interactive` = true autorise la demande de permission (à déclencher sur une
// action utilisateur) ; false = ré-abonnement silencieux si déjà autorisé.
// Renvoie true si l'abonnement est actif.
export async function enablePush({ interactive = false } = {}) {
  try {
    if (!pushSupported()) return false;
    if (Notification.permission === "denied") return false;
    if (!interactive && Notification.permission !== "granted") return false;

    // Le serveur doit être configuré (clé VAPID présente).
    const { data } = await axios.get(`${API}/push/vapid-public-key`);
    if (!data?.enabled || !data?.public_key) return false;

    if (Notification.permission !== "granted") {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return false;
    }

    const reg = (await navigator.serviceWorker.ready) || (await registerServiceWorker());
    if (!reg?.pushManager) return false;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.public_key),
      });
    }
    await axios.post(`${API}/push/subscribe`, { subscription: sub.toJSON() });
    return true;
  } catch {
    return false;
  }
}

// Désabonne le navigateur courant (et prévient le serveur).
export async function disablePush() {
  try {
    if (!pushSupported()) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await axios.post(`${API}/push/unsubscribe`, { subscription: sub.toJSON() }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {
    /* ignore */
  }
}

// True si un abonnement push est déjà actif sur ce navigateur.
export async function isPushEnabled() {
  try {
    if (!pushSupported() || Notification.permission !== "granted") return false;
    const reg = await navigator.serviceWorker.ready;
    return !!(await reg.pushManager.getSubscription());
  } catch {
    return false;
  }
}
