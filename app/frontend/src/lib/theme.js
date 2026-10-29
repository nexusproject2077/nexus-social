// ─────────────────────────────────────────────────────────────────────────────
// Nexus — Source UNIQUE des tokens de design (couleurs, verre, rayons, ombres).
//
// Objectif : que Messages, Clips, Stories, Accueil et Profil partagent
// exactement la même identité visuelle. On importe ces tokens plutôt que de
// recopier des valeurs hex page par page (source de dérives).
//
// ⚠️ ACCENT : on garde une valeur HEX (pas `var(--nexus-accent)`) car de
// nombreux styles concatènent une alpha en hexadécimal (ex. `${accent}33`).
// La valeur suit le choix de l'utilisateur, stockée par lib/accent.js, donc
// elle reste cohérente avec la variable CSS `--nexus-accent`.
// ─────────────────────────────────────────────────────────────────────────────

// Échelle de surfaces : du fond le plus sombre aux surfaces surélevées.
export const SURFACE = {
  deep:      "#000000",
  base:      "#000000",
  low:       "#050505",
  container: "#0a0a0a",
  high:      "#121212",
  bright:    "#1b1b1b",
};

// Texte & bordures.
export const TEXT = {
  primary:  "#f5f5f5",
  variant:  "#c9c9c9",
  muted:    "#a3a3a3",
  onAccent: "#050505",
};
export const OUTLINE = "#2a2a2a";

// Accent (couleur choisie par l'utilisateur ; défaut cyan). Lu une fois ;
// pour la réactivité live, la variable CSS `--nexus-accent` reste la référence.
export const ACCENT = "#e5e5e5";
export const ACCENT_2 = "#e5e5e5";
export const ACCENT_GRADIENT = "#e5e5e5";

// Effet « verre dépoli » — un réglage unique partout (barres, cartes, entêtes).
export const glass = {
  background: "rgba(0,0,0,0.82)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  border: "1px solid rgba(255,255,255,0.06)",
};

// Rayons d'angle (px) — échelle cohérente.
export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 24, pill: 9999 };

// Ombres standard.
export const SHADOW = {
  soft:   "0 4px 14px rgba(0,0,0,0.25)",
  accent: `0 6px 20px ${ACCENT}40`,
};
