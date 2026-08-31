// Suivi du temps passé sur l'app AUJOURD'HUI (bien-être numérique).
//
// Le compteur est SYNCHRONISÉ entre tous les appareils du même compte : chaque
// appareil compte localement (même hors ligne), puis pousse régulièrement son
// delta au serveur qui agrège le total du jour. Le total affiché = agrégat
// serveur (tous appareils) + secondes locales pas encore poussées. Ainsi
// « 30 min sur le téléphone » et « 10 min sur le PC » donnent 40 min partout.
//
// Si le serveur est injoignable, on retombe proprement sur le compteur local
// (comportement identique à l'ancien suivi 100 % local).

import axios from "axios";
import { isPrivacyStrict } from "@/lib/privacyStrict";

export function dayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const K_LOCAL = () => `nexus_screen_${dayStr()}`; // secondes comptées sur CET appareil
const K_SYNCED = () => `nexus_screen_synced_${dayStr()}`; // secondes locales déjà envoyées
const K_SERVER = () => `nexus_screen_server_${dayStr()}`; // dernier total serveur connu

function num(k) {
  try {
    return parseFloat(localStorage.getItem(k) || "0") || 0;
  } catch {
    return 0;
  }
}

function put(k, v) {
  try {
    localStorage.setItem(k, String(v));
  } catch {
    /* stockage indisponible (navigation privée) → best-effort */
  }
}

// Secondes brutes comptées localement aujourd'hui (sert au calcul du delta).
export function getLocalSeconds() {
  return num(K_LOCAL());
}

export function addSeconds(s) {
  put(K_LOCAL(), getLocalSeconds() + s);
}

// Total du jour affiché : agrégat serveur + delta local pas encore poussé.
export function getTodaySeconds() {
  const unsynced = Math.max(0, getLocalSeconds() - num(K_SYNCED()));
  return num(K_SERVER()) + unsynced;
}

export function getTodayMinutes() {
  return getTodaySeconds() / 60;
}

let inFlight = false;

// Pousse le delta local au serveur et récupère l'agrégat multi-appareils.
// `apiBase` = préfixe API (ex. `${API}`). Retourne le total du jour (secondes).
export async function syncScreenTime(apiBase) {
  // Mode Confidentialité stricte : on n'envoie RIEN au serveur (cohérent avec
  // useTimeTracking) → le compteur reste local à cet appareil.
  if (inFlight || !apiBase || isPrivacyStrict()) return getTodaySeconds();
  inFlight = true;
  const day = dayStr();
  try {
    const local = getLocalSeconds();
    const delta = Math.max(0, Math.round(local - num(K_SYNCED())));
    let total;
    if (delta > 0) {
      const r = await axios.post(`${apiBase}/users/me/screen-time`, {
        day,
        delta_seconds: delta,
      });
      total = Number(r.data?.seconds);
      put(K_SYNCED(), local); // le delta est acquitté par le serveur
    } else {
      const r = await axios.get(`${apiBase}/users/me/screen-time`, {
        params: { day },
      });
      total = Number(r.data?.seconds);
    }
    if (Number.isFinite(total)) put(K_SERVER(), total);
    return getTodaySeconds();
  } catch {
    return getTodaySeconds(); // serveur indisponible → total local
  } finally {
    inFlight = false;
  }
}
