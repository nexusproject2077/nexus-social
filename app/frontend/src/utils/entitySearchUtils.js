export const LEAGUES = [["fra.1", "France"], ["eng.1", "Angleterre"], ["esp.1", "Espagne"], ["ita.1", "Italie"], ["ger.1", "Allemagne"], ["por.1", "Portugal"]];
export function entityError(error) {
  const status = error?.response?.status;
  if (status === 401) return "Reconnecte-toi pour consulter les fiches.";
  if (status === 404) return "Le service de fiches n'est pas encore disponible sur ce serveur.";
  if (status === 429) return "Trop de recherches. Réessaie dans une minute.";
  return "Données temporairement indisponibles. Réessaie.";
}
export function safeArticle(value) {
  try { const url = new URL(value); return url.protocol === "https:" && /^[a-z-]+\.wikipedia\.org$/.test(url.hostname) ? url.href : null; } catch { return null; }
}
export function matchLabel(match) {
  if (match?.state === "pre") return "À venir";
  const home = match?.home?.score, away = match?.away?.score;
  return home != null && away != null ? `${home} – ${away}` : "Score indisponible";
}
export function matchDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "Horaire à confirmer" : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
export function toMatchCenter(match, club) {
  return { id: match.id, league_slug: club.league, league: club.league, home: match.home?.name || "", away: match.away?.name || "", home_id: match.home?.id, away_id: match.away?.id, home_score: match.home?.score, away_score: match.away?.score, state: match.state, clock: match.clock || "", detail: match.status || "", date: match.date };
}
