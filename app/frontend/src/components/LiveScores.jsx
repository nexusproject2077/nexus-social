// Scores de foot en direct (ESPN via notre backend, en cache) + personnalisation.
// L'utilisateur met en favori une ligue / une équipe (étoile) : ses favoris
// remontent en tête, instantanément (tri client) et de façon persistante (MongoDB).
// variant="mobile"  → carrousel horizontal (sous les Stories).
// variant="sidebar" → bloc compact vertical (haut de la colonne Tendances, PC).
import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";

const NEON = "#4ade80";      // vert néon (match en cours)
const BRIGHT = "#f4f8ff";    // blanc brillant

// Ligues majeures proposées dans la modale de filtres (slugs ESPN).
const MAJOR_LEAGUES = [
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
function sortMatches(list, favL, favT) {
  const isFav = (m) => favL.has(m.league_slug) || favT.has(m.home_id) || favT.has(m.away_id);
  return [...list].sort((a, b) =>
    (isFav(a) ? 0 : 1) - (isFav(b) ? 0 : 1)
    || (STATE_ORDER[a.state] ?? 3) - (STATE_ORDER[b.state] ?? 3)
    || String(a.date || "").localeCompare(String(b.date || "")));
}

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

const Team = ({ id, logo, name, score, live, favT, onToggleTeam }) => (
  <div className="flex items-center gap-1.5 min-w-0">
    {logo ? (
      <img src={logo} alt="" className="w-4 h-4 object-contain flex-shrink-0" loading="lazy" />
    ) : (
      <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: "#2a3446" }} />
    )}
    <span className="text-xs truncate flex-1" style={{ color: "#c7d0e0" }}>{name}</span>
    <span className="text-sm font-black tabular-nums" style={{
      color: live ? NEON : BRIGHT,
      textShadow: live ? `0 0 8px ${NEON}66` : "none",
      minWidth: 14, textAlign: "right",
    }}>{score ?? "-"}</span>
    {!!id && <StarBtn active={favT.has(id)} onClick={() => onToggleTeam(id)} size={13} />}
  </div>
);

function MatchCard({ m, compact, favL, favT, onToggleLeague, onToggleTeam }) {
  const live = m.state === "in";
  const done = m.state === "post";
  const status = live ? (m.clock || m.detail || "En direct")
    : done ? (m.detail || "Terminé")
    : (m.detail || "À venir");
  return (
    <div
      className={`rounded-2xl p-3 flex flex-col justify-between ${compact ? "" : "flex-shrink-0"}`}
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
        {live && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: NEON, boxShadow: `0 0 6px ${NEON}` }} />
            <span className="text-[9px] font-black" style={{ color: NEON }}>LIVE</span>
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        <Team id={m.home_id} logo={m.home_logo} name={m.home} score={m.home_score} live={live} favT={favT} onToggleTeam={onToggleTeam} />
        <Team id={m.away_id} logo={m.away_logo} name={m.away} score={m.away_score} live={live} favT={favT} onToggleTeam={onToggleTeam} />
      </div>
      <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <span className="text-[10px] font-bold" style={{ color: live ? NEON : "#6b7686" }}>{status}</span>
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

export default function LiveScores({ variant = "mobile" }) {
  const [matches, setMatches] = useState([]);
  const [favL, setFavL] = useState(() => new Set());
  const [favT, setFavT] = useState(() => new Set());
  const [showFilter, setShowFilter] = useState(false);

  const load = useCallback(() => {
    axios.get(`${API}/livescores`).then((r) => {
      const d = r.data || {};
      setMatches(Array.isArray(d.matches) ? d.matches : []);
      setFavL(new Set(d.favorites?.leagues || []));
      setFavT(new Set(d.favorites?.teams || []));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    const run = () => { if (alive) load(); };
    run();
    const iv = setInterval(run, 60000);
    const onVis = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

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

  if (!matches.length) return null;
  const sorted = sortMatches(matches, favL, favT);
  const cardProps = { favL, favT, onToggleLeague, onToggleTeam };

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
      <button onClick={() => setShowFilter(true)} aria-label="Filtrer les compétitions"
        className="flex items-center justify-center w-7 h-7 rounded-lg active:scale-90 transition-transform" style={{ background: "rgba(255,255,255,0.06)" }}>
        <span className="material-symbols-outlined" style={{ color: "#9fb0c8", fontSize: 18 }}>tune</span>
      </button>
    </div>
  );

  if (variant === "sidebar") {
    return (
      <section className="rounded-2xl p-4" style={{ background: "#0d1424", border: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="mb-3">{header(true)}</div>
        <div className="space-y-2">
          {sorted.slice(0, 6).map((m) => <MatchCard key={m.id} m={m} compact {...cardProps} />)}
        </div>
        {showFilter && <FilterModal favL={favL} onSave={saveFilter} onClose={() => setShowFilter(false)} />}
      </section>
    );
  }

  return (
    <div className="pt-1 pb-2">
      <div className="px-4 mb-1.5">{header(false)}</div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4">
        {sorted.map((m) => <MatchCard key={m.id} m={m} {...cardProps} />)}
      </div>
      {showFilter && <FilterModal favL={favL} onSave={saveFilter} onClose={() => setShowFilter(false)} />}
    </div>
  );
}
