// Mode Confidentialité stricte (« Privacy strict »).
//
// Un seul interrupteur, effet immédiat : quand il est activé, l'application
// coupe tout ce qui n'est pas essentiel au service :
//   - les analytics de temps d'écran (aucune session envoyée au serveur) ;
//   - les publicités ciblées / personnalisées (aucune pub chargée).
//
// L'état est stocké en local (effet instantané, sans aller-retour serveur) ET
// synchronisé sur le compte (il suit l'utilisateur sur tous ses appareils).
// Un évènement « privacy-strict-changed » est émis à chaque changement pour que
// les composants concernés (pubs, tracking) réagissent en direct.

const KEY = "privacy_strict";
export const PRIVACY_STRICT_EVENT = "privacy-strict-changed";

/** L'utilisateur a-t-il activé le mode Confidentialité stricte ? */
export function isPrivacyStrict() {
  try {
    return window.localStorage?.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

/** Active/désactive le mode et notifie les composants (effet immédiat). */
export function setPrivacyStrict(on) {
  try {
    if (on) window.localStorage.setItem(KEY, "on");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* quota / mode privé : on continue quand même côté mémoire */
  }
  try {
    window.dispatchEvent(new CustomEvent(PRIVACY_STRICT_EVENT, { detail: { on: !!on } }));
  } catch {
    /* environnement sans window (SSR) : ignoré */
  }
}

/** Aligne l'état local sur la valeur du compte (au chargement / login). */
export function syncPrivacyStrictFromUser(user) {
  if (!user || typeof user.privacy_strict !== "boolean") return;
  const local = isPrivacyStrict();
  if (user.privacy_strict !== local) setPrivacyStrict(user.privacy_strict);
}

/** Abonnement pratique pour les composants (retourne une fonction de nettoyage). */
export function onPrivacyStrictChange(handler) {
  const fn = () => handler(isPrivacyStrict());
  window.addEventListener(PRIVACY_STRICT_EVENT, fn);
  window.addEventListener("storage", fn); // synchro entre onglets
  return () => {
    window.removeEventListener(PRIVACY_STRICT_EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}
