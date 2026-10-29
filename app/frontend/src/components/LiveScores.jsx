// Scores de foot en direct (ESPN via notre backend, en cache) + personnalisation.
// L'utilisateur met en favori une ligue / une équipe (étoile) : ses favoris
// remontent en tête, instantanément (tri client) et de façon persistante (MongoDB).
// variant="mobile"  → carrousel horizontal (sous les Stories).
// variant="sidebar" → bloc compact vertical (haut de la colonne Tendances, PC).
import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import MatchCenter from "@/components/MatchCenter";
import { fetchLiveScoresFromEspn, fetchStandingsFromEspn, getLeagueLogo, searchTeamsFromEspn } from "@/lib/espnClient";
import i18n from "@/i18n";

const NEON = "#4ade80";      // vert néon (match en cours)
const BRIGHT = "#f4f8ff";    // blanc brillant
const UCL_BLUE = "#5b8def";   // bleu Champions League (badge / liseré)

// Un match relève-t-il de la Ligue des Champions (masculine OU féminine) ?
export const isUclMatch = (m) =>
  !!m && (m.is_ucl === true || m.league_slug === "uefa.champions" || m.league_slug === "uefa.wchampions");

// Petit blason UCL (étoile) — 100 % SVG, glow bleu Champions League.
const UclBadge = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden
    style={{ filter: `drop-shadow(0 0 4px ${UCL_BLUE}88)`, flexShrink: 0 }}>
    <path d="M12 2.6l2.6 5.5 6 .8-4.4 4.1 1.1 6L12 16.1 6.7 19l1.1-6L3.4 8.9l6-.8L12 2.6z" fill={UCL_BLUE} />
  </svg>
);

// Mode DÉMO (opt-in : ?demo=1 ou localStorage) — affiche des cartes de test
// étiquetées « DÉMO » quand l'API ne renvoie aucun match. Jamais présenté comme réel.
const demoScoresOn = () => {
  try { return new URLSearchParams(window.location.search).get("demo") === "1" || localStorage.getItem("nexus_demo_scores") === "1"; }
  catch { return false; }
};
const DEMO_SCORES = [
  { id: "demo-ren-psg", sport: "foot", league: "Ligue 1", league_slug: "fra.1", home: "Rennes", away: "PSG", home_id: "", away_id: "", home_logo: null, away_logo: null, home_score: "0", away_score: "0", state: "in", clock: "1'", detail: "1'", date: new Date().toISOString(), demo: true },
  { id: "demo-om-ol", sport: "foot", league: "Ligue 1", league_slug: "fra.1", home: "Marseille", away: "Lyon", home_id: "", away_id: "", home_logo: null, away_logo: null, home_score: null, away_score: null, state: "pre", clock: "", detail: "À venir", date: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), demo: true },
  { id: "demo-ufc", sport: "mma", event: "UFC 300", f1: { name: "Jon Jones", avatar: null, winner: false }, f2: { name: "Tom Aspinall", avatar: null, winner: false }, state: "in", round: 3, clock: "02:15", method: "", winner: null, detail: "R3 · 02:15", date: new Date().toISOString(), demo: true },
  // Terminé (score final, ~3 h) — pour visualiser la carte « dernier résultat 24 h ».
  { id: "demo-len-mon", sport: "foot", league: "Ligue 1", league_slug: "fra.1", home: "Lens", away: "Monaco", home_id: "", away_id: "", home_logo: null, away_logo: null, home_score: "1", away_score: "2", state: "post", clock: "", detail: "Terminé", date: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), demo: true },
];

// Ligues majeures proposées dans la modale de filtres (slugs ESPN).
export const MAJOR_LEAGUES = [
  { id: "uefa.champions", name: "Ligue des Champions" },
  { id: "fra.1",          name: "Ligue 1" },
  { id: "eng.1",          name: "Premier League" },
  { id: "esp.1",          name: "LaLiga" },
  { id: "ita.1",          name: "Serie A" },
  { id: "ger.1",          name: "Bundesliga" },
  { id: "uefa.europa",    name: "Ligue Europa" },
  { id: "fifa.world",     name: "Coupe du Monde" },
  { id: "uefa.euro",      name: "Euro" },
  { id: "usa.1",          name: "MLS" },
];

const STATE_ORDER = { in: 0, pre: 1, post: 2 };
const PAST_EVENT_RETENTION_MS = 48 * 60 * 60 * 1000;
const DESKTOP_PAGE_SIZE = 10;
const FAVORITE_LEAGUES_KEY = "nexus_sports_favorite_leagues";
const FAVORITE_TEAMS_KEY = "nexus_sports_favorite_teams";

const readSavedLeagues = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(FAVORITE_LEAGUES_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
};

const saveLeaguesLocally = (leagues) => {
  try { localStorage.setItem(FAVORITE_LEAGUES_KEY, JSON.stringify(leagues)); } catch { /* stockage indisponible */ }
};
const readSavedTeams = () => {
  try { const saved = JSON.parse(localStorage.getItem(FAVORITE_TEAMS_KEY) || "[]"); return Array.isArray(saved) ? saved : []; } catch { return []; }
};
const saveTeamsLocally = (teams) => {
  try { localStorage.setItem(FAVORITE_TEAMS_KEY, JSON.stringify(teams)); } catch { /* stockage indisponible */ }
};

// Les résultats et combats achevés restent utiles pendant deux jours, puis ils
// sortent de toutes les vues (mobile comme ordinateur). Les dates absentes ou
// illisibles sont conservées afin de ne pas masquer un événement à venir.
export const keepRecentEvent = (match, now = Date.now()) => {
  const timestamp = new Date(match?.date || "").getTime();
  return !Number.isFinite(timestamp) || timestamp >= now - PAST_EVENT_RETENTION_MS;
};

// Tri client identique au backend : favoris d'abord, puis en cours, puis date.
export function sortMatches(list, favL, favT) {
  const isFav = (m) => favL.has(m.league_slug) || favT.has(m.home_id) || favT.has(m.away_id);
  return [...list].sort((a, b) =>
    (isFav(a) ? 0 : 1) - (isFav(b) ? 0 : 1)
    || (STATE_ORDER[a.state] ?? 3) - (STATE_ORDER[b.state] ?? 3)
    || String(a.date || "").localeCompare(String(b.date || "")));
}

// Sélection à afficher, dans l'ordre : EN DIRECT (priorité absolue) → les
// prochains À VENIR (chronologiques) → les derniers TERMINÉS avec leur score
// final (plus récents d'abord, ~24 h). Favoris remontés dans chaque groupe.
export function displayMatches(list, favL, favT) {
  const recentList = list.filter(keepRecentEvent);
  const isFav = (m) => favL.has(m.league_slug) || favT.has(m.home_id) || favT.has(m.away_id);
  // Dès qu'une préférence est définie, elle devient un vrai filtre : une autre
  // compétition ne se glisse plus dans la liste. Le MMA reste à part car la
  // modale ne propose que des compétitions de football.
  const hasSelection = favL.size > 0 || favT.size > 0;
  const selectedList = hasSelection
    ? recentList.filter((m) => m.sport === "mma" || isFav(m))
    : recentList;
  // Priorité : favoris d'abord, puis Ligue des Champions, puis le reste
  // (tri stable → l'ordre par date est conservé à rang égal).
  const rank = (m) => (isFav(m) ? 0 : 2) + (isUclMatch(m) ? 0 : 1);
  const favFirst = (arr) => [...arr].sort((a, b) => rank(a) - rank(b));
  const asc = (a, b) => String(a.date || "").localeCompare(String(b.date || ""));
  const desc = (a, b) => String(b.date || "").localeCompare(String(a.date || ""));
  const live = favFirst(selectedList.filter((m) => m.state === "in"));
  // Aucune limite : on montre TOUS les matchs (en cours, à venir, terminés).
  const pre = favFirst(selectedList.filter((m) => m.state === "pre").sort(asc));
  const post = favFirst(selectedList.filter((m) => m.state === "post").sort(desc));
  const out = [...live, ...pre, ...post];
  return out.length ? out : selectedList;
}

// Heure + jour du coup d'envoi, format ultra-court (ex : « Dim. 15:00 »,
// « Auj. 21:00 », « Dem. 18:30 »).
export function formatKickoff(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return i18n.t("livescores.upcoming");
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString(i18n.language || "en", { hour: "2-digit", minute: "2-digit" });
  // Aujourd'hui → heure seule (ex : « 20:45 ») ; sinon on préfixe le jour.
  if (d.toDateString() === now.toDateString()) return time;
  if (d.toDateString() === tomorrow.toDateString()) return `${i18n.t("livescores.tomorrow_prefix")} ${time}`;
  const day = d.toLocaleDateString(i18n.language || "en", { weekday: "short" });
  return `${day.charAt(0).toUpperCase() + day.slice(1)} ${time}`;
}

// Badge « À VENIR » discret (gris anthracite) — remplace le badge LIVE.
const UpcomingBadge = () => (
  <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-wide"
    style={{ background: "#242424", color: "#c9c9c9" }}>{i18n.t("livescores.upcoming_badge")}</span>
);

// Badge DÉMO (données de simulation, jamais présentées comme réelles).
const DemoBadge = () => (
  <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-wide"
    style={{ background: "#f59e0b22", color: "#fbbf24" }}>{i18n.t("livescores.demo_badge")}</span>
);

// Badge LIVE néon (match en cours).
const LiveBadge = () => (
  <span className="flex items-center gap-1 flex-shrink-0">
    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: NEON, boxShadow: `0 0 6px ${NEON}` }} />
    <span className="text-[9px] font-black" style={{ color: NEON }}>LIVE</span>
  </span>
);

// Étoile favori (SVG premium via material-symbols) — remplie/allumée si actif.
const StarBtn = ({ active, onClick, size = 15 }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className="flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
    aria-label={active ? i18n.t("livescores.fav_remove") : i18n.t("livescores.fav_add")}
    style={{ width: size + 4, height: size + 4 }}
  >
    <span className="material-symbols-outlined" style={{
      fontSize: size,
      color: active ? NEON : "#5b6577",
      fontVariationSettings: `'FILL' ${active ? 1 : 0}, 'wght' 400`,
      filter: active ? `drop-shadow(0 0 5px ${NEON}77)` : "none",
    }}>star</span>
  </button>
);

const Team = ({ id, logo, name, score, live, upcoming, flash, favT, onToggleTeam }) => (
  <div className="flex items-center gap-1.5 min-w-0">
    {logo ? (
      <img src={logo} alt="" className="w-4 h-4 object-contain flex-shrink-0" loading="lazy" />
    ) : (
      <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: "#303030" }} />
    )}
    <span className="text-xs truncate flex-1" style={{ color: "#d4d4d4" }}>{name}</span>
    {/* Match à venir : pas de score (remplacé par l'heure/date dans le pied). */}
    {!upcoming && (
      <span className={`text-sm font-black tabular-nums ${flash ? "nexus-score-flash" : ""}`} style={{
        color: live ? NEON : BRIGHT,
        textShadow: live ? `0 0 8px ${NEON}66` : "none",
        minWidth: 14, textAlign: "right",
      }}>{score ?? "-"}</span>
    )}
    {!!id && <StarBtn active={favT.has(id)} onClick={() => onToggleTeam(id)} size={13} />}
  </div>
);

export function MatchCard({ m, compact, flash, favL, favT, onToggleLeague, onToggleTeam, onOpen }) {
  const live = m.state === "in";
  const done = m.state === "post";
  const upcoming = !live && !done;
  const demo = !!m.demo;
  const ucl = isUclMatch(m);
  // Match à venir : on affiche l'heure + la date à la place du score.
  const status = live ? (m.clock || m.detail || i18n.t("livescores.in_progress"))
    : done ? (m.detail || i18n.t("livescores.finished"))
    : formatKickoff(m.date);
  return (
    <div
      onClick={() => onOpen?.(m)}
      role="button"
      className={`rounded-2xl p-3 flex flex-col justify-between cursor-pointer active:scale-[0.98] transition-transform ${compact ? "" : "flex-shrink-0"}`}
      style={{
        background: ucl ? `linear-gradient(160deg, ${UCL_BLUE}14, #0a0a0a 55%)` : "#0a0a0a",
        border: `1px solid ${live ? NEON + "33" : ucl ? UCL_BLUE + "55" : "rgba(255,255,255,0.06)"}`,
        width: compact ? "auto" : 178, minHeight: 98,
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <StarBtn active={favL.has(m.league_slug)} onClick={() => onToggleLeague(m.league_slug)} size={13} />
          {ucl && <UclBadge />}
          <span className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: ucl ? "#a9c4ff" : "#6b7686" }}>{m.league}</span>
        </div>
        {demo ? <DemoBadge /> : live ? <LiveBadge /> : upcoming ? <UpcomingBadge /> : null}
      </div>
      <div className="space-y-1.5">
        <Team id={m.home_id} logo={m.home_logo} name={m.home} score={m.home_score} live={live} upcoming={upcoming} flash={flash} favT={favT} onToggleTeam={onToggleTeam} />
        <Team id={m.away_id} logo={m.away_logo} name={m.away} score={m.away_score} live={live} upcoming={upcoming} flash={flash} favT={favT} onToggleTeam={onToggleTeam} />
      </div>
      <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <span className="text-[10px] font-bold flex items-center gap-1" style={{ color: live ? NEON : upcoming ? "#9fb0c8" : "#6b7686" }}>
          {upcoming && <span className="material-symbols-outlined" style={{ fontSize: 12 }}>schedule</span>}
          {status}
        </span>
      </div>
    </div>
  );
}

// Carte de combat MMA / UFC.
function MmaFighter({ f, winner, done }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {f?.avatar ? (
        <img src={f.avatar} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0" style={{ background: "#2a3446" }} loading="lazy" />
      ) : (
        <span className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: "#2a3446" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 14, color: "#5b6577" }}>person</span>
        </span>
      )}
      <span className="text-xs truncate flex-1" style={{ color: winner ? "#f4f8ff" : "#c7d0e0", fontWeight: winner ? 700 : 400 }}>{f?.name}</span>
      {done && winner && (
        <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 16, color: "#fbbf24", filter: "drop-shadow(0 0 4px rgba(251,191,36,0.55))", fontVariationSettings: "'FILL' 1" }}>emoji_events</span>
      )}
    </div>
  );
}

export function MmaCard({ m, compact, flash }) {
  const live = m.state === "in";
  const done = m.state === "post";
  const upcoming = !live && !done;
  const demo = !!m.demo;
  const status = live ? `R${m.round || "?"}${m.clock ? " · " + m.clock : ""}`
    : done ? (m.method || i18n.t("livescores.finished"))
    : formatKickoff(m.date);
  const w1 = done && m.winner && m.f1?.name === m.winner;
  const w2 = done && m.winner && m.f2?.name === m.winner;
  return (
    <div className={`rounded-2xl p-3 flex flex-col justify-between ${compact ? "" : "flex-shrink-0"}`}
      style={{ background: "#0a0a0a", border: `1px solid ${live ? NEON + "33" : "rgba(255,255,255,0.08)"}`, width: compact ? "auto" : 178, minHeight: 98 }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider truncate flex items-center gap-1 min-w-0 flex-1" style={{ color: "#6b7686" }}>
          <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 12, color: "#ef4444" }}>sports_mma</span>
          <span className="truncate">{m.event}</span>
        </span>
        {demo ? <DemoBadge /> : live ? <LiveBadge /> : upcoming ? <UpcomingBadge /> : null}
      </div>
      <div className="space-y-1.5">
        <MmaFighter f={m.f1} winner={w1} done={done} />
        <MmaFighter f={m.f2} winner={w2} done={done} />
      </div>
      <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <span className={`text-[10px] font-bold flex items-center gap-1 ${flash ? "nexus-score-flash" : ""}`} style={{ color: live ? NEON : upcoming ? "#9fb0c8" : "#6b7686" }}>
          {upcoming && <span className="material-symbols-outlined" style={{ fontSize: 12 }}>schedule</span>}
          {status}
        </span>
      </div>
    </div>
  );
}

// Carte WWE — MÊME gabarit que la carte MMA (fond sombre Nexus, 178px, en-tête +
// pied), avec l'identité catch : pastille de marque colorée (Raw rouge · NXT or ·
// SmackDown bleu · PLE violet) et badge LIVE animé pendant le show. WWE reste
// distinct du MMA (sport "wwe" vs "mma").
export function WweCard({ m, compact, flash }) {
  const live = m.state === "in";
  const done = m.state === "post";
  const upcoming = !live && !done;
  const brandColor = m.brand_color || "#e11d48";
  const status = live ? (m.clock || i18n.t("livescores.in_progress"))
    : done ? (m.detail || i18n.t("livescores.finished"))
    : formatKickoff(m.date);
  return (
    <div className={`rounded-2xl p-3 flex flex-col justify-between ${compact ? "" : "flex-shrink-0"}`}
      style={{ background: "#0a0a0a", border: `1px solid ${live ? brandColor + "55" : "rgba(255,255,255,0.08)"}`, boxShadow: flash ? `0 0 18px ${brandColor}44` : "none", width: compact ? "auto" : 178, minHeight: 98 }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="flex items-center gap-1 min-w-0 flex-1">
          <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 12, color: brandColor }}>sports_kabaddi</span>
          <span className="px-2 py-0.5 rounded-full text-[9px] font-black tracking-wider flex-shrink-0" style={{ background: brandColor, color: "#0b1220" }}>{m.brand || "WWE"}</span>
        </span>
        {live ? (
          <span className="flex items-center gap-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: brandColor, boxShadow: `0 0 6px ${brandColor}` }} />
            <span className="text-[9px] font-black" style={{ color: brandColor }}>LIVE</span>
          </span>
        ) : upcoming ? <UpcomingBadge /> : null}
      </div>
      <div className="space-y-1">
        <p className="text-xs font-bold leading-tight truncate" style={{ color: "#f4f8ff" }}>{m.event}</p>
        {(m.venue || m.detail) && (
          <p className="text-[11px] truncate" style={{ color: "#9fb0c8" }}>{m.is_ple ? (m.venue || m.detail) : m.detail}</p>
        )}
      </div>
      <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <span className={`text-[10px] font-bold flex items-center gap-1 ${flash ? "nexus-score-flash" : ""}`} style={{ color: live ? brandColor : upcoming ? "#9fb0c8" : "#6b7686" }}>
          {upcoming && <span className="material-symbols-outlined" style={{ fontSize: 12 }}>schedule</span>}
          {status}
        </span>
      </div>
    </div>
  );
}

// Ligne dense pour ordinateur : même contenu que les cartes mobiles, sans
// format widget. Chaque événement reste dans une liste lisible et scannable.
function DesktopScoreRow({ m, flash, onOpen }) {
  const live = m.state === "in";
  const done = m.state === "post";
  const isMma = m.sport === "mma";
  const title = isMma
    ? `${m.f1?.name || "?"} · ${m.f2?.name || "?"}`
    : `${m.home || "?"} · ${m.away || "?"}`;
  const subtitle = isMma ? m.event : m.league;
  const score = isMma
    ? (live ? `R${m.round || "?"}${m.clock ? ` · ${m.clock}` : ""}` : (done ? (m.method || i18n.t("livescores.finished")) : formatKickoff(m.date)))
    : (live ? (m.clock || i18n.t("livescores.in_progress")) : (done ? i18n.t("livescores.finished") : formatKickoff(m.date)));
  const canOpen = !isMma && typeof onOpen === "function";
  const ClubLogo = ({ src, name }) => src ? (
    <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#ffffff0d", border: "1px solid #ffffff12" }}>
      <img src={src} alt={`Logo ${name || "club"}`} className="w-4 h-4 object-contain" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
    </span>
  ) : (
    <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "#172238", color: "#60a5fa" }}>
      <span className="material-symbols-outlined" style={{ fontSize: 13 }}>sports_soccer</span>
    </span>
  );
  const content = (
    <>
      {isMma ? (
        <span className="material-symbols-outlined flex-shrink-0" style={{ color: live ? NEON : "#ef4444", fontSize: 18 }}>sports_mma</span>
      ) : (
        <span className="flex -space-x-1 flex-shrink-0">
          <ClubLogo src={m.home_logo} name={m.home} />
          <ClubLogo src={m.away_logo} name={m.away} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold" style={{ color: "#dae2fd" }}>{title}</p>
        <p className="truncate text-[10px]" style={{ color: "#859397" }}>{subtitle}</p>
      </div>
      <span className={`flex-shrink-0 text-[10px] font-bold ${flash ? "nexus-score-flash" : ""}`} style={{ color: live ? NEON : "#9fb0c8" }}>
        {live && "LIVE · "}{score}
      </span>
    </>
  );
  const classes = "w-full flex items-center gap-3 py-3 text-left transition-colors";
  return canOpen ? <button type="button" onClick={() => onOpen(m)} className={`${classes} hover:bg-white/[0.03]`}>{content}</button> : <div className={classes}>{content}</div>;
}

function DesktopScoreGroup({ title, icon, color, items, flashing, onOpen }) {
  const [page, setPage] = useState(0);
  const signature = items.map((m) => `${m.sport}-${m.id}`).join("|");
  const pages = Math.max(1, Math.ceil(items.length / DESKTOP_PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const visibleItems = items.slice(safePage * DESKTOP_PAGE_SIZE, (safePage + 1) * DESKTOP_PAGE_SIZE);

  useEffect(() => { setPage(0); }, [signature]);
  if (!items.length) return null;

  return (
    <section>
      <div className="flex items-center justify-between gap-2 pb-2">
        <h3 className="flex min-w-0 items-center gap-2 text-[11px] font-black uppercase tracking-wider" style={{ color }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{icon}</span>
          <span className="truncate">{title}</span>
          <span style={{ color: "#71809a" }}>({items.length})</span>
        </h3>
        {pages > 1 && <span className="text-[10px] font-bold" style={{ color: "#859397" }}>{safePage + 1}/{pages}</span>}
      </div>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
        {visibleItems.map((m) => <DesktopScoreRow key={`${m.sport}-${m.id}`} m={m} flash={!!flashing[`${m.sport}-${m.id}`]} onOpen={onOpen} />)}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-between gap-2 pt-2">
          <button type="button" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={safePage === 0}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold disabled:opacity-35" style={{ color: "#a9c4ff", background: "#ffffff08" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>chevron_left</span> Précédent
          </button>
          <button type="button" onClick={() => setPage((current) => Math.min(pages - 1, current + 1))} disabled={safePage >= pages - 1}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold disabled:opacity-35" style={{ color: "#a9c4ff", background: "#ffffff08" }}>
            Suivant <span className="material-symbols-outlined" style={{ fontSize: 15 }}>chevron_right</span>
          </button>
        </div>
      )}
    </section>
  );
}

function LeagueLogo({ slug, name, size = 28 }) {
  return <img src={getLeagueLogo(slug)} alt={`Logo ${name}`} width={size} height={size} loading="lazy" className="object-contain flex-shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />;
}

function StandingsModal({ favL, onClose }) {
  const available = MAJOR_LEAGUES.filter((league) => favL.size === 0 || favL.has(league.id));
  const [leagueId, setLeagueId] = useState(() => available[0]?.id || MAJOR_LEAGUES[0].id);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const league = MAJOR_LEAGUES.find((item) => item.id === leagueId) || MAJOR_LEAGUES[0];
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchStandingsFromEspn(leagueId).then((next) => { if (active) setRows(next); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [leagueId]);
  return (
    <div className="fixed inset-0 z-[76] flex items-end sm:items-center justify-center sm:p-5" style={{ background: "rgba(2,6,20,0.82)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl p-5" style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", maxHeight: "88vh" }}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2"><span className="material-symbols-outlined" style={{ color: NEON }}>leaderboard</span><h3 className="font-bold text-white">Classements</h3></div>
          <button onClick={onClose} className="material-symbols-outlined" style={{ color: "#9fb0c8" }} aria-label="Fermer">close</button>
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3">
          {available.map((item) => <button key={item.id} onClick={() => setLeagueId(item.id)} className="flex items-center gap-1.5 flex-shrink-0 rounded-xl px-2.5 py-2 text-xs font-bold" style={{ background: item.id === leagueId ? NEON + "20" : "#121212", color: item.id === leagueId ? "#f5f5f5" : "#c9c9c9" }}><LeagueLogo slug={item.id} name={item.name} size={20} />{item.name}</button>)}
        </div>
        <div className="flex items-center gap-2 px-2 py-2 border-y" style={{ borderColor: "rgba(255,255,255,0.07)" }}><LeagueLogo slug={league.id} name={league.name} size={26} /><span className="text-sm font-bold text-white flex-1">{league.name}</span><span className="text-[10px] font-black" style={{ color: "#859397" }}>PTS</span></div>
        <div className="overflow-y-auto no-scrollbar" style={{ maxHeight: "52vh" }}>
          {loading ? <p className="py-8 text-center text-sm" style={{ color: "#859397" }}>Chargement du classement…</p> : rows.length ? rows.map((team) => <div key={team.id || `${team.rank}-${team.name}`} className="flex items-center gap-3 px-2 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}><span className="w-5 text-center text-xs font-black" style={{ color: "#91a3c2" }}>{team.rank}</span>{team.logo ? <img src={team.logo} alt="" className="w-6 h-6 object-contain" loading="lazy" /> : <span className="w-6 h-6 rounded-full" style={{ background: "#25324a" }} />}<span className="flex-1 truncate text-sm font-semibold text-white">{team.name}</span><span className="text-[11px]" style={{ color: "#8fa0b9" }}>{team.played} MJ</span><span className="w-7 text-right text-sm font-black" style={{ color: NEON }}>{team.points}</span></div>) : <p className="py-8 text-center text-sm" style={{ color: "#859397" }}>Classement indisponible pour cette compétition.</p>}
        </div>
      </div>
    </div>
  );
}

// Modale de filtres : ligues et clubs, avec une grille adaptée aux grands écrans.
function FilterModal({ favL, favT, onToggleTeam, onSave, onClose }) {
  const [sel, setSel] = useState(new Set(favL));
  const [saving, setSaving] = useState(false);
  const [teamQuery, setTeamQuery] = useState("");
  const [teamResults, setTeamResults] = useState([]);
  const toggle = (id) => setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const save = async () => { setSaving(true); await onSave(sel); setSaving(false); onClose(); };
  useEffect(() => {
    if (teamQuery.trim().length < 2) { setTeamResults([]); return; }
    let active = true;
    const timer = setTimeout(() => searchTeamsFromEspn(teamQuery, 12).then((items) => { if (active) setTeamResults(items); }), 250);
    return () => { active = false; clearTimeout(timer); };
  }, [teamQuery]);
  return (
    <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: "rgba(2,6,20,0.8)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="w-full sm:max-w-3xl rounded-t-3xl sm:rounded-3xl p-5"
        style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined" style={{ color: NEON }}>tune</span>
          <h3 className="font-bold text-white">{i18n.t("livescores.fav_title")}</h3>
        </div>
        <p className="text-[12px] mb-4" style={{ color: "#859397" }}>Sélectionne des compétitions ou uniquement tes clubs : seuls leurs matchs seront affichés.</p>
        <div className="mb-4 rounded-2xl p-3" style={{ background: "#0b1220" }}>
          <label className="text-[10px] font-black uppercase tracking-wider" style={{ color: "#859397" }}>Tes équipes favorites</label>
          <div className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "#121212" }}><span className="material-symbols-outlined" style={{ color: "#a3a3a3", fontSize: 18 }}>search</span><input value={teamQuery} onChange={(e) => setTeamQuery(e.target.value)} placeholder="PSG, Real Madrid, Arsenal…" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none" /></div>
          {teamResults.length > 0 && <div className="mt-2 grid gap-1 sm:grid-cols-2">{teamResults.map((team) => { const on = favT.has(team.id); return <button key={team.id} onClick={() => onToggleTeam(team.id)} className="flex items-center gap-2 rounded-xl px-2 py-2 text-left" style={{ background: on ? NEON + "16" : "#ffffff08" }}>{team.logo ? <img src={team.logo} alt="" className="w-6 h-6 object-contain" loading="lazy" /> : <span className="w-6 h-6 rounded-full" style={{ background: "#2a3446" }} />}<span className="flex-1 truncate text-xs font-bold" style={{ color: "#eaf1ff" }}>{team.name}</span><span className="material-symbols-outlined" style={{ color: on ? NEON : "#6b7686", fontVariationSettings: `'FILL' ${on ? 1 : 0}` }}>star</span></button>; })}</div>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[42vh] overflow-y-auto no-scrollbar">
          {MAJOR_LEAGUES.map((l) => {
            const on = sel.has(l.id);
            return (
              <button key={l.id} onClick={() => toggle(l.id)}
                className="w-full flex items-center justify-between gap-3 px-3 py-3 rounded-xl text-left active:scale-[0.99] transition-transform"
                style={{ background: on ? NEON + "14" : "#121212" }}>
                <span className="flex items-center gap-2 min-w-0"><LeagueLogo slug={l.id} name={l.name} /><span className="text-sm font-semibold truncate" style={{ color: on ? "#eaf7ee" : "#c7d0e0" }}>{l.name}</span></span>
                <span className="relative flex-shrink-0" style={{ width: 40, height: 22, borderRadius: 999, background: on ? NEON : "#333d52", transition: "background 0.2s" }}>
                  <span className="absolute top-0.5 rounded-full bg-white" style={{ width: 18, height: 18, left: on ? 20 : 2, transition: "left 0.2s" }} />
                </span>
              </button>
            );
          })}
        </div>
        <button onClick={save} disabled={saving}
          className="w-full mt-4 py-3 rounded-2xl font-black text-sm disabled:opacity-50"
          style={{ background: `linear-gradient(135deg,${NEON},#22d3ee)`, color: "#04250f" }}>
          {saving ? i18n.t("livescores.saving") : i18n.t("livescores.save")}
        </button>
        <button onClick={onClose} disabled={saving}
          className="w-full mt-2 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
          style={{ background: "#181818", color: "#c9c9c9" }}>{i18n.t("livescores.close")}</button>
      </div>
    </div>
  );
}

export default function LiveScores({ variant = "mobile", setUser }) {
  const [matches, setMatches] = useState([]);
  const [favL, setFavL] = useState(() => new Set(readSavedLeagues()));
  const [favT, setFavT] = useState(() => new Set(readSavedTeams()));
  const [showFilter, setShowFilter] = useState(false);
  const [showStandings, setShowStandings] = useState(false);
  const [openMatch, setOpenMatch] = useState(null);
  const [confirmHide, setConfirmHide] = useState(false);
  const [fading, setFading] = useState(false);
  const [flashing, setFlashing] = useState({});   // clé sport-id -> true (score qui vient de changer)
  const sigRef = useRef({});                        // clé -> signature (score/résultat) précédente
  const hasLiveRef = useRef(false);

  // Récupère les scores + DÉTECTE les changements (score foot, résultat MMA) pour
  // déclencher le flash néon sur le nouveau chiffre.
  const load = useCallback(() => {
    // Scores : ESPN DIRECT (navigateur) car ESPN bloque l'IP Cloud Run (403).
    // Favoris : backend (/livescores renvoie aussi les favoris de l'utilisateur).
    const favP = axios.get(`${API}/livescores`).then((r) => r.data || {}).catch(() => ({}));
    const espnP = fetchLiveScoresFromEspn().catch(() => []);
    Promise.all([favP, espnP]).then(([d, espn]) => {
      const backendItems = Array.isArray(d.matches) ? d.matches : [];
      const items = espn.length ? espn : backendItems; // ESPN direct prioritaire
      const changed = [];
      for (const m of items) {
        const key = `${m.sport}-${m.id}`;
        const sig = m.sport === "mma" ? `${m.state}|${m.winner || ""}` : `${m.home_score}-${m.away_score}`;
        if (key in sigRef.current && sigRef.current[key] !== sig) changed.push(key);
        sigRef.current[key] = sig;
      }
      setMatches(items);
      // Le serveur reste la source partagée quand il répond avec des favoris.
      // Sinon, on garde le choix local : le filtre continue de fonctionner même
      // lors d'une indisponibilité temporaire de l'API.
      const serverLeagues = d.favorites && Array.isArray(d.favorites.leagues)
        ? d.favorites.leagues
        : readSavedLeagues();
      const serverTeams = d.favorites && Array.isArray(d.favorites.teams)
        ? d.favorites.teams
        : readSavedTeams();
      setFavL(new Set(serverLeagues));
      setFavT(new Set(serverTeams));
      if (changed.length) {
        setFlashing((f) => { const n = { ...f }; changed.forEach((k) => (n[k] = true)); return n; });
        changed.forEach((k) => setTimeout(() =>
          setFlashing((f) => { const n = { ...f }; delete n[k]; return n; }), 3000));
      }
    });
  }, []);

  // Rythme ADAPTATIF (temps réel « à la Flashscore » sans SSE) : 15 s si un match
  // est en cours ET l'onglet est visible ; 60 s sinon. Rien en arrière-plan
  // (onglet caché) → coût minimal, compatible scale-to-zero Cloud Run.
  useEffect(() => {
    let alive = true, timer = null;
    const tick = () => {
      if (!alive) return;
      if (document.visibilityState === "visible") load();
      const fast = hasLiveRef.current && document.visibilityState === "visible";
      timer = setTimeout(tick, fast ? 15000 : 60000);
    };
    tick();
    const onVis = () => { if (document.visibilityState === "visible") { clearTimeout(timer); tick(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  useEffect(() => { hasLiveRef.current = matches.some((m) => m.state === "in"); }, [matches]);

  // Bascule un favori : maj optimiste + tri instantané, persistée en tâche de fond.
  const toggleFav = (kind, id) => {
    if (!id) return;
    const setFav = kind === "league" ? setFavL : setFavT;
    setFav((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      if (kind === "league") saveLeaguesLocally(Array.from(n));
      else saveTeamsLocally(Array.from(n));
      return n;
    });
    axios.post(`${API}/users/me/sports-favorites/toggle`, { kind, id }).catch(() => {
      // Le choix local est volontairement conservé : le serveur se resynchronisera
      // au prochain accès réussi, sans faire réapparaître les ligues masquées.
      toast.error(i18n.t("livescores.err_save"));
    });
  };
  const onToggleLeague = (id) => toggleFav("league", id);
  const onToggleTeam = (id) => toggleFav("team", id);

  const saveFilter = async (selSet) => {
    const leagues = Array.from(selSet);
    // Application instantanée et sauvegarde locale : le filtre ne dépend pas
    // d'un éventuel délai ou échec du backend.
    setFavL(new Set(leagues));
    saveLeaguesLocally(leagues);
    saveTeamsLocally(Array.from(favT));
    try {
      await axios.put(`${API}/users/me/sports-favorites`, { leagues, teams: Array.from(favT) });
      toast.success(i18n.t("livescores.favs_saved"));
    } catch { toast.error(i18n.t("livescores.err_save")); }
  };

  // Masquer TOUT le widget (foot + MMA) : persistance MongoDB + fondu + maj user.
  const doHide = () => {
    setConfirmHide(false);
    setFading(true);
    setTimeout(() => {
      axios.put(`${API}/users/me/show-sports`, { show_sports: false, show_mma: false }).catch(() => {});
      setUser?.((prev) => (prev ? { ...prev, show_sports: false, show_mma: false } : prev));
    }, 340);
  };

  // Repli DÉMO (opt-in) quand l'API ne renvoie aucun match → permet de voir le widget.
  const src = (matches.length ? matches : (demoScoresOn() ? DEMO_SCORES : [])).filter(keepRecentEvent);
  if (!src.length) return null;
  const cardProps = { favL, favT, onToggleLeague, onToggleTeam, onOpen: setOpenMatch };

  // Foot + MMA : direct prioritaire, sinon 3 prochains à venir (par sport).
  const footItems = displayMatches(src.filter((m) => m.sport !== "mma"), favL, favT);
  const mmaItems = displayMatches(src.filter((m) => m.sport === "mma"), favL, favT);
  let arranged;
  if (footItems.length && mmaItems.length) {
    arranged = [];
    for (let i = 0; i < Math.max(footItems.length, mmaItems.length); i++) {
      if (i < footItems.length) arranged.push(footItems[i]);
      if (i < mmaItems.length) arranged.push(mmaItems[i]);
    }
  } else {
    arranged = footItems.length ? footItems : mmaItems;
  }
  const renderCard = (m, compact) => (m.sport === "mma"
    ? <MmaCard key={`mma-${m.id}`} m={m} compact={compact} flash={!!flashing[`mma-${m.id}`]} />
    : <MatchCard key={`foot-${m.id}`} m={m} compact={compact} flash={!!flashing[`foot-${m.id}`]} {...cardProps} />);
  const fadeStyle = { opacity: fading ? 0 : 1, transition: "opacity 0.34s ease" };

  const iconBtn = (icon, onClick, label) => (
    <button onClick={onClick} aria-label={label}
      className="flex items-center justify-center w-7 h-7 rounded-lg active:scale-90 transition-transform" style={{ background: "rgba(255,255,255,0.06)" }}>
      <span className="material-symbols-outlined" style={{ color: "#9fb0c8", fontSize: 18 }}>{icon}</span>
    </button>
  );

  const header = (big) => (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <span className="material-symbols-outlined" style={{ color: NEON, fontSize: big ? 20 : 16 }}>sports_soccer</span>
        {big ? (
          <span className="font-headline font-bold text-base tracking-tight" style={{ color: "#dae2fd" }}>{i18n.t("livescores.title")}</span>
        ) : (
          <span className="font-black uppercase tracking-wider text-xs" style={{ color: "#8b96a8" }}>{i18n.t("livescores.title")}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {iconBtn("leaderboard", () => setShowStandings(true), "Voir les classements")}
        {iconBtn("tune", () => setShowFilter(true), i18n.t("livescores.filter_aria"))}
        {iconBtn("close", () => setConfirmHide(true), i18n.t("livescores.hide_aria"))}
      </div>
    </div>
  );

  // Alerte épurée de confirmation de masquage.
  const confirmDialog = confirmHide && (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.88)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmHide(false); }}>
      <div className="w-full max-w-xs rounded-3xl p-5 text-center"
        style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.1)" }}>
        <span className="material-symbols-outlined mb-2" style={{ color: "#9fb0c8", fontSize: 30 }}>visibility_off</span>
        <h3 className="text-white font-bold text-base mb-1">{i18n.t("livescores.hide_confirm")}</h3>
        <p className="text-xs mb-4" style={{ color: "#859397" }}>{i18n.t("livescores.hide_body")}</p>
        <button onClick={doHide}
          className="w-full py-2.5 rounded-xl font-bold text-sm active:scale-95 transition-transform mb-2"
          style={{ background: "#f87171", color: "#2a0808" }}>
          {i18n.t("livescores.hide")}
        </button>
        <button onClick={() => setConfirmHide(false)}
          className="w-full py-2.5 rounded-xl font-bold text-sm" style={{ background: "#181818", color: "#c9c9c9" }}>
          {i18n.t("livescores.cancel")}
        </button>
      </div>
    </div>
  );

  if (variant === "sidebar") {
    return (
      <section className="rounded-2xl p-4" style={{ background: "#050505", border: "1px solid rgba(255,255,255,0.08)", ...fadeStyle }}>
        <div className="mb-3">{header(true)}</div>
        <div className="space-y-2 max-h-[70vh] overflow-y-auto no-scrollbar">
          {arranged.map((m) => renderCard(m, true))}
        </div>
        {showFilter && <FilterModal favL={favL} favT={favT} onToggleTeam={onToggleTeam} onSave={saveFilter} onClose={() => setShowFilter(false)} />}
        {showStandings && <StandingsModal favL={favL} onClose={() => setShowStandings(false)} />}
        {openMatch && <MatchCenter match={openMatch} onClose={() => setOpenMatch(null)} />}
        {confirmDialog}
      </section>
    );
  }

  if (variant === "desktop-list") {
    const liveItems = [...footItems, ...mmaItems].filter((m) => m.state === "in");
    const footUpcoming = footItems.filter((m) => m.state === "pre");
    const footFinished = footItems.filter((m) => m.state === "post");
    const mmaUpcoming = mmaItems.filter((m) => m.state === "pre");
    const mmaFinished = mmaItems.filter((m) => m.state === "post");
    return (
      <section style={fadeStyle}>
        <div className="mb-2">{header(true)}</div>
        <div className="space-y-5">
          <DesktopScoreGroup title="En direct" icon="sensors" color={NEON} items={liveItems} flashing={flashing} onOpen={setOpenMatch} />
          <DesktopScoreGroup title="Football" icon="sports_soccer" color="#4ade80" items={footUpcoming} flashing={flashing} onOpen={setOpenMatch} />
          <DesktopScoreGroup title="Football — terminés" icon="history" color="#9fb0c8" items={footFinished} flashing={flashing} onOpen={setOpenMatch} />
          <DesktopScoreGroup title="MMA / UFC" icon="sports_mma" color="#f87171" items={mmaUpcoming} flashing={flashing} onOpen={setOpenMatch} />
          <DesktopScoreGroup title="MMA / UFC — terminés" icon="history" color="#f3a5a5" items={mmaFinished} flashing={flashing} onOpen={setOpenMatch} />
        </div>
        {showFilter && <FilterModal favL={favL} favT={favT} onToggleTeam={onToggleTeam} onSave={saveFilter} onClose={() => setShowFilter(false)} />}
        {showStandings && <StandingsModal favL={favL} onClose={() => setShowStandings(false)} />}
        {openMatch && <MatchCenter match={openMatch} onClose={() => setOpenMatch(null)} />}
        {confirmDialog}
      </section>
    );
  }

  return (
    <div className="pt-1 pb-2" style={fadeStyle}>
      <div className="px-4 mb-1.5">{header(false)}</div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4">
        {arranged.map((m) => renderCard(m, false))}
      </div>
      {showFilter && <FilterModal favL={favL} favT={favT} onToggleTeam={onToggleTeam} onSave={saveFilter} onClose={() => setShowFilter(false)} />}
      {showStandings && <StandingsModal favL={favL} onClose={() => setShowStandings(false)} />}
      {openMatch && <MatchCenter match={openMatch} onClose={() => setOpenMatch(null)} />}
      {confirmDialog}
    </div>
  );
}
