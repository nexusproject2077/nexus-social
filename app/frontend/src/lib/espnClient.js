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
  ["uefa.wchampions", "Women's Champions League"],
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
      // Drapeau Ligue des Champions (masc. + fém.) → badge + priorité carrousel.
      is_ucl: slug === "uefa.champions" || slug === "uefa.wchampions",
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
  "uefa.champions", "uefa.wchampions", "uefa.europa",  // Coupes d'Europe → élite de tous les pays
  "fifa.world", "uefa.euro",                // Sélections nationales (CdM / Euro)
  "eng.1", "esp.1", "ita.1", "ger.1", "fra.1", // top 5
  "eng.2", "ned.1", "por.1", "tur.1",        // autres championnats européens
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
        shortName: t.shortDisplayName || "",
        abbrev: t.abbreviation || "",
        logo: logos[0]?.href || t.logo || null,
        league_slug: slug,
      });
    }
  }
  return out;
}

// Équipes extraites d'un scoreboard (source PROUVÉE CORS + mêmes IDs ESPN que
// home_id/away_id → le tri favori marche). Complète l'endpoint /teams qui, lui,
// n'est pas toujours joignable depuis le navigateur.
function extractTeamsFromScoreboard(data, slug) {
  const out = [];
  for (const ev of data?.events || []) {
    const comp = (ev.competitions || [])[0] || {};
    for (const c of comp.competitors || []) {
      const t = c.team || {};
      const id = String(t.id || "");
      if (!id) continue;
      out.push({
        id,
        name: t.displayName || t.shortDisplayName || t.name || "",
        shortName: t.shortDisplayName || "",
        abbrev: t.abbreviation || "",
        logo: t.logo || t.logos?.[0]?.href || null,
        league_slug: slug,
      });
    }
  }
  return out;
}

// Plage « saison » YYYYMMDD-YYYYMMDD (−8 mois → +2 mois) pour le scoreboard large.
function _seasonRange() {
  const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const now = new Date();
  const start = new Date(now); start.setMonth(start.getMonth() - 8);
  const end = new Date(now); end.setMonth(end.getMonth() + 2);
  return `${fmt(start)}-${fmt(end)}`;
}

function loadTeamDirectory() {
  if (_teamDirCache) return _teamDirCache;
  _teamDirCache = (async () => {
    const range = _seasonRange();
    const jobs = [];
    for (const slug of TEAM_DIR_LEAGUES) {
      // 3 sources fusionnées, par ordre de fiabilité décroissante :
      // 1) scoreboard du jour (fiable), 2) scoreboard saison (large), 3) /teams (bonus).
      jobs.push(fetchJson(`${SOCCER_BASE}/${slug}/scoreboard`).then((d) => extractTeamsFromScoreboard(d, slug)));
      jobs.push(fetchJson(`${SOCCER_BASE}/${slug}/scoreboard?dates=${range}&limit=1000`).then((d) => extractTeamsFromScoreboard(d, slug)));
      jobs.push(fetchJson(`${SOCCER_BASE}/${slug}/teams`).then((d) => extractTeams(d, slug)));
    }
    const all = (await Promise.all(jobs)).flat();
    // Dédoublonnage par id (une équipe apparaît dans plusieurs sources/listes).
    const map = new Map();
    for (const t of all) if (t.id && !map.has(t.id)) map.set(t.id, t);
    const list = [...map.values()];
    // Ne PAS mettre en cache un annuaire vide (échec réseau ponctuel) → on
    // pourra réessayer à la prochaine recherche.
    if (!list.length) throw new Error("annuaire vide");
    return list;
  })().catch(() => {
    _teamDirCache = null;
    return [];
  });
  return _teamDirCache;
}

// Minuscule + suppression des accents (« münchen » ≈ « munchen »).
const _DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
const _fold = (s) => (s || "").toLowerCase().normalize("NFD").replace(_DIACRITICS, "");

// Résout l'ID ESPN EXACT d'une sélection nationale (ou club) à partir de son nom
// officiel (« France », « Türkiye »…), en interrogeant l'annuaire (qui inclut
// fifa.world / uefa.euro). Renvoie null si aucune correspondance exacte → l'appelant
// peut alors se rabattre sur un id de secours. Garantit qu'on ne stocke jamais un
// mauvais id (pas de correspondance approximative ici).
export async function resolveTeamIdByName(names) {
  const wanted = (Array.isArray(names) ? names : [names]).map(_fold);
  const dir = await loadTeamDirectory();
  const hit = dir.find((t) => wanted.includes(_fold(t.name)) || wanted.includes(_fold(t.shortName)));
  return hit ? hit.id : null;
}

// Recherche floue : nom / nom court / ABRÉVIATION (« PSG »), exact > préfixe > sous-chaîne.
export async function searchTeamsFromEspn(query, limit = 24) {
  const q = _fold((query || "").trim());
  if (q.length < 2) return [];
  const dir = await loadTeamDirectory();
  const scored = [];
  for (const t of dir) {
    const name = _fold(t.name);
    const short = _fold(t.shortName);
    const abbr = _fold(t.abbrev);
    let score = -1;
    if (abbr === q || name === q || short === q) score = 0;
    else if (name.startsWith(q) || short.startsWith(q)) score = 1;
    else if (name.includes(q) || short.includes(q) || abbr.includes(q)) score = 2;
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
  if (ev.ownGoal || t.includes("own goal")) return "own_goal";
  // Penaltys AVANT les cartons : « Penalty - Scored » contient « red » (dans
  // sco-RED) → un but sur penalty s'affichait comme un carton rouge ; « Penalty
  // - Missed » n'était pas non plus reconnu.
  const isPen = !!ev.penaltyKick || t.includes("penalty") || t.includes("penalti") || t.includes("spot kick");
  if (isPen) {
    const missed = t.includes("miss") || t.includes("saved") || t.includes("save") || t.includes("failed") || t.includes("no goal") || t.includes("off target");
    const scored = !!ev.scoringPlay || t.includes("scored") || t.includes("converted") || (t.includes("goal") && !t.includes("no goal"));
    if (scored && !missed) return "penalty_goal";
    if (missed) return "penalty_missed";
    return "penalty";
  }
  if (t.includes("goal")) return "goal";
  if (t.includes("yellow")) return "yellow";
  if (t.includes("red")) return "red";
  if (t.includes("substitution") || t.includes("sub ") || t === "sub") return "sub";
  if (t.includes("var")) return "var";
  if (t.includes("injur")) return "injury";
  return "other";
}

// Récupère et normalise le résumé ESPN (header + keyEvents) d'un match de foot.
// slug = league_slug (ex : "fra.1"), eventId = id du match.
// Statistiques d'équipe (boxscore ESPN). Retourne une liste ordonnée
// [{ key, home, away }] avec des libellés FR/EN gérés côté UI. On ne garde que
// les stats réellement fournies par ESPN (pas de valeurs inventées).
function parseTeamStats(data, sideMap) {
  const teams = data?.boxscore?.teams || [];
  if (teams.length < 2) return [];
  const indexByName = (t) => {
    const m = {};
    for (const s of t?.statistics || []) {
      if (s?.name) m[String(s.name).toLowerCase()] = s.displayValue;
    }
    return m;
  };
  const id0 = String(teams[0]?.team?.id || "");
  const homeFirst = sideMap[id0] === "home";
  const homeStats = indexByName(homeFirst ? teams[0] : teams[1]);
  const awayStats = indexByName(homeFirst ? teams[1] : teams[0]);
  // [clé UI, noms ESPN possibles] — le 1er nom présent gagne.
  const WANT = [
    ["possession", ["possessionpct"]],
    ["shots", ["totalshots"]],
    ["shots_on", ["shotsontarget", "ontargetshots"]],
    ["shots_off", ["shotsoffgoal", "offtargetshots"]],
    ["saves", ["saves", "goalkeepersaves"]],
    ["fouls", ["foulscommitted"]],
    ["offsides", ["offsides"]],
    ["corners", ["woncorners", "cornerkicks"]],
    ["yellow", ["yellowcards"]],
    ["red", ["redcards"]],
    ["passes", ["totalpasses", "accuratepasses"]],
    ["pass_pct", ["passpct", "accuratepassespercentage"]],
  ];
  const pick = (m, names) => {
    for (const n of names) if (m[n] != null) return m[n];
    return null;
  };
  const out = [];
  for (const [key, names] of WANT) {
    const h = pick(homeStats, names);
    const a = pick(awayStats, names);
    if (h == null && a == null) continue;
    out.push({ key, home: h ?? "0", away: a ?? "0" });
  }
  return out;
}

// Compositions (rosters ESPN) → { home:[...], away:[...] }, chaque joueur
// { name, number, position, starter }. null si indisponible.
function parseLineups(data) {
  const rosters = data?.rosters || [];
  const side = (s) => {
    const r = rosters.find((x) => x.homeAway === s);
    return (r?.roster || [])
      .map((p) => ({
        name: p.athlete?.shortName || p.athlete?.displayName || "",
        number: String(p.jersey ?? p.athlete?.jersey ?? "").trim(),
        position: p.position?.abbreviation || p.position?.name || "",
        starter: !!p.starter,
      }))
      .filter((p) => p.name);
  };
  const home = side("home");
  const away = side("away");
  if (!home.length && !away.length) return null;
  return { home, away };
}

export async function fetchMatchDetailsFromEspn(eventId, slug) {
  const empty = { header: {}, events: [], stats: [], lineups: null };
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
  let stats = [];
  let lineups = null;
  try { stats = parseTeamStats(data, sideMap); } catch { /* stats optionnelles */ }
  try { lineups = parseLineups(data); } catch { /* compos optionnelles */ }
  return { header, events, stats, lineups };
}
