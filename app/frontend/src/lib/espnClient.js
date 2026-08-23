// Récupération des scores ESPN DIRECTEMENT depuis le navigateur.
//
// Pourquoi côté client ? ESPN bloque les plages d'IP des datacenters (Cloud Run
// reçoit un « HTTP 403 » sur chaque requête, même avec un User-Agent navigateur).
// En revanche l'API publique `site.api.espn.com` autorise le CORS navigateur
// (Access-Control-Allow-Origin: *) : depuis l'IP de l'utilisateur, la requête
// passe. On récupère donc les scoreboards ici et on les normalise EXACTEMENT
// dans le même format que le backend, pour que l'UI reste identique.
//
// Le backend reste la source des FAVORIS (ligues/équipes) et le repli éventuel.

const SOCCER_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const MMA_URL = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard";

// Mêmes ligues que ESPN_SOCCER_LEAGUES côté backend.
const SOCCER_LEAGUES = [
  ["uefa.champions", "Ligue des Champions"],
  ["uefa.europa", "Ligue Europa"],
  ["eng.1", "Premier League"],
  ["esp.1", "LaLiga"],
  ["ita.1", "Serie A"],
  ["ger.1", "Bundesliga"],
  ["fra.1", "Ligue 1"],
  ["fifa.world", "Coupe du Monde"],
  ["uefa.euro", "Euro"],
  ["usa.1", "MLS"],
];

async function fetchJson(url) {
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" }, mode: "cors", credentials: "omit" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Scoreboard d'une ligue → liste normalisée (identique à _espn_fetch_league).
function normalizeLeague(data, slug, fallbackName) {
  const out = [];
  if (!data) return out;
  const leagueName = data.leagues?.[0]?.name || fallbackName;
  for (const ev of data.events || []) {
    const comp = (ev.competitions || [])[0] || {};
    const status = ev.status || comp.status || {};
    const stype = status.type || {};
    const comps = comp.competitors || [];
    const home = comps.find((c) => c.homeAway === "home");
    const away = comps.find((c) => c.homeAway === "away");
    if (!home || !away) continue;
    out.push({
      id: String(ev.id || ""),
      sport: "foot",
      league: leagueName,
      league_slug: slug,
      home: home.team?.shortDisplayName || home.team?.displayName || "",
      away: away.team?.shortDisplayName || away.team?.displayName || "",
      home_id: String(home.team?.id || ""),
      away_id: String(away.team?.id || ""),
      home_logo: home.team?.logo || null,
      away_logo: away.team?.logo || null,
      home_score: home.score ?? null,
      away_score: away.score ?? null,
      state: stype.state, // pre | in | post
      clock: status.displayClock || "",
      detail: stype.shortDetail || stype.description || "",
      date: ev.date,
    });
  }
  return out;
}

// Scoreboard UFC → liste normalisée (identique à _espn_fetch_mma_sync).
function normalizeMma(data) {
  const out = [];
  if (!data) return out;
  const fighter = (c) => {
    const a = c.athlete || {};
    const hs = a.headshot;
    const avatar = hs && typeof hs === "object" ? hs.href : typeof hs === "string" ? hs : null;
    return { name: a.displayName || a.shortName || "?", avatar, winner: !!c.winner };
  };
  for (const ev of data.events || []) {
    const eventName = ev.shortName || ev.name || "UFC";
    for (const comp of ev.competitions || []) {
      const cs = comp.status || {};
      const ctype = cs.type || {};
      const comps = comp.competitors || [];
      if (comps.length < 2) continue;
      const f1 = fighter(comps[0]);
      const f2 = fighter(comps[1]);
      const result = cs.result || {};
      const method = result.shortDisplayName || result.description || ctype.detail || "";
      const winner = f1.winner ? f1.name : f2.winner ? f2.name : null;
      out.push({
        id: String(comp.id || ev.id || ""),
        sport: "mma",
        event: eventName,
        f1,
        f2,
        state: ctype.state, // pre | in | post
        round: cs.period,
        clock: cs.displayClock || "",
        method,
        winner,
        detail: ctype.shortDetail || ctype.detail || "",
        date: comp.date || ev.date,
      });
    }
  }
  return out;
}

// Récupère foot (toutes les ligues, en parallèle) + MMA, directement depuis le
// navigateur. Renvoie une liste plate normalisée (même forme que /api/livescores).
export async function fetchLiveScoresFromEspn({ foot = true, mma = true } = {}) {
  const jobs = [];
  if (foot) {
    for (const [slug, name] of SOCCER_LEAGUES) {
      jobs.push(fetchJson(`${SOCCER_BASE}/${slug}/scoreboard`).then((d) => normalizeLeague(d, slug, name)));
    }
  }
  const mmaJob = mma ? fetchJson(MMA_URL).then(normalizeMma) : Promise.resolve([]);
  const [footResults, mmaResult] = await Promise.all([Promise.all(jobs), mmaJob]);
  return [...footResults.flat(), ...mmaResult];
}
