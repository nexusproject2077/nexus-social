// Gestion de la couleur d'accentuation de l'interface.
// La couleur choisie est stockée dans localStorage et appliquée globalement
// via la variable CSS --nexus-accent (utilisée par le logo, la navigation,
// les boutons principaux, etc.).

export const DEFAULT_ACCENT = "#22d3ee";

// Couleurs GRATUITES (unies).
export const FREE_ACCENTS = [
  { name: "Cyan", value: "#22d3ee" },
  { name: "Bleu", value: "#3b82f6" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Rose", value: "#ec4899" },
  { name: "Orange", value: "#f97316" },
  { name: "Vert", value: "#10b981" },
  { name: "Rouge", value: "#ef4444" },
  { name: "Jaune Néon", value: "#E1FF00" },
  { name: "Argent", value: "#E8ECF3" },
];

// Thèmes PREMIUM (dégradés de luxe). `solid` = repli uni pour les usages en
// couleur de texte / bordure (un dégradé n'est valide qu'en fond).
export const PREMIUM_ACCENTS = [
  { name: "Or Impérial", value: "linear-gradient(135deg,#f9d976 0%,#c8962c 45%,#f7e39a 100%)", solid: "#e0a92e" },
  { name: "Néon Cyberpunk", value: "linear-gradient(135deg,#b026ff 0%,#ff2bd6 100%)", solid: "#d63be8" },
  { name: "Émeraude de Luxe", value: "linear-gradient(135deg,#0f9b6c 0%,#10d98a 100%)", solid: "#12c67f" },
  { name: "Holographique", value: "linear-gradient(135deg,#22d3ee 0%,#8b5cf6 55%,#ec4899 100%)", solid: "#7bb6e8" },
];

// Rétrocompat : anciens imports { ACCENTS }.
export const ACCENTS = FREE_ACCENTS;

const STORAGE_KEY = "nexus_accent";

// Premier code couleur hexadécimal d'une valeur (repli uni pour un dégradé).
function _solidOf(value) {
  if (!value) return DEFAULT_ACCENT;
  if (!/gradient\(/i.test(value)) return value;
  const m = value.match(/#[0-9a-fA-F]{3,8}/);
  return m ? m[0] : DEFAULT_ACCENT;
}

// Applique les deux variables CSS : --nexus-accent (fond, peut être un dégradé)
// et --nexus-accent-solid (repli uni pour texte/bordure).
function _setVars(value) {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  root.setProperty("--nexus-accent", value);
  root.setProperty("--nexus-accent-solid", _solidOf(value));
}

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
  _setVars(value);
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
  _setVars(value);
  return value;
}
