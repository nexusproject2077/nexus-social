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
import { fetchLiveScoresFromEspn } from "@/lib/espnClient";
import { fetchWweEvents } from "@/lib/wweClient";
import i18n from "@/i18n";

const NEON = "#4ade80"; // vert néon (match en cours)
const BRIGHT = "#f4f8ff"; // blanc brillant
const UCL_BLUE = "#5b8def"; // bleu Champions League (badge / bandeau)

// Un match relève-t-il de la Ligue des Champions (masculine OU féminine) ?
// On s'appuie sur le drapeau is_ucl posé côté ESPN, avec repli sur le slug pour
// les matchs venant du backend qui ne le portent pas encore.
export const isUclMatch = (m) =>
  !!m &&
  (m.is_ucl === true ||
    m.league_slug === "uefa.champions" ||
    m.league_slug === "uefa.wchampions");

// Le coup d'envoi est-il dans les h prochaines heures (match pas encore joué) ?
const withinHours = (dateStr, h) => {
  const t = new Date(dateStr).getTime();
  if (isNaN(t)) return false;
  const diff = t - Date.now();
  return diff >= 0 && diff <= h * 3600e3;
};

// Petit blason UCL (étoile stylisée) — 100 % SVG, glow bleu Champions League.
const UclBadge = ({ size = 13 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden
    style={{ filter: `drop-shadow(0 0 4px ${UCL_BLUE}88)`, flexShrink: 0 }}
  >
    <path
      d="M12 2.6l2.6 5.5 6 .8-4.4 4.1 1.1 6L12 16.1 6.7 19l1.1-6L3.4 8.9l6-.8L12 2.6z"
      fill={UCL_BLUE}
    />
  </svg>
);

// Nom d'utilisateur courant (pour bâtir le lien de parrainage ?ref=).
const myUsername = () => {
  try {
    return JSON.parse(localStorage.getItem("user") || "{}")?.username || null;
  } catch {
    return null;
  }
};

// Bandeau « Soirée Champions League » : affiché quand un match UCL est en direct
// ou démarre dans les 6 h. Porte un CTA « Invite tes potes pour le match » qui
// partage le lien de parrainage (boucle de croissance sur les soirs UCL).
const UclMatchdayBanner = ({ matches }) => {
  const uclLive = matches.some((m) => isUclMatch(m) && m.state === "in");
  const uclSoon = matches.some(
    (m) => isUclMatch(m) && m.state !== "post" && withinHours(m.date, 6),
  );
  if (!uclLive && !uclSoon) return null;

  const inviteFriends = async () => {
    const u = myUsername();
    const link = `${window.location.origin}/${u ? `?ref=${encodeURIComponent(u)}` : ""}`;
    const text = i18n.t("livescores.ucl_invite_text");
    if (navigator.share) {
      try {
        await navigator.share({ title: "Nexus Social", text, url: link });
        return;
      } catch {
        /* annulé → repli copie */
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      toast.success(i18n.t("referral.copied"));
    } catch {
      toast.error(i18n.t("error_occurred"));
    }
  };

  return (
    <div
      className="mb-2 px-3 py-2 rounded-xl"
      style={{
        background: `linear-gradient(90deg, ${UCL_BLUE}26, rgba(11,18,32,0))`,
        border: `1px solid ${UCL_BLUE}55`,
      }}
    >
      <div className="flex items-center gap-2">
        <UclBadge size={16} />
        <span
          className="text-[11px] font-black uppercase tracking-wider"
          style={{ color: "#cfe0ff" }}
        >
          {i18n.t("livescores.ucl_matchday")}
        </span>
        {uclLive && (
          <span className="flex items-center gap-1 ml-auto flex-shrink-0">
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: NEON, boxShadow: `0 0 6px ${NEON}` }}
            />
            <span className="text-[9px] font-black" style={{ color: NEON }}>
              LIVE
            </span>
          </span>
        )}
      </div>
      <button
        onClick={inviteFriends}
        className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold active:scale-[0.98] transition-transform"
        style={{ background: UCL_BLUE, color: "#04122e" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M16 11c1.66 0 3-1.34 3-3s-1.34-3-3-3M8 11a3 3 0 100-6 3 3 0 000 6zM2 20c0-2.5 2.7-4 6-4s6 1.5 6 4M18 14c2 .4 4 1.6 4 4"
            stroke="#04122e"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {i18n.t("livescores.ucl_invite")}
      </button>
    </div>
  );
};

// Mode DÉMO (opt-in : ?demo=1 ou localStorage) — affiche des cartes de test
// étiquetées « DÉMO » quand l'API ne renvoie aucun match. Jamais présenté comme réel.
const demoScoresOn = () => {
  try {
    return (
      new URLSearchParams(window.location.search).get("demo") === "1" ||
      localStorage.getItem("nexus_demo_scores") === "1"
    );
  } catch {
    return false;
  }
};
const DEMO_SCORES = [
  {
    id: "demo-ren-psg",
    sport: "foot",
    league: "Ligue 1",
    league_slug: "fra.1",
    home: "Rennes",
    away: "PSG",
    home_id: "",
    away_id: "",
    home_logo: null,
    away_logo: null,
    home_score: "0",
    away_score: "0",
    state: "in",
    clock: "1'",
    detail: "1'",
    date: new Date().toISOString(),
    demo: true,
  },
  {
    id: "demo-om-ol",
    sport: "foot",
    league: "Ligue 1",
    league_slug: "fra.1",
    home: "Marseille",
    away: "Lyon",
    home_id: "",
    away_id: "",
    home_logo: null,
    away_logo: null,
    home_score: null,
    away_score: null,
    state: "pre",
    clock: "",
    detail: "À venir",
    date: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    demo: true,
  },
  {
    id: "demo-ufc",
    sport: "mma",
    event: "UFC 300",
    f1: { name: "Jon Jones", avatar: null, winner: false },
    f2: { name: "Tom Aspinall", avatar: null, winner: false },
    state: "in",
    round: 3,
    clock: "02:15",
    method: "",
    winner: null,
    detail: "R3 · 02:15",
    date: new Date().toISOString(),
    demo: true,
  },
  // Terminé (score final, ~3 h) — pour visualiser la carte « dernier résultat 24 h ».
  {
    id: "demo-len-mon",
    sport: "foot",
    league: "Ligue 1",
    league_slug: "fra.1",
    home: "Lens",
    away: "Monaco",
    home_id: "",
    away_id: "",
    home_logo: null,
    away_logo: null,
    home_score: "1",
    away_score: "2",
    state: "post",
    clock: "",
    detail: "Terminé",
    date: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    demo: true,
  },
];

// Ligues majeures proposées dans la modale de filtres (slugs ESPN).
export const MAJOR_LEAGUES = [
  { id: "uefa.champions", name: "Ligue des Champions" },
  { id: "fra.1", name: "Ligue 1" },
  { id: "eng.1", name: "Premier League" },
  { id: "esp.1", name: "LaLiga" },
  { id: "ita.1", name: "Serie A" },
  { id: "ger.1", name: "Bundesliga" },
  { id: "uefa.europa", name: "Ligue Europa" },
  { id: "fifa.world", name: "Coupe du Monde" },
  { id: "uefa.euro", name: "Euro" },
  { id: "usa.1", name: "MLS" },
];

const STATE_ORDER = { in: 0, pre: 1, post: 2 };

// Tri client identique au backend : favoris d'abord, puis en cours, puis date.
export function sortMatches(list, favL, favT) {
  const isFav = (m) =>
    favL.has(m.league_slug) || favT.has(m.home_id) || favT.has(m.away_id);
  return [...list].sort(
    (a, b) =>
      (isFav(a) ? 0 : 1) - (isFav(b) ? 0 : 1) ||
      (STATE_ORDER[a.state] ?? 3) - (STATE_ORDER[b.state] ?? 3) ||
      String(a.date || "").localeCompare(String(b.date || "")),
  );
}

// Sélection à afficher, dans l'ordre : EN DIRECT (priorité absolue) → les
// prochains À VENIR (chronologiques) → les derniers TERMINÉS avec leur score
// final (plus récents d'abord, ~24 h). Favoris remontés dans chaque groupe.
export function displayMatches(list, favL, favT) {
  const isFav = (m) =>
    favL.has(m.league_slug) || favT.has(m.home_id) || favT.has(m.away_id);
  // Priorité : favoris d'abord, puis Ligue des Champions, puis le reste
  // (tri stable → l'ordre par date est conservé à rang égal).
  const rank = (m) => (isFav(m) ? 0 : 2) + (isUclMatch(m) ? 0 : 1);
  const favFirst = (arr) => [...arr].sort((a, b) => rank(a) - rank(b));
  const asc = (a, b) =>
    String(a.date || "").localeCompare(String(b.date || ""));
  const desc = (a, b) =>
    String(b.date || "").localeCompare(String(a.date || ""));
  const live = favFirst(list.filter((m) => m.state === "in"));
  const pre = favFirst(list.filter((m) => m.state === "pre").sort(asc)).slice(
    0,
    3,
  );
  const post = favFirst(
    list.filter((m) => m.state === "post").sort(desc),
  ).slice(0, 2); // derniers scores finals
  const out = [...live, ...pre, ...post];
  return out.length ? out : list.slice(0, 3);
}

// Heure + jour du coup d'envoi, format ultra-court (ex : « Dim. 15:00 »,
// « Auj. 21:00 », « Dem. 18:30 »).
export function formatKickoff(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return i18n.t("livescores.upcoming");
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString(i18n.language || "en", {
    hour: "2-digit",
    minute: "2-digit",
  });
  // Aujourd'hui → heure seule (ex : « 20:45 ») ; sinon on préfixe le jour.
  if (d.toDateString() === now.toDateString()) return time;
  if (d.toDateString() === tomorrow.toDateString())
    return `${i18n.t("livescores.tomorrow_prefix")} ${time}`;
  const day = d.toLocaleDateString(i18n.language || "en", { weekday: "short" });
  return `${day.charAt(0).toUpperCase() + day.slice(1)} ${time}`;
}

// Badge « À VENIR » discret (gris anthracite) — remplace le badge LIVE.
const UpcomingBadge = () => (
  <span
    className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-wide"
    style={{ background: "#232c3a", color: "#9fb0c8" }}
  >
    {i18n.t("livescores.upcoming_badge")}
  </span>
);

// Badge DÉMO (données de simulation, jamais présentées comme réelles).
const DemoBadge = () => (
  <span
    className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-wide"
    style={{ background: "#f59e0b22", color: "#fbbf24" }}
  >
    {i18n.t("livescores.demo_badge")}
  </span>
);

// Badge LIVE néon (match en cours).
const LiveBadge = () => (
  <span className="flex items-center gap-1 flex-shrink-0">
    <span
      className="w-1.5 h-1.5 rounded-full animate-pulse"
      style={{ background: NEON, boxShadow: `0 0 6px ${NEON}` }}
    />
    <span className="text-[9px] font-black" style={{ color: NEON }}>
      LIVE
    </span>
  </span>
);

// Étoile favori (SVG premium via material-symbols) — remplie/allumée si actif.
const StarBtn = ({ active, onClick, size = 15 }) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className="flex items-center justify-center flex-shrink-0 active:scale-90 transition-transform"
    aria-label={
      active ? i18n.t("livescores.fav_remove") : i18n.t("livescores.fav_add")
    }
    style={{ width: size + 4, height: size + 4 }}
  >
    <span
      className="material-symbols-outlined"
      style={{
        fontSize: size,
        color: active ? NEON : "#5b6577",
        fontVariationSettings: `'FILL' ${active ? 1 : 0}, 'wght' 400`,
        filter: active ? `drop-shadow(0 0 5px ${NEON}77)` : "none",
      }}
    >
      star
    </span>
  </button>
);

const Team = ({
  id,
  logo,
  name,
  score,
  live,
  upcoming,
  flash,
  favT,
  onToggleTeam,
}) => (
  <div className="flex items-center gap-1.5 min-w-0">
    {logo ? (
      <img
        src={logo}
        alt=""
        className="w-4 h-4 object-contain flex-shrink-0"
        loading="lazy"
      />
    ) : (
      <span
        className="w-4 h-4 rounded-full flex-shrink-0"
        style={{ background: "#2a3446" }}
      />
    )}
    <span className="text-xs truncate flex-1" style={{ color: "#c7d0e0" }}>
      {name}
    </span>
    {/* Match à venir : pas de score (remplacé par l'heure/date dans le pied). */}
    {!upcoming && (
      <span
        className={`text-sm font-black tabular-nums ${flash ? "nexus-score-flash" : ""}`}
        style={{
          color: live ? NEON : BRIGHT,
          textShadow: live ? `0 0 8px ${NEON}66` : "none",
          minWidth: 14,
          textAlign: "right",
        }}
      >
        {score ?? "-"}
      </span>
    )}
    {!!id && (
      <StarBtn
        active={favT.has(id)}
        onClick={() => onToggleTeam(id)}
        size={13}
      />
    )}
  </div>
);

export function MatchCard({
  m,
  compact,
  flash,
  favL,
  favT,
  onToggleLeague,
  onToggleTeam,
  onOpen,
}) {
  const live = m.state === "in";
  const done = m.state === "post";
  const upcoming = !live && !done;
  const demo = !!m.demo;
  const ucl = isUclMatch(m);
  // Match à venir : on affiche l'heure + la date à la place du score.
  const status = live
    ? m.clock || m.detail || i18n.t("livescores.in_progress")
    : done
      ? m.detail || i18n.t("livescores.finished")
      : formatKickoff(m.date);
  return (
    <div
      onClick={() => onOpen?.(m)}
      role="button"
      className={`rounded-2xl p-3 flex flex-col justify-between cursor-pointer active:scale-[0.98] transition-transform ${compact ? "" : "flex-shrink-0"}`}
      style={{
        background: ucl
          ? `linear-gradient(160deg, ${UCL_BLUE}1f, #111827 55%)`
          : "#111827",
        border: `1px solid ${live ? NEON + "33" : ucl ? UCL_BLUE + "55" : "rgba(255,255,255,0.06)"}`,
        width: compact ? "auto" : 178,
        minHeight: 98,
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <StarBtn
            active={favL.has(m.league_slug)}
            onClick={() => onToggleLeague(m.league_slug)}
            size={13}
          />
          {ucl && <UclBadge />}
          <span
            className="text-[10px] font-bold uppercase tracking-wider truncate"
            style={{ color: ucl ? "#a9c4ff" : "#6b7686" }}
          >
            {m.league}
          </span>
        </div>
        {demo ? (
          <DemoBadge />
        ) : live ? (
          <LiveBadge />
        ) : upcoming ? (
          <UpcomingBadge />
        ) : null}
      </div>
      <div className="space-y-1.5">
        <Team
          id={m.home_id}
          logo={m.home_logo}
          name={m.home}
          score={m.home_score}
          live={live}
          upcoming={upcoming}
          flash={flash}
          favT={favT}
          onToggleTeam={onToggleTeam}
        />
        <Team
          id={m.away_id}
          logo={m.away_logo}
          name={m.away}
          score={m.away_score}
          live={live}
          upcoming={upcoming}
          flash={flash}
          favT={favT}
          onToggleTeam={onToggleTeam}
        />
      </div>
      <div
        className="mt-2 pt-2"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        <span
          className="text-[10px] font-bold flex items-center gap-1"
          style={{ color: live ? NEON : upcoming ? "#9fb0c8" : "#6b7686" }}
        >
          {upcoming && (
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 12 }}
            >
              schedule
            </span>
          )}
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
        <img
          src={f.avatar}
          alt=""
          className="w-6 h-6 rounded-full object-cover flex-shrink-0"
          style={{ background: "#2a3446" }}
          loading="lazy"
        />
      ) : (
        <span
          className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center"
          style={{ background: "#2a3446" }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 14, color: "#5b6577" }}
          >
            person
          </span>
        </span>
      )}
      <span
        className="text-xs truncate flex-1"
        style={{
          color: winner ? "#f4f8ff" : "#c7d0e0",
          fontWeight: winner ? 700 : 400,
        }}
      >
        {f?.name}
      </span>
      {done && winner && (
        <span
          className="material-symbols-outlined flex-shrink-0"
          style={{
            fontSize: 16,
            color: "#fbbf24",
            filter: "drop-shadow(0 0 4px rgba(251,191,36,0.55))",
            fontVariationSettings: "'FILL' 1",
          }}
        >
          emoji_events
        </span>
      )}
    </div>
  );
}

export function MmaCard({ m, compact, flash }) {
  const live = m.state === "in";
  const done = m.state === "post";
  const upcoming = !live && !done;
  const demo = !!m.demo;
  const status = live
    ? `R${m.round || "?"}${m.clock ? " · " + m.clock : ""}`
    : done
      ? m.method || i18n.t("livescores.finished")
      : formatKickoff(m.date);
  const w1 = done && m.winner && m.f1?.name === m.winner;
  const w2 = done && m.winner && m.f2?.name === m.winner;
  return (
    <div
      className={`rounded-2xl p-3 flex flex-col justify-between ${compact ? "" : "flex-shrink-0"}`}
      style={{
        background: "#111827",
        border: `1px solid ${live ? NEON + "33" : "rgba(255,255,255,0.06)"}`,
        width: compact ? "auto" : 178,
        minHeight: 98,
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span
          className="text-[10px] font-bold uppercase tracking-wider truncate flex items-center gap-1 min-w-0 flex-1"
          style={{ color: "#6b7686" }}
        >
          <span
            className="material-symbols-outlined flex-shrink-0"
            style={{ fontSize: 12, color: "#ef4444" }}
          >
            sports_mma
          </span>
          <span className="truncate">{m.event}</span>
        </span>
        {demo ? (
          <DemoBadge />
        ) : live ? (
          <LiveBadge />
        ) : upcoming ? (
          <UpcomingBadge />
        ) : null}
      </div>
      <div className="space-y-1.5">
        <MmaFighter f={m.f1} winner={w1} done={done} />
        <MmaFighter f={m.f2} winner={w2} done={done} />
      </div>
      <div
        className="mt-2 pt-2"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        <span
          className={`text-[10px] font-bold flex items-center gap-1 ${flash ? "nexus-score-flash" : ""}`}
          style={{ color: live ? NEON : upcoming ? "#9fb0c8" : "#6b7686" }}
        >
          {upcoming && (
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 12 }}
            >
              schedule
            </span>
          )}
          {status}
        </span>
      </div>
    </div>
  );
}

// Modale de filtres : cocher les ligues majeures (Toggles).

export function WweCard({ m, compact, flash, onOpen }) {
  const live = m.state === "in";
  const upcoming = m.state === "pre";
  const brandColor = m.brand_color || "#e11d48";
  return (
    <button
      type="button"
      onClick={() => onOpen?.(m)}
      className={`flex-shrink-0 text-left rounded-2xl p-3 transition-all active:scale-[0.98] ${compact ? "w-full" : "w-[200px]"}`}
      style={{
        background: live
          ? "linear-gradient(145deg,rgba(225,29,72,0.18),rgba(15,20,35,0.95))"
          : "#0d1424",
        border: live
          ? `1px solid ${brandColor}66`
          : "1px solid rgba(255,255,255,0.06)",
        boxShadow: flash
          ? `0 0 20px ${brandColor}44`
          : live
            ? `0 0 16px ${brandColor}22`
            : "none",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] font-black tracking-wider px-1.5 py-0.5 rounded"
          style={{ background: brandColor, color: "#0b1220" }}
        >
          {m.brand || "WWE"}
        </span>
        {live ? (
          <span
            className="flex items-center gap-1 text-[10px] font-bold"
            style={{ color: "#f87171" }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: "#f87171" }}
            />
            LIVE
          </span>
        ) : (
          <span className="text-[10px]" style={{ color: "#859397" }}>
            {m.clock}
          </span>
        )}
      </div>
      <p className="text-sm font-bold text-white leading-tight mb-1 truncate">
        {m.event}
      </p>
      <p className="text-[11px] truncate" style={{ color: "#9fb0c8" }}>
        {m.is_ple ? m.venue || m.detail : live ? m.clock : m.detail}
      </p>
      {upcoming && (
        <p
          className="text-[10px] mt-1.5 font-semibold"
          style={{ color: brandColor }}
        >
          {m.clock}
        </p>
      )}
    </button>
  );
}

function FilterModal({ favL, onSave, onClose }) {
  const [sel, setSel] = useState(new Set(favL));
  const [saving, setSaving] = useState(false);
  const toggle = (id) =>
    setSel((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const save = async () => {
    setSaving(true);
    await onSave(sel);
    setSaving(false);
    onClose();
  };
  return (
    <div
      className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: "rgba(2,6,20,0.8)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5"
        style={{
          background: "#111827",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined" style={{ color: NEON }}>
            tune
          </span>
          <h3 className="font-bold text-white">
            {i18n.t("livescores.fav_title")}
          </h3>
        </div>
        <p className="text-[12px] mb-4" style={{ color: "#859397" }}>
          {i18n.t("livescores.fav_sub")}
        </p>
        <div className="space-y-1 max-h-[52vh] overflow-y-auto no-scrollbar">
          {MAJOR_LEAGUES.map((l) => {
            const on = sel.has(l.id);
            return (
              <button
                key={l.id}
                onClick={() => toggle(l.id)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left active:scale-[0.99] transition-transform"
                style={{ background: on ? NEON + "14" : "#1a2234" }}
              >
                <span
                  className="text-sm font-semibold"
                  style={{ color: on ? "#eaf7ee" : "#c7d0e0" }}
                >
                  {l.name}
                </span>
                <span
                  className="relative flex-shrink-0"
                  style={{
                    width: 40,
                    height: 22,
                    borderRadius: 999,
                    background: on ? NEON : "#333d52",
                    transition: "background 0.2s",
                  }}
                >
                  <span
                    className="absolute top-0.5 rounded-full bg-white"
                    style={{
                      width: 18,
                      height: 18,
                      left: on ? 20 : 2,
                      transition: "left 0.2s",
                    }}
                  />
                </span>
              </button>
            );
          })}
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="w-full mt-4 py-3 rounded-2xl font-black text-sm disabled:opacity-50"
          style={{
            background: `linear-gradient(135deg,${NEON},#22d3ee)`,
            color: "#04250f",
          }}
        >
          {saving ? i18n.t("livescores.saving") : i18n.t("livescores.save")}
        </button>
        <button
          onClick={onClose}
          disabled={saving}
          className="w-full mt-2 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
          style={{ background: "#222a3d", color: "#a7b3cc" }}
        >
          {i18n.t("livescores.close")}
        </button>
      </div>
    </div>
  );
}

export default function LiveScores({ variant = "mobile", setUser }) {
  const [matches, setMatches] = useState([]);
  const [favL, setFavL] = useState(() => new Set());
  const [favT, setFavT] = useState(() => new Set());
  const [showFilter, setShowFilter] = useState(false);
  const [openMatch, setOpenMatch] = useState(null);
  const [confirmHide, setConfirmHide] = useState(false);
  const [fading, setFading] = useState(false);
  const [flashing, setFlashing] = useState({}); // clé sport-id -> true (score qui vient de changer)
  const sigRef = useRef({}); // clé -> signature (score/résultat) précédente
  const hasLiveRef = useRef(false);

  // Récupère les scores + DÉTECTE les changements (score foot, résultat MMA) pour
  // déclencher le flash néon sur le nouveau chiffre.
  const load = useCallback(() => {
    // Scores : ESPN DIRECT (navigateur) car ESPN bloque l'IP Cloud Run (403).
    // Favoris : backend (/livescores renvoie aussi les favoris de l'utilisateur).
    const favP = axios
      .get(`${API}/livescores`)
      .then((r) => r.data || {})
      .catch(() => ({}));
    const espnP = fetchLiveScoresFromEspn().catch(() => []);
    Promise.all([favP, espnP, fetchWweEvents().catch(() => [])]).then(
      ([d, espn, wwe]) => {
        const backendItems = Array.isArray(d.matches) ? d.matches : [];
        const base = espn.length ? espn : backendItems; // ESPN direct prioritaire
        const items = [...base, ...(Array.isArray(wwe) ? wwe : [])];
        const changed = [];
        for (const m of items) {
          const key = `${m.sport}-${m.id}`;
          const sig =
            m.sport === "mma"
              ? `${m.state}|${m.winner || ""}`
              : `${m.home_score}-${m.away_score}`;
          if (key in sigRef.current && sigRef.current[key] !== sig)
            changed.push(key);
          sigRef.current[key] = sig;
        }
        setMatches(items);
        setFavL(new Set(d.favorites?.leagues || []));
        setFavT(new Set(d.favorites?.teams || []));
        if (changed.length) {
          setFlashing((f) => {
            const n = { ...f };
            changed.forEach((k) => (n[k] = true));
            return n;
          });
          changed.forEach((k) =>
            setTimeout(
              () =>
                setFlashing((f) => {
                  const n = { ...f };
                  delete n[k];
                  return n;
                }),
              3000,
            ),
          );
        }
      },
    );
  }, []);

  // Rythme ADAPTATIF (temps réel « à la Flashscore » sans SSE) : 15 s si un match
  // est en cours ET l'onglet est visible ; 60 s sinon. Rien en arrière-plan
  // (onglet caché) → coût minimal, compatible scale-to-zero Cloud Run.
  useEffect(() => {
    let alive = true,
      timer = null;
    const tick = () => {
      if (!alive) return;
      if (document.visibilityState === "visible") load();
      const fast = hasLiveRef.current && document.visibilityState === "visible";
      timer = setTimeout(tick, fast ? 15000 : 60000);
    };
    tick();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  useEffect(() => {
    hasLiveRef.current = matches.some((m) => m.state === "in");
  }, [matches]);

  // Bascule un favori : maj optimiste + tri instantané, persistée en tâche de fond.
  const toggleFav = (kind, id) => {
    if (!id) return;
    const setFav = kind === "league" ? setFavL : setFavT;
    setFav((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    axios
      .post(`${API}/users/me/sports-favorites/toggle`, { kind, id })
      .catch(() => {
        // En cas d'échec réseau, on resynchronise avec le serveur.
        load();
      });
  };
  const onToggleLeague = (id) => toggleFav("league", id);
  const onToggleTeam = (id) => toggleFav("team", id);

  const saveFilter = async (selSet) => {
    const leagues = Array.from(selSet);
    try {
      await axios.put(`${API}/users/me/sports-favorites`, {
        leagues,
        teams: Array.from(favT),
      });
      setFavL(new Set(leagues));
      toast.success(i18n.t("livescores.favs_saved"));
    } catch {
      toast.error(i18n.t("livescores.err_save"));
    }
  };

  // Masquer TOUT le widget (foot + MMA) : persistance MongoDB + fondu + maj user.
  const doHide = () => {
    setConfirmHide(false);
    setFading(true);
    setTimeout(() => {
      axios
        .put(`${API}/users/me/show-sports`, {
          show_sports: false,
          show_mma: false,
        })
        .catch(() => {});
      setUser?.((prev) =>
        prev ? { ...prev, show_sports: false, show_mma: false } : prev,
      );
    }, 340);
  };

  // Repli DÉMO (opt-in) quand l'API ne renvoie aucun match → permet de voir le widget.
  const src = matches.length ? matches : demoScoresOn() ? DEMO_SCORES : [];
  if (!src.length) return null;
  const cardProps = {
    favL,
    favT,
    onToggleLeague,
    onToggleTeam,
    onOpen: setOpenMatch,
  };

  // Foot + MMA + WWE
  const footItems = displayMatches(
    src.filter((m) => m.sport === "foot" || (!m.sport && m.home)),
    favL,
    favT,
  );
  const mmaItems = displayMatches(
    src.filter((m) => m.sport === "mma"),
    favL,
    favT,
  );
  const wweItems = src.filter((m) => m.sport === "wwe");
  let arranged = [];
  const maxLen = Math.max(footItems.length, mmaItems.length, wweItems.length);
  if (maxLen === 0) arranged = [];
  else {
    for (let i = 0; i < maxLen; i++) {
      if (i < footItems.length) arranged.push(footItems[i]);
      if (i < mmaItems.length) arranged.push(mmaItems[i]);
      if (i < wweItems.length) arranged.push(wweItems[i]);
    }
  }
  if (!arranged.length) arranged = [...footItems, ...mmaItems, ...wweItems];
  // Les matchs de Ligue des Champions passent EN TÊTE du carrousel (tri stable :
  // le reste conserve l'ordre d'entrelacement foot / MMA / WWE).
  arranged = [...arranged].sort(
    (a, b) => (isUclMatch(a) ? 0 : 1) - (isUclMatch(b) ? 0 : 1),
  );
  const renderCard = (m, compact) => {
    if (m.sport === "mma")
      return (
        <MmaCard
          key={`mma-${m.id}`}
          m={m}
          compact={compact}
          flash={!!flashing[`mma-${m.id}`]}
        />
      );
    if (m.sport === "wwe")
      return (
        <WweCard
          key={`wwe-${m.id}`}
          m={m}
          compact={compact}
          flash={!!flashing[`wwe-${m.id}`]}
          onOpen={setOpenMatch}
        />
      );
    return (
      <MatchCard
        key={`foot-${m.id}`}
        m={m}
        compact={compact}
        flash={!!flashing[`foot-${m.id}`]}
        {...cardProps}
      />
    );
  };
  const fadeStyle = {
    opacity: fading ? 0 : 1,
    transition: "opacity 0.34s ease",
  };

  const iconBtn = (icon, onClick, label) => (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex items-center justify-center w-7 h-7 rounded-lg active:scale-90 transition-transform"
      style={{ background: "rgba(255,255,255,0.06)" }}
    >
      <span
        className="material-symbols-outlined"
        style={{ color: "#9fb0c8", fontSize: 18 }}
      >
        {icon}
      </span>
    </button>
  );

  const header = (big) => (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <span
          className="material-symbols-outlined"
          style={{ color: NEON, fontSize: big ? 20 : 16 }}
        >
          sports_soccer
        </span>
        {big ? (
          <span
            className="font-headline font-bold text-base tracking-tight"
            style={{ color: "#dae2fd" }}
          >
            {i18n.t("livescores.title")}
          </span>
        ) : (
          <span
            className="font-black uppercase tracking-wider text-xs"
            style={{ color: "#8b96a8" }}
          >
            {i18n.t("livescores.title")}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {iconBtn(
          "tune",
          () => setShowFilter(true),
          i18n.t("livescores.filter_aria"),
        )}
        {iconBtn(
          "close",
          () => setConfirmHide(true),
          i18n.t("livescores.hide_aria"),
        )}
      </div>
    </div>
  );

  // Alerte épurée de confirmation de masquage.
  const confirmDialog = confirmHide && (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: "rgba(2,6,20,0.82)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setConfirmHide(false);
      }}
    >
      <div
        className="w-full max-w-xs rounded-3xl p-5 text-center"
        style={{
          background: "#111827",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <span
          className="material-symbols-outlined mb-2"
          style={{ color: "#9fb0c8", fontSize: 30 }}
        >
          visibility_off
        </span>
        <h3 className="text-white font-bold text-base mb-1">
          {i18n.t("livescores.hide_confirm")}
        </h3>
        <p className="text-xs mb-4" style={{ color: "#859397" }}>
          {i18n.t("livescores.hide_body")}
        </p>
        <button
          onClick={doHide}
          className="w-full py-2.5 rounded-xl font-bold text-sm active:scale-95 transition-transform mb-2"
          style={{ background: "#f87171", color: "#2a0808" }}
        >
          {i18n.t("livescores.hide")}
        </button>
        <button
          onClick={() => setConfirmHide(false)}
          className="w-full py-2.5 rounded-xl font-bold text-sm"
          style={{ background: "#222a3d", color: "#a7b3cc" }}
        >
          {i18n.t("livescores.cancel")}
        </button>
      </div>
    </div>
  );

  if (variant === "sidebar") {
    return (
      <section
        className="rounded-2xl p-4"
        style={{
          background: "#0d1424",
          border: "1px solid rgba(255,255,255,0.05)",
          ...fadeStyle,
        }}
      >
        <div className="mb-3">{header(true)}</div>
        <UclMatchdayBanner matches={src} />
        <div className="space-y-2">
          {arranged.slice(0, 6).map((m) => renderCard(m, true))}
        </div>
        {showFilter && (
          <FilterModal
            favL={favL}
            onSave={saveFilter}
            onClose={() => setShowFilter(false)}
          />
        )}
        {openMatch && (
          <MatchCenter match={openMatch} onClose={() => setOpenMatch(null)} />
        )}
        {confirmDialog}
      </section>
    );
  }

  return (
    <div className="pt-1 pb-2" style={fadeStyle}>
      <div className="px-4 mb-1.5">{header(false)}</div>
      <div className="px-4">
        <UclMatchdayBanner matches={src} />
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4">
        {arranged.map((m) => renderCard(m, false))}
      </div>
      {showFilter && (
        <FilterModal
          favL={favL}
          onSave={saveFilter}
          onClose={() => setShowFilter(false)}
        />
      )}
      {openMatch && (
        <MatchCenter match={openMatch} onClose={() => setOpenMatch(null)} />
      )}
      {confirmDialog}
    </div>
  );
}
