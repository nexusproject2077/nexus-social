// Match Center — chronologie détaillée d'un match (données ESPN gratuites).
// Design sombre premium, typo fine (Inter), icônes 100 % SVG (aucun emoji).
// Événements domicile à GAUCHE de l'axe, extérieur à DROITE. Rafraîchi 60 s.
import { useState, useEffect, useCallback } from "react";
import { fetchMatchDetailsFromEspn } from "@/lib/espnClient";

const NEON = "#4ade80";
const INTER = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

// ─── Icônes SVG épurées par type d'événement ───
const Ball = ({ color = NEON, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" />
    <path d="M12 7.2l2.9 2.1-1.1 3.4h-3.6L9.1 9.3 12 7.2z" fill={color} />
    <path d="M12 3v2.2M4.6 8.6l2 1.3M4.9 16.4l2.4-.9M19.4 8.6l-2 1.3M19.1 16.4l-2.4-.9M9.5 20.4l1-2.2M14.5 20.4l-1-2.2"
      stroke={color} strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const Card = ({ color, size = 15 }) => (
  <span style={{ display: "inline-block", width: size * 0.72, height: size, borderRadius: 2.5, background: color, boxShadow: `0 0 6px ${color}66` }} />
);
const Sub = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <path d="M8 7H16M16 7L13 4M16 7L13 10" stroke={NEON} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16 17H8M8 17L11 14M8 17L11 20" stroke="#f87171" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const VarIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="3" y="4.5" width="18" height="12" rx="1.8" stroke="#a78bfa" strokeWidth="1.6" />
    <path d="M9 20h6M12 16.5V20" stroke="#a78bfa" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M8.5 10.5l2.2 2 4-4" stroke="#a78bfa" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Injury = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
    <rect x="4" y="4" width="16" height="16" rx="4" stroke="#fca5a5" strokeWidth="1.6" />
    <path d="M12 8.5v7M8.5 12h7" stroke="#fca5a5" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const Dot = () => <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 999, background: "#5b6577" }} />;

function EventIcon({ type }) {
  switch (type) {
    case "goal": return <Ball color={NEON} />;
    case "penalty_goal": return <Ball color={NEON} />;
    case "own_goal": return <Ball color="#f87171" />;
    case "yellow": return <Card color="#eab308" />;
    case "red": return <Card color="#ef4444" />;
    case "sub": return <Sub />;
    case "var": return <VarIcon />;
    case "penalty": return <Ball color="#facc15" />;
    case "injury": return <Injury />;
    default: return <Dot />;
  }
}

function eventTexts(ev) {
  const p = ev.players || [];
  switch (ev.type) {
    case "goal":
    case "penalty_goal":
    case "own_goal": {
      const tags = [ev.type === "penalty_goal" && "Pen.", ev.own_goal && "csc"].filter(Boolean).join(" · ");
      return { title: p[0] || "But", sub: [p[1] ? `passe ${p[1]}` : "", tags].filter(Boolean).join("  ") || "But" };
    }
    case "yellow": return { title: p[0] || "Carton jaune", sub: "Carton jaune" };
    case "red": return { title: p[0] || "Carton rouge", sub: "Carton rouge" };
    case "sub": return { title: p[0] || "Entrant", sub: p[1] ? `sort ${p[1]}` : "Remplacement" };
    case "var": return { title: "VAR", sub: ev.text || "Décision VAR" };
    case "injury": return { title: p[0] || "Blessure", sub: "Blessure" };
    default: return { title: p[0] || ev.text || "", sub: p[0] ? ev.text : "" };
  }
}

const Side = ({ ev, align }) => {
  const { title, sub } = eventTexts(ev);
  return (
    <div className={align === "right" ? "text-right" : "text-left"}>
      <p className="text-[13px] text-white leading-tight" style={{ fontWeight: 600 }}>{title}</p>
      {sub && <p className="text-[11px] leading-tight mt-0.5" style={{ color: "#8b96a8", fontWeight: 300 }}>{sub}</p>}
    </div>
  );
};

export default function MatchCenter({ match, onClose }) {
  const [detail, setDetail] = useState(null);
  const eventId = match?.id;
  const slug = match?.league_slug;

  const load = useCallback(() => {
    if (!eventId || !slug) return;
    // Résumé ESPN récupéré DIRECTEMENT dans le navigateur (l'endpoint summary est
    // aussi bloqué depuis Cloud Run, comme les scoreboards).
    fetchMatchDetailsFromEspn(eventId, slug)
      .then((d) => setDetail(d || null))
      .catch(() => {});
  }, [eventId, slug]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 60000); // s'actualise en fond, comme le score
    return () => clearInterval(iv);
  }, [load]);

  const h = { ...match, ...(detail?.header || {}) };
  const live = h.state === "in";
  const events = detail?.events || [];
  const ordered = [...events].reverse(); // le plus récent en haut

  return (
    <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: "rgba(2,6,20,0.82)", fontFamily: INTER }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
        style={{ background: "#0b1220", border: "1px solid rgba(255,255,255,0.08)", maxHeight: "88vh" }}>

        {/* En-tête : équipes + score */}
        <div className="px-5 pt-5 pb-4 flex-shrink-0" style={{ background: "linear-gradient(180deg,#111a2e,#0b1220)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#6b7686" }}>{match?.league}</span>
            <button onClick={onClose} className="w-8 h-8 -mr-1 flex items-center justify-center rounded-full active:scale-90 transition-transform" aria-label="Fermer">
              <span className="material-symbols-outlined" style={{ color: "#9fb0c8", fontSize: 22 }}>close</span>
            </button>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              {h.home_logo ? <img src={h.home_logo} alt="" className="w-10 h-10 object-contain" /> : <span className="w-10 h-10 rounded-full" style={{ background: "#2a3446" }} />}
              <span className="text-xs text-center truncate w-full" style={{ color: "#c7d0e0", fontWeight: 500 }}>{h.home}</span>
            </div>
            <div className="flex flex-col items-center px-2">
              <div className="flex items-center gap-2">
                <span className="text-3xl font-black tabular-nums" style={{ color: live ? NEON : "#f4f8ff", textShadow: live ? `0 0 12px ${NEON}55` : "none" }}>{h.home_score ?? "-"}</span>
                <span className="text-xl font-light" style={{ color: "#5b6577" }}>:</span>
                <span className="text-3xl font-black tabular-nums" style={{ color: live ? NEON : "#f4f8ff", textShadow: live ? `0 0 12px ${NEON}55` : "none" }}>{h.away_score ?? "-"}</span>
              </div>
              <span className="text-[11px] font-bold mt-1 flex items-center gap-1" style={{ color: live ? NEON : "#8b96a8" }}>
                {live && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: NEON }} />}
                {live ? (h.clock || "En direct") : (h.detail || "")}
              </span>
            </div>
            <div className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
              {h.away_logo ? <img src={h.away_logo} alt="" className="w-10 h-10 object-contain" /> : <span className="w-10 h-10 rounded-full" style={{ background: "#2a3446" }} />}
              <span className="text-xs text-center truncate w-full" style={{ color: "#c7d0e0", fontWeight: 500 }}>{h.away}</span>
            </div>
          </div>
        </div>

        {/* Chronologie verticale */}
        <div className="relative overflow-y-auto no-scrollbar px-4 py-5" style={{ flex: 1 }}>
          {detail === null ? (
            <div className="flex justify-center py-10"><span className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: `${NEON}44`, borderTopColor: NEON }} /></div>
          ) : ordered.length === 0 ? (
            <p className="text-center text-sm py-10" style={{ color: "#6b7686", fontWeight: 300 }}>Aucun événement pour le moment.</p>
          ) : (
            <div className="relative">
              {/* Axe vertical central */}
              <div className="absolute top-0 bottom-0" style={{ left: "50%", width: 1.5, transform: "translateX(-50%)", background: "rgba(255,255,255,0.08)" }} />
              <div className="space-y-4 relative">
                {ordered.map((ev, i) => (
                  <div key={i} className="flex items-center">
                    <div className="flex-1 pr-3">{ev.side === "home" && <Side ev={ev} align="right" />}</div>
                    <div className="flex flex-col items-center flex-shrink-0" style={{ width: 46 }}>
                      <span className="text-[10px] font-black tabular-nums mb-1 px-1.5 rounded-full" style={{ color: "#0b1220", background: "#c7d0e0" }}>{ev.minute || "·"}</span>
                      <span className="flex items-center justify-center rounded-full" style={{ width: 30, height: 30, background: "#111a2e", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <EventIcon type={ev.type} />
                      </span>
                    </div>
                    <div className="flex-1 pl-3">{ev.side === "away" && <Side ev={ev} align="left" />}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
