// Mots masqués (« muted words ») — filtre personnel de l'utilisateur.
//
// Les mots/phrases de cette liste masquent le contenu correspondant dans le fil
// (posts / clips) et dans les notifications. Le filtrage est insensible à la
// casse et aux accents, et respecte les limites de mots (« chat » ne masque pas
// « chataigne »). La liste est stockée sur le compte (synchronisée) ; ce module
// se contente de fournir le matcher côté client.

/** Minuscule + suppression des accents, pour une comparaison robuste. */
function normalize(s) {
  return (s == null ? "" : String(s))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Lit les mots masqués depuis l'utilisateur en cache (source : compte synchronisé). */
export function getMutedWords() {
  try {
    const u = JSON.parse(localStorage.getItem("nexus_user") || "null");
    return Array.isArray(u?.muted_words) ? u.muted_words : [];
  } catch {
    return [];
  }
}

// Un caractère « de mot » (lettre ou chiffre, accents inclus) délimite les termes.
const isWordChar = (c) => c !== "" && /[\p{L}\p{N}]/u.test(c);

/**
 * Construit un test `(texte) => bool` : vrai si le texte contient l'un des
 * termes masqués (en respectant les limites de mots). Retourne une fonction
 * toujours-fausse si la liste est vide (aucun filtrage).
 */
export function buildMutedMatcher(words) {
  const terms = (words || []).map(normalize).filter(Boolean);
  if (!terms.length) return () => false;
  return (text) => {
    const t = normalize(text);
    if (!t) return false;
    for (const term of terms) {
      let idx = t.indexOf(term);
      while (idx !== -1) {
        const before = idx === 0 ? "" : t[idx - 1];
        const after = idx + term.length >= t.length ? "" : t[idx + term.length];
        if (!isWordChar(before) && !isWordChar(after)) return true;
        idx = t.indexOf(term, idx + 1);
      }
    }
    return false;
  };
}

/** Matcher basé sur les mots actuellement en cache (pratique hors composant). */
export function currentMutedMatcher() {
  return buildMutedMatcher(getMutedWords());
}
