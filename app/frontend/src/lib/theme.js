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
  deep: "#020617", // fond profond (derrière le verre, ex. chat)
  base: "#0b1326", // fond de l'app
  low: "#131b2e",
  container: "#171f33",
  high: "#222a3d",
  bright: "#31394d",
};

// Texte & bordures.
export const TEXT = {
  primary: "#dae2fd", // sur surface
  variant: "#bbc9cd", // texte secondaire
  muted: "#859397", // libellés discrets
  onAccent: "#00363e", // texte sur bouton accent
};
export const OUTLINE = "#3c494c"; // bordures discrètes

// Accent (couleur choisie par l'utilisateur ; défaut cyan). Lu une fois ;
// pour la réactivité live, la variable CSS `--nexus-accent` reste la référence.
export const ACCENT =
  (typeof window !== "undefined" &&
    window.localStorage.getItem("nexus_accent")) ||
  "#22d3ee";
export const ACCENT_2 = "#3b82f6"; // 2e teinte des dégradés d'accent
export const ACCENT_GRADIENT = `linear-gradient(135deg, ${ACCENT}, ${ACCENT_2})`;

// Effet « verre dépoli » — un réglage unique partout (barres, cartes, entêtes).
export const glass = {
  background: "rgba(19,27,46,0.6)",
  backdropFilter: "blur(24px)",
  WebkitBackdropFilter: "blur(24px)",
  border: "1px solid rgba(255,255,255,0.06)",
};

// Rayons d'angle (px) — échelle cohérente.
export const RADIUS = { sm: 10, md: 14, lg: 18, xl: 24, pill: 9999 };

// Ombres standard.
export const SHADOW = {
  soft: "0 4px 14px rgba(0,0,0,0.25)",
  accent: `0 6px 20px ${ACCENT}40`,
};
