// Gestion de la couleur d'accentuation de l'interface.
// La couleur choisie est stockée dans localStorage et appliquée globalement
// via la variable CSS --nexus-accent (utilisée par le logo, la navigation,
// les boutons principaux, etc.).

export const DEFAULT_ACCENT = "#e5e7eb";

// Couleurs GRATUITES (unies).
export const FREE_ACCENTS = [
  { name: "Argent", value: "#E8ECF3" },
];

// Thèmes PREMIUM (dégradés de luxe). `solid` = repli uni pour les usages en
// couleur de texte / bordure (un dégradé n'est valide qu'en fond).
export const PREMIUM_ACCENTS = [];

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
  return DEFAULT_ACCENT;
}

// Applique la couleur : variable CSS + persistance + événement pour l'UI.
export function applyAccent(color) {
  const value = DEFAULT_ACCENT;
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
  // Les anciennes installations pouvaient conserver un cyan/violet dans le
  // navigateur. On le remplace au démarrage afin que les composants legacy
  // qui lisent encore localStorage restent eux aussi dans le thème AMOLED.
  const value = DEFAULT_ACCENT;
  _setVars(value);
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* stockage indisponible */
  }
  return value;
}
