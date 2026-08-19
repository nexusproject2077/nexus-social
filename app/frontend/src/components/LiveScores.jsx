// Scores de foot en direct (données ESPN via notre backend, mises en cache).
// variant="mobile"  → carrousel horizontal (sous les Stories).
// variant="sidebar" → bloc compact vertical (haut de la colonne Tendances, PC).
import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";

const NEON = "#4ade80";      // vert néon (match en cours)
const BRIGHT = "#f4f8ff";    // blanc brillant

function useLiveScores() {
  const [matches, setMatches] = useState([]);
  useEffect(() => {
    let alive = true;
    const load = () =>
      axios.get(`${API}/livescores`)
        .then((r) => { if (alive) setMatches(Array.isArray(r.data?.matches) ? r.data.matches : []); })
        .catch(() => {});
    load();
    // Le backend gère déjà le cache (60 s si live). On rafraîchit l'affichage
    // toutes les 60 s ; c'est le cache serveur qui protège l'API ESPN.
    const iv = setInterval(load, 60000);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(iv); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  return matches;
}

const Team = ({ logo, name, score, live, compact }) => (
  <div className="flex items-center gap-2 min-w-0">
    {logo ? (
      <img src={logo} alt="" className="w-4 h-4 object-contain flex-shrink-0" loading="lazy" />
    ) : (
      <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: "#2a3446" }} />
    )}
    <span className="text-xs truncate flex-1" style={{ color: "#c7d0e0", maxWidth: compact ? 92 : 78 }}>{name}</span>
    <span className="text-sm font-black tabular-nums" style={{
      color: live ? NEON : BRIGHT,
      textShadow: live ? `0 0 8px ${NEON}66` : "none",
      minWidth: 14, textAlign: "right",
    }}>{score ?? "-"}</span>
  </div>
);

function MatchCard({ m, compact }) {
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
        width: compact ? "auto" : 168, minHeight: 96,
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-wider truncate" style={{ color: "#6b7686" }}>{m.league}</span>
        {live && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: NEON, boxShadow: `0 0 6px ${NEON}` }} />
            <span className="text-[9px] font-black" style={{ color: NEON }}>LIVE</span>
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        <Team logo={m.home_logo} name={m.home} score={m.home_score} live={live} compact={compact} />
        <Team logo={m.away_logo} name={m.away} score={m.away_score} live={live} compact={compact} />
      </div>
      <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <span className="text-[10px] font-bold" style={{ color: live ? NEON : "#6b7686" }}>{status}</span>
      </div>
    </div>
  );
}

export default function LiveScores({ variant = "mobile" }) {
  const matches = useLiveScores();
  if (!matches.length) return null;

  if (variant === "sidebar") {
    // Bloc compact en haut de la colonne Tendances (PC).
    return (
      <section className="rounded-2xl p-4" style={{ background: "#0d1424", border: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="material-symbols-outlined text-lg" style={{ color: NEON }}>sports_soccer</span>
          <h2 className="font-headline font-bold text-base tracking-tight" style={{ color: "#dae2fd" }}>Scores en direct</h2>
        </div>
        <div className="space-y-2">
          {matches.slice(0, 5).map((m) => <MatchCard key={m.id} m={m} compact />)}
        </div>
      </section>
    );
  }

  // Carrousel horizontal (mobile).
  return (
    <div className="pt-1 pb-2">
      <div className="flex items-center gap-1.5 px-4 mb-1.5">
        <span className="material-symbols-outlined text-base" style={{ color: NEON }}>sports_soccer</span>
        <span className="text-xs font-black uppercase tracking-wider" style={{ color: "#8b96a8" }}>Scores en direct</span>
      </div>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-4">
        {matches.map((m) => <MatchCard key={m.id} m={m} />)}
      </div>
    </div>
  );
}
