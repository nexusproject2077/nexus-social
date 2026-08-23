// Suivi léger du temps passé sur l'app AUJOURD'HUI (bien-être numérique).
// Stocké en localStorage par jour (remis à zéro à minuit, par clé datée). Compté
// uniquement quand l'onglet est visible. Sert : limite quotidienne configurable
// + barrière anti-scroll des mineurs (30 min). Aucune donnée n'est envoyée au
// serveur : c'est un compteur strictement local au navigateur.

const dayKey = () => {
  const d = new Date();
  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `nexus_screen_${k}`;
};

export function getTodaySeconds() {
  try {
    return parseFloat(localStorage.getItem(dayKey()) || "0") || 0;
  } catch {
    return 0;
  }
}

export function addSeconds(s) {
  try {
    localStorage.setItem(dayKey(), String(getTodaySeconds() + s));
  } catch {
    /* stockage indisponible (navigation privée) → best-effort */
  }
}

export function getTodayMinutes() {
  return getTodaySeconds() / 60;
}
