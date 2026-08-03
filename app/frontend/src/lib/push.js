// Web Push — enregistrement du Service Worker + abonnement PushManager.
// Fonctionne « app fermée » (Android/Chrome/Firefox/Edge, et iOS 16.4+ SI le
// site est installé sur l'écran d'accueil). Best-effort partout : aucune de
// ces fonctions ne jette, elles renvoient un état exploitable par l'UI.
//
// API unifiée (deux écrans la consomment) :
//   • NotificationSettings (modale par type) → getPushState / enablePush / disablePush
//   • SettingsPage (réglages)                → isPushEnabled / enablePush({interactive}) / pushReasonLabel
import axios from "axios";
import { API } from "@/App";

// Le navigateur supporte-t-il le push web ?
export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

// iOS n'autorise le push que pour une app installée (standalone). On détecte
// aussi le mode standalone pour afficher le bon message d'aide.
export function isStandalone() {
  return (
    (typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    (typeof navigator !== "undefined" && navigator.standalone === true)
  );
}

export function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/(Macintosh)/.test(ua) && "ontouchend" in document);
}

// Clé publique VAPID base64url → Uint8Array (format applicationServerKey).
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let _swReg = null;

// Enregistre le Service Worker (idempotent). Renvoie l'enregistrement ou null.
export async function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    if (_swReg) return _swReg;
    _swReg = await navigator.serviceWorker.register("/service-worker.js");
    return _swReg;
  } catch (e) {
    return null;
  }
}

// État courant de l'abonnement : { supported, permission, subscribed, standalone, ios }
export async function getPushState() {
  const base = {
    supported: pushSupported(),
    permission: typeof Notification !== "undefined" ? Notification.permission : "denied",
    subscribed: false,
    standalone: isStandalone(),
    ios: isIOS(),
  };
  if (!base.supported) return base;
  try {
    const reg = await registerServiceWorker();
    if (reg) {
      const sub = await reg.pushManager.getSubscription();
      base.subscribed = !!sub;
    }
  } catch (e) { /* ignore */ }
  return base;
}

// Booléen simple : l'appareil est-il abonné au push ? (utilisé par SettingsPage)
export async function isPushEnabled() {
  const st = await getPushState();
  return !!st.subscribed;
}

// Active le push : (option interactive) demande la permission, s'abonne au
// PushManager avec la clé VAPID du serveur, puis enregistre l'abonnement backend.
// `interactive` = true (défaut) autorise la demande de permission (à déclencher
// sur une action utilisateur) ; false = ré-abonnement silencieux si déjà autorisé.
// Renvoie { ok: true } ou { ok: false, reason }.
export async function enablePush({ interactive = true } = {}) {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  // Sur iOS, exige l'installation sur l'écran d'accueil.
  if (isIOS() && !isStandalone()) return { ok: false, reason: "ios-install" };

  let permission = Notification.permission;
  if (permission === "default") {
    if (!interactive) return { ok: false, reason: "denied" }; // pas de prompt en silencieux
    try {
      permission = await Notification.requestPermission();
    } catch (e) {
      permission = Notification.permission;
    }
  }
  if (permission !== "granted") return { ok: false, reason: "denied" };

  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, reason: "no-sw" };
  // Le SW doit être actif avant de s'abonner.
  try { await navigator.serviceWorker.ready; } catch (e) { /* ignore */ }

  let key;
  try {
    const r = await axios.get(`${API}/push/vapid-public-key`);
    key = r.data?.public_key;
  } catch (e) {
    return { ok: false, reason: "no-key" };
  }
  if (!key) return { ok: false, reason: "no-key" };

  let sub;
  try {
    sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
  } catch (e) {
    return { ok: false, reason: "subscribe-failed" };
  }

  try {
    await axios.post(`${API}/push/subscribe`, { subscription: sub.toJSON() });
  } catch (e) {
    return { ok: false, reason: "backend-failed" };
  }
  return { ok: true };
}

// Désactive le push : désabonnement local + suppression côté backend.
export async function disablePush() {
  try {
    const reg = await registerServiceWorker();
    if (!reg) return { ok: true };
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      try {
        await axios.post(`${API}/push/unsubscribe`, { subscription: sub.toJSON() });
      } catch (e) { /* ignore */ }
      await sub.unsubscribe();
    }
  } catch (e) { /* ignore */ }
  return { ok: true };
}

// Libellés FR de chaque cause de succès/échec (toasts clairs). Couvre les codes
// des deux écrans (unifiés).
export function pushReasonLabel(reason) {
  return {
    ok: "Notifications push activées",
    unsupported: "Ce navigateur ne prend pas en charge les notifications push",
    "ios-install": "Sur iPhone/iPad : ajoutez d'abord Nexus à l'écran d'accueil",
    denied: "Notifications bloquées dans les réglages du navigateur",
    "no-sw": "Service worker indisponible",
    "no-key": "Serveur de notifications indisponible (réessayez plus tard)",
    "subscribe-failed": "Échec de l'abonnement push",
    "backend-failed": "Échec de l'enregistrement, réessayez",
  }[reason] || "Notifications push indisponibles pour le moment";
}
