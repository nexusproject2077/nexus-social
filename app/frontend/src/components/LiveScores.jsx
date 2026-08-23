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

const NEON = "#4ade80";      // vert néon (match en cours)
const BRIGHT = "#f4f8ff";    // blanc brillant

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

// Tri client identique au backend : favoris d'abord, puis en cours, puis date.
export function sortMatches(list, favL, favT) {
  const isFav = (m) => favL.has(m.league_slug) || favT.has(m.home_id) || favT.has(m.away_id);
  return [...list].sort((a, b) =>
    (isFav(a) ? 0 : 1) - (isFav(b) ? 0 : 1)
    || (STATE_ORDER[a.state] ?? 3) - (STATE_ORDER[b.state] ?? 3)
    || String(a.date || "").localeCompare(String(b.date || "")));
}

// Sélection à afficher : priorité ABSOLUE aux matchs EN DIRECT. S'il n'y en a
// aucun, on montre les 3 PROCHAINS à venir (chronologiques, favoris d'abord).
export function displayMatches(list, favL, favT) {
  const sorted = sortMatches(list, favL, favT);
  if (sorted.some((m) => m.state === "in")) return sorted;          // direct prioritaire
  const pre = sorted.filter((m) => m.state === "pre");
  if (pre.length) return pre.slice(0, 3);                            // sinon 3 prochains
  return sorted.slice(0, 3);                                        // repli : récents terminés
}

// Heure + jour du coup d'envoi, format ultra-court (ex : « Dim. 15:00 »,
// « Auj. 21:00 », « Dem. 18:30 »).
export function formatKickoff(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "À venir";
  const now = new Date();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  let day;
  if (d.toDateString() === now.toDateString()) day = "Auj.";
  else if (d.toDateString() === tomorrow.toDateString()) day = "Dem.";
  else { day = d.toLocaleDateString("fr-FR", { weekday: "short" }); day = day.charAt(0).toUpperCase() + day.slice(1); }
  return `${day} ${time}`;
}

// Badge « À VENIR » discret (gris anthracite) — remplace le badge LIVE.
const UpcomingBadge = () => (
  <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-wide"
    style={{ background: "#232c3a", color: "#9fb0c8" }}>À VENIR</span>
);

// Badge DÉMO (données de simulation, jamais présentées comme réelles).
const DemoBadge = () => (
  <span className="flex-shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-black tracking-wide"
    style={{ background: "#f59e0b22", color: "#fbbf24" }}>DÉMO</span>
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
    aria-label={active ? "Retirer des favoris" : "Ajouter aux favoris"}
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
      <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: "#2a3446" }} />
    )}
    <span className="text-xs truncate flex-1" style={{ color: "#c7d0e0" }}>{name}</span>
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
  // Match à venir : on affiche l'heure + la date à la place du score.
  const status = live ? (m.clock || m.detail || "En direct")
    : done ? (m.detail || "Terminé")
    : formatKickoff(m.date);
  return (
    <div
      onClick={() => onOpen?.(m)}
      role="button"
      className={`rounded-2xl p-3 flex flex-col justify-between cursor-pointer active:scale-[0.98] transition-transform ${compact ? "" : "flex-shrink-0"}`}
      style={{
        background: "#111827",
        border: `1px solid ${live ? NEON + "33" : "rgba(255,255,255,0.06)"}`,
        width: compact ? "auto" : 178, minHeight: 98,
      }}
    >
      <div className="flex items-center justify-between gap-1.5 mb-2">
        <div className="flex items-center gap-1 min-w-0">
          <StarBtn active={favL.has(m.league_slug)} onClick={() => onToggleLeague(m.league_slug)} size={13} />
          <span className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: "#6b7686" }}>{m.league}</span>
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
  const status = live ? `R${m.round || "?"}${m.clock ? " · " + m.clock : ""}`
    : done ? (m.method || "Terminé")
    : formatKickoff(m.date);
  const w1 = done && m.winner && m.f1?.name === m.winner;
  const w2 = done && m.winner && m.f2?.name === m.winner;
  return (
    <div className={`rounded-2xl p-3 flex flex-col justify-between ${compact ? "" : "flex-shrink-0"}`}
      style={{ background: "#111827", border: `1px solid ${live ? NEON + "33" : "rgba(255,255,255,0.06)"}`, width: compact ? "auto" : 178, minHeight: 98 }}>
      <div className="flex items-center justify-between gap-1.5 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider truncate flex items-center gap-1" style={{ color: "#6b7686" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 12, color: "#ef4444" }}>sports_mma</span>{m.event}
        </span>
        {live ? <LiveBadge /> : upcoming ? <UpcomingBadge /> : null}
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

// Modale de filtres : cocher les ligues majeures (Toggles).
function FilterModal({ favL, onSave, onClose }) {
  const [sel, setSel] = useState(new Set(favL));
  const [saving, setSaving] = useState(false);
  const toggle = (id) => setSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const save = async () => { setSaving(true); await onSave(sel); setSaving(false); onClose(); };
  return (
    <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: "rgba(2,6,20,0.8)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5"
        style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined" style={{ color: NEON }}>tune</span>
          <h3 className="font-bold text-white">Mes compétitions favorites</h3>
        </div>
        <p className="text-[12px] mb-4" style={{ color: "#859397" }}>Coche tes ligues : elles apparaîtront en premier.</p>
        <div className="space-y-1 max-h-[52vh] overflow-y-auto no-scrollbar">
          {MAJOR_LEAGUES.map((l) => {
            const on = sel.has(l.id);
            return (
              <button key={l.id} onClick={() => toggle(l.id)}
                className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left active:scale-[0.99] transition-transform"
                style={{ background: on ? NEON + "14" : "#1a2234" }}>
                <span className="text-sm font-semibold" style={{ color: on ? "#eaf7ee" : "#c7d0e0" }}>{l.name}</span>
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
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button onClick={onClose} disabled={saving}
          className="w-full mt-2 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
          style={{ background: "#222a3d", color: "#a7b3cc" }}>Fermer</button>
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
  const [flashing, setFlashing] = useState({});   // clé sport-id -> true (score qui vient de changer)
  const sigRef = useRef({});                        // clé -> signature (score/résultat) précédente
  const hasLiveRef = useRef(false);

  // Récupère les scores + DÉTECTE les changements (score foot, résultat MMA) pour
  // déclencher le flash néon sur le nouveau chiffre.
  const load = useCallback(() => {
    axios.get(`${API}/livescores`).then((r) => {
      const d = r.data || {};
      const items = Array.isArray(d.matches) ? d.matches : [];
      const changed = [];
      for (const m of items) {
        const key = `${m.sport}-${m.id}`;
        const sig = m.sport === "mma" ? `${m.state}|${m.winner || ""}` : `${m.home_score}-${m.away_score}`;
        if (key in sigRef.current && sigRef.current[key] !== sig) changed.push(key);
        sigRef.current[key] = sig;
      }
      setMatches(items);
      setFavL(new Set(d.favorites?.leagues || []));
      setFavT(new Set(d.favorites?.teams || []));
      if (changed.length) {
        setFlashing((f) => { const n = { ...f }; changed.forEach((k) => (n[k] = true)); return n; });
        changed.forEach((k) => setTimeout(() =>
          setFlashing((f) => { const n = { ...f }; delete n[k]; return n; }), 3000));
      }
    }).catch(() => {});
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
    setFav((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    axios.post(`${API}/users/me/sports-favorites/toggle`, { kind, id }).catch(() => {
      // En cas d'échec réseau, on resynchronise avec le serveur.
      load();
    });
  };
  const onToggleLeague = (id) => toggleFav("league", id);
  const onToggleTeam = (id) => toggleFav("team", id);

  const saveFilter = async (selSet) => {
    const leagues = Array.from(selSet);
    try {
      await axios.put(`${API}/users/me/sports-favorites`, { leagues, teams: Array.from(favT) });
      setFavL(new Set(leagues));
      toast.success("Favoris enregistrés");
    } catch { toast.error("Erreur d'enregistrement"); }
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

  if (!matches.length) return null;
  const cardProps = { favL, favT, onToggleLeague, onToggleTeam, onOpen: setOpenMatch };

  // Foot + MMA : direct prioritaire, sinon 3 prochains à venir (par sport).
  const footItems = displayMatches(matches.filter((m) => m.sport !== "mma"), favL, favT);
  const mmaItems = displayMatches(matches.filter((m) => m.sport === "mma"), favL, favT);
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
          <span className="font-headline font-bold text-base tracking-tight" style={{ color: "#dae2fd" }}>Scores en direct</span>
        ) : (
          <span className="font-black uppercase tracking-wider text-xs" style={{ color: "#8b96a8" }}>Scores en direct</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {iconBtn("tune", () => setShowFilter(true), "Filtrer les compétitions")}
        {iconBtn("close", () => setConfirmHide(true), "Masquer les scores")}
      </div>
    </div>
  );

  // Alerte épurée de confirmation de masquage.
  const confirmDialog = confirmHide && (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: "rgba(2,6,20,0.82)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmHide(false); }}>
      <div className="w-full max-w-xs rounded-3xl p-5 text-center"
        style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)" }}>
        <span className="material-symbols-outlined mb-2" style={{ color: "#9fb0c8", fontSize: 30 }}>visibility_off</span>
        <h3 className="text-white font-bold text-base mb-1">Masquer les scores sportifs ?</h3>
        <p className="text-xs mb-4" style={{ color: "#859397" }}>Le widget disparaîtra. Tu pourras le réactiver à tout moment dans les Paramètres.</p>
        <button onClick={doHide}
          className="w-full py-2.5 rounded-xl font-bold text-sm active:scale-95 transition-transform mb-2"
          style={{ background: "#f87171", color: "#2a0808" }}>
          Masquer
        </button>
        <button onClick={() => setConfirmHide(false)}
          className="w-full py-2.5 rounded-xl font-bold text-sm" style={{ background: "#222a3d", color: "#a7b3cc" }}>
          Annuler
        </button>
      </div>
    </div>
  );

  if (variant === "sidebar") {
    return (
      <section className="rounded-2xl p-4" style={{ background: "#0d1424", border: "1px solid rgba(255,255,255,0.05)", ...fadeStyle }}>
        <div className="mb-3">{header(true)}</div>
        <div className="space-y-2">
          {arranged.slice(0, 6).map((m) => renderCard(m, true))}
        </div>
        {showFilter && <FilterModal favL={favL} onSave={saveFilter} onClose={() => setShowFilter(false)} />}
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
      {showFilter && <FilterModal favL={favL} onSave={saveFilter} onClose={() => setShowFilter(false)} />}
      {openMatch && <MatchCenter match={openMatch} onClose={() => setOpenMatch(null)} />}
      {confirmDialog}
    </div>
  );
}
