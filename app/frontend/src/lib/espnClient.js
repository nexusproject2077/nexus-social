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

// ───────────────────── Recherche d'équipes (mise en favori) ────────────────────
// Annuaire construit à partir des endpoints /teams d'ESPN (même hôte que les
// scoreboards, donc CORS OK et MÊMES IDs d'équipe → le tri « favori » marche).
// Chargé une seule fois puis mis en cache mémoire.

const TEAM_DIR_LEAGUES = [
  "eng.1", "esp.1", "ita.1", "ger.1", "fra.1", // top 5
  "eng.2", "esp.2", "ita.2", "ger.2", "fra.2", // 2es divisions
  "ned.1", "por.1", "tur.1", "sco.1", "bel.1", "gre.1", "sui.1", "aut.1", // Europe
  "usa.1", "mex.1", "bra.1", "arg.1", "sau.1", // Amériques + Saudi
];

let _teamDirCache = null; // Promise<Team[]>

function extractTeams(data, slug) {
  const out = [];
  const leagues = data?.sports?.[0]?.leagues || [];
  for (const lg of leagues) {
    for (const item of lg.teams || []) {
      const t = item.team || item;
      const logos = t.logos || [];
      const id = String(t.id || "");
      if (!id) continue;
      out.push({
        id,
        name: t.displayName || t.name || t.shortDisplayName || "",
        shortName: t.shortDisplayName || t.abbreviation || "",
        logo: logos[0]?.href || t.logo || null,
        league_slug: slug,
      });
    }
  }
  return out;
}

function loadTeamDirectory() {
  if (_teamDirCache) return _teamDirCache;
  _teamDirCache = (async () => {
    const jobs = TEAM_DIR_LEAGUES.map((slug) =>
      fetchJson(`${SOCCER_BASE}/${slug}/teams`).then((d) => extractTeams(d, slug))
    );
    const all = (await Promise.all(jobs)).flat();
    // Dédoublonnage par id (une équipe peut apparaître dans plusieurs listes).
    const map = new Map();
    for (const t of all) if (!map.has(t.id)) map.set(t.id, t);
    return [...map.values()];
  })().catch(() => {
    _teamDirCache = null; // on pourra réessayer au prochain appel
    return [];
  });
  return _teamDirCache;
}

// Recherche floue par nom : correspondance exacte > préfixe > sous-chaîne.
export async function searchTeamsFromEspn(query, limit = 24) {
  const q = (query || "").trim().toLowerCase();
  if (q.length < 2) return [];
  const dir = await loadTeamDirectory();
  const scored = [];
  for (const t of dir) {
    const name = t.name.toLowerCase();
    const short = (t.shortName || "").toLowerCase();
    let score = -1;
    if (name === q || short === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (name.includes(q) || short.includes(q)) score = 2;
    if (score >= 0) scored.push([score, t]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map((x) => x[1]);
}

// ─────────────── Détail d'un match : chronologie des événements ────────────────
// Identique à _espn_map_event_type / _espn_fetch_match_sync du backend, mais
// exécuté dans le navigateur (l'endpoint summary est aussi bloqué depuis Cloud Run).

function mapEventType(text, ev) {
  const t = (text || "").toLowerCase();
  if (ev.ownGoal) return "own_goal";
  if (t.includes("goal")) return ev.penaltyKick ? "penalty_goal" : "goal";
  if (t.includes("yellow")) return "yellow";
  if (t.includes("red")) return "red";
  if (t.includes("substitution") || t.includes("sub ") || t === "sub") return "sub";
  if (t.includes("var")) return "var";
  if (t.includes("penalty")) return "penalty";
  if (t.includes("injur")) return "injury";
  return "other";
}

// Récupère et normalise le résumé ESPN (header + keyEvents) d'un match de foot.
// slug = league_slug (ex : "fra.1"), eventId = id du match.
export async function fetchMatchDetailsFromEspn(eventId, slug) {
  const empty = { header: {}, events: [] };
  const id = String(eventId || "").trim();
  const lg = String(slug || "").trim().toLowerCase();
  // Validation stricte (ces valeurs entrent dans l'URL ESPN → anti-injection).
  if (!/^[0-9]{3,20}$/.test(id) || !/^[a-z0-9.\-]{2,30}$/.test(lg)) return empty;

  const data = await fetchJson(`${SOCCER_BASE}/${lg}/summary?event=${encodeURIComponent(id)}`);
  if (!data) return empty;

  // team.id -> "home" / "away"
  const sideMap = {};
  let header = {};
  try {
    const comp = (data.header?.competitions || [])[0] || {};
    const comps = comp.competitors || [];
    for (const c of comps) {
      const tid = String(c.team?.id || c.id || "");
      if (tid) sideMap[tid] = c.homeAway;
    }
    const h = comps.find((x) => x.homeAway === "home") || {};
    const a = comps.find((x) => x.homeAway === "away") || {};
    const st = comp.status || {};
    const stype = st.type || {};
    const logo = (team) => {
      const logos = team?.logos || [];
      return (logos[0]?.href || null) || team?.logo || null;
    };
    header = {
      home: h.team?.displayName || h.team?.shortDisplayName,
      away: a.team?.displayName || a.team?.shortDisplayName,
      home_logo: logo(h.team),
      away_logo: logo(a.team),
      home_score: h.score,
      away_score: a.score,
      state: stype.state,
      clock: st.displayClock || "",
      detail: stype.shortDetail || stype.description || "",
    };
  } catch {
    /* header optionnel */
  }

  // Nom court de préférence (« K. Mbappé »), sinon nom complet.
  const nm = (a) => (a?.shortName || a?.displayName || "").trim();

  const events = [];
  for (const ev of data.keyEvents || []) {
    const typ = ev.type || {};
    const text = typ.text || typ.name || "";
    const teamId = String(ev.team?.id || "");
    const kind = mapEventType(text, ev);

    // Athlètes impliqués : `participants` porte le RÔLE (buteur, passeur,
    // entrant, sortant), `athletesInvolved` est le repli.
    const parts = (ev.participants || [])
      .map((p) => ({ name: nm(p.athlete || p), role: String(p.type || p.role || "").toLowerCase() }))
      .filter((p) => p.name);
    const involved = (ev.athletesInvolved || []).map((a) => nm(a)).filter(Boolean);
    const players = parts.length ? parts.map((p) => p.name) : involved;
    const byRole = (...keys) => (parts.find((p) => keys.some((k) => p.role.includes(k))) || {}).name || null;

    let scorer = null, assist = null, playerIn = null, playerOut = null, player = null;
    if (kind === "goal" || kind === "penalty_goal" || kind === "own_goal") {
      scorer = byRole("scor", "goal") || players[0] || null;
      assist = byRole("assist") || (players[1] && players[1] !== scorer ? players[1] : null);
    } else if (kind === "sub") {
      playerIn = byRole("subbed-in", "sub-in", "sub in", "playerin", "enter", "in");
      playerOut = byRole("subbed-out", "sub-out", "sub out", "playerout", "exit", "out");
      // Repli si aucun rôle : ordre ESPN habituel = [entrant, sortant].
      if (!playerIn && !playerOut) { playerIn = players[0] || null; playerOut = players[1] || null; }
      else {
        if (!playerIn) playerIn = players.find((n) => n !== playerOut) || null;
        if (!playerOut) playerOut = players.find((n) => n !== playerIn) || null;
      }
    } else {
      player = players[0] || null; // cartons, blessures…
    }

    events.push({
      minute: ev.clock?.displayValue || "",
      type: kind,
      side: sideMap[teamId],
      text,
      players,
      scorer, assist, playerIn, playerOut, player,
      penalty: !!ev.penaltyKick,
      own_goal: !!ev.ownGoal,
    });
  }
  return { header, events };
}
