// Gestion de la couleur d'accentuation de l'interface.
// La couleur choisie est stockée dans localStorage et appliquée globalement
// via la variable CSS --nexus-accent (utilisée par le logo, la navigation,
// les boutons principaux, etc.).

export const DEFAULT_ACCENT = "#22d3ee";

// Palette proposée dans les paramètres (nom + valeur hex).
export const ACCENTS = [
  { name: "Cyan", value: "#22d3ee" },
  { name: "Bleu", value: "#3b82f6" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Rose", value: "#ec4899" },
  { name: "Orange", value: "#f97316" },
  { name: "Vert", value: "#10b981" },
  { name: "Rouge", value: "#ef4444" },
];

const STORAGE_KEY = "nexus_accent";

export function getAccent() {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

// Applique la couleur : variable CSS + persistance + événement pour l'UI.
export function applyAccent(color) {
  const value = color || DEFAULT_ACCENT;
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--nexus-accent", value);
  }
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* stockage indisponible */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("nexus:accent", { detail: value }));
  }
  return value;
}

// À appeler une fois au démarrage de l'application.
export function initAccent() {
  const value = getAccent();
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--nexus-accent", value);
  }
  return value;
}
