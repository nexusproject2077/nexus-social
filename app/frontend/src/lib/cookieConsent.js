// Consentement aux traceurs : le choix est conservé localement (nécessaire pour
// ne pas redemander la bannière) et sa preuve minimale est envoyée au serveur.
// Aucun identifiant publicitaire, adresse IP ou fingerprint n'est ajouté ici.
import axios from "axios";

export const COOKIE_CONSENT_EVENT = "nexus-cookie-consent-changed";
export const COOKIE_CONSENT_VERSION = "2026-11-05";
const KEY = "nexus_cookie_consent";
const LEGACY_KEY = "cookie_consent";
const MAX_AGE_MS = 183 * 24 * 60 * 60 * 1000; // bonne pratique CNIL : environ six mois
const API = `${process.env.REACT_APP_BACKEND_URL || "https://nexus-social-api-ts.merickoken54.workers.dev"}/api`;

const safeStorage = () => { try { return window.localStorage; } catch { return null; } };
const newId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function getCookieConsent() {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(KEY) || "null");
    if (value?.version === COOKIE_CONSENT_VERSION && ["accepted", "rejected"].includes(value.choice) && Date.parse(value.expires_at) > Date.now()) return value;
  } catch { /* legacy or malformed preference */ }
  return null;
}

function setPostHog(enabled) {
  const posthog = window.posthog;
  if (!enabled) {
    // Ne pas appeler le stub avant son initialisation : cela mettrait une
    // commande en file d'attente alors que l'utilisateur vient de refuser.
    if (window.__nexusPostHogStarted) {
      try { posthog?.opt_out_capturing?.(); posthog?.reset?.(); } catch { /* tracker may not be loaded */ }
    }
    return;
  }
  if (!posthog) return;
  if (window.__nexusPostHogStarted) {
    try { posthog.opt_in_capturing?.(); } catch { /* tracker may be unavailable */ }
    return;
  }
  window.__nexusPostHogStarted = true;
  posthog.init("phc_yJW1VjHGGwmCbbrtczfqqNxgBDbhlhOWcdzcIJEOTFE", {
    api_host: "https://us.i.posthog.com",
    person_profiles: "identified_only",
    autocapture: false,
    capture_pageview: true,
  });
}

export function applyCookieConsent(value) {
  setPostHog(value?.choice === "accepted");
}

export async function setCookieConsent(choice) {
  if (!["accepted", "rejected"].includes(choice)) return null;
  const storage = safeStorage();
  const now = new Date();
  const prior = getCookieConsent();
  const record = {
    id: prior?.id || newId(),
    choice,
    version: COOKIE_CONSENT_VERSION,
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + MAX_AGE_MS).toISOString(),
  };
  try {
    storage?.setItem(KEY, JSON.stringify(record));
    // Ancienne clé supprimée : elle ne contient ni version ni date d'expiration.
    storage?.removeItem(LEGACY_KEY);
    storage?.removeItem("cookie_consent_date");
  } catch { /* le choix reste actif en mémoire pendant cette session */ }
  applyCookieConsent(record);
  try { window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_EVENT, { detail: record })); } catch { /* sans impact */ }
  // La preuve est volontairement minimale et ne bloque jamais l'accès au service.
  axios.post(`${API}/privacy/cookie-consent`, { consent_id: record.id, choice: record.choice, policy_version: record.version }).catch(() => {});
  return record;
}
