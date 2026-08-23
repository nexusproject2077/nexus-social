// WidgetStack — pile de widgets « Smart Stack » (façon iOS) en haut du feed MOBILE.
// Regroupe Foot, MMA et Tendances dans un emplacement de taille fixe. Balayage
// vertical (swipe up/down) + points indicateurs + rotation intelligente :
//  • un match/combat FAVORI passe LIVE → la pile bascule dessus automatiquement ;
//  • sinon, alterne toutes les 10 s (Tendances par défaut).
// Pas de SSE : on réutilise le polling adaptatif (compatible scale-to-zero).
import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API } from "@/App";
import { useNavigate } from "react-router-dom";
import MatchCenter from "@/components/MatchCenter";
import { MatchCard, MmaCard, sortMatches } from "@/components/LiveScores";

const NEON = "#4ade80";
const STACK_H = 150;

export default function WidgetStack({ user }) {
  const navigate = useNavigate();
  const showFoot = user?.show_sports !== false;
  const showMma = user?.show_mma !== false;

  const [matches, setMatches] = useState([]);
  const [favL, setFavL] = useState(() => new Set());
  const [favT, setFavT] = useState(() => new Set());
  const [trends, setTrends] = useState([]);
  const [flashing, setFlashing] = useState({});
  const [openMatch, setOpenMatch] = useState(null);
  const [active, setActive] = useState(0);

  const sigRef = useRef({});
  const hasLiveRef = useRef(false);

  // ── Données : scores (foot+mma) avec détection de changement + tendances ──
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
        changed.forEach((k) => setTimeout(() => setFlashing((f) => { const n = { ...f }; delete n[k]; return n; }), 3000));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    axios.get(`${API}/trending/hashtags?limit=6`).then((r) => setTrends(Array.isArray(r.data?.trending) ? r.data.trending : [])).catch(() => {});
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

  // Favoris : bascule optimiste + persistance.
  const toggleFav = (kind, id) => {
    if (!id) return;
    const setFav = kind === "league" ? setFavL : setFavT;
    setFav((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    axios.post(`${API}/users/me/sports-favorites/toggle`, { kind, id }).catch(() => load());
  };

  // ── Pages disponibles ──
  const footItems = sortMatches(matches.filter((m) => m.sport !== "mma"), favL, favT);
  const mmaItems = matches.filter((m) => m.sport === "mma");
  const isFavLive = (m) => m.state === "in" && (favL.has(m.league_slug) || favT.has(m.home_id) || favT.has(m.away_id));
  const pages = [];
  if (showFoot && footItems.length) pages.push("foot");
  if (showMma && mmaItems.length) pages.push("mma");
  pages.push("trends");

  // ── Rotation intelligente ──
  const pagesRef = useRef(pages);
  const urgentRef = useRef(null);
  const manualUntilRef = useRef(0);
  const rotateAtRef = useRef(Date.now());
  const initRef = useRef(false);
  pagesRef.current = pages;
  urgentRef.current = footItems.some(isFavLive) ? "foot"
    : (mmaItems.some((m) => m.state === "in") ? "mma" : null);

  useEffect(() => {
    const iv = setInterval(() => {
      const ps = pagesRef.current;
      if (!ps.length) return;
      if (Date.now() < manualUntilRef.current) return;      // pause après un swipe manuel
      const u = urgentRef.current;
      if (u && ps.includes(u)) { setActive(ps.indexOf(u)); rotateAtRef.current = Date.now(); return; }
      if (!initRef.current) { initRef.current = true; setActive(ps.indexOf("trends")); rotateAtRef.current = Date.now(); return; }
      if (Date.now() - rotateAtRef.current >= 10000) {       // sinon : rotation 10 s
        rotateAtRef.current = Date.now();
        setActive((a) => (a + 1) % ps.length);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const idx = Math.min(active, pages.length - 1);

  // ── Gestes tactiles (swipe vertical) ──
  const touch = useRef({ y: 0, active: false });
  const onTouchStart = (e) => { touch.current = { y: e.touches[0].clientY, active: true }; };
  const onTouchEnd = (e) => {
    if (!touch.current.active) return;
    touch.current.active = false;
    const dy = (e.changedTouches[0]?.clientY ?? touch.current.y) - touch.current.y;
    if (Math.abs(dy) < 30) return;
    manualUntilRef.current = Date.now() + 15000;             // met la rotation auto en pause 15 s
    setActive((a) => Math.max(0, Math.min(pages.length - 1, a + (dy < 0 ? 1 : -1))));
  };

  const cardProps = {
    favL, favT,
    onToggleLeague: (id) => toggleFav("league", id),
    onToggleTeam: (id) => toggleFav("team", id),
    onOpen: setOpenMatch,
  };

  const PageHeader = ({ icon, title, color }) => (
    <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
      <span className="material-symbols-outlined" style={{ color, fontSize: 15 }}>{icon}</span>
      <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: "#8b96a8" }}>{title}</span>
    </div>
  );

  const pageNode = (id) => {
    if (id === "foot") return (
      <div className="h-full flex flex-col px-3 py-2.5">
        <PageHeader icon="sports_soccer" title="Foot en direct" color={NEON} />
        <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar items-center">
          {footItems.map((m) => <MatchCard key={m.id} m={m} flash={!!flashing[`foot-${m.id}`]} {...cardProps} />)}
        </div>
      </div>
    );
    if (id === "mma") return (
      <div className="h-full flex flex-col px-3 py-2.5">
        <PageHeader icon="sports_mma" title="MMA / UFC" color="#ef4444" />
        <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar items-center">
          {mmaItems.map((m) => <MmaCard key={m.id} m={m} flash={!!flashing[`mma-${m.id}`]} />)}
        </div>
      </div>
    );
    return (
      <div className="h-full flex flex-col px-4 py-2.5">
        <PageHeader icon="trending_up" title="Tendances" color="#22d3ee" />
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {trends.length === 0 ? (
            <p className="text-xs pt-2" style={{ color: "#6b7686" }}>Publie avec des #hashtags pour lancer les tendances.</p>
          ) : trends.slice(0, 4).map((t, i) => (
            <button key={t.normalized || t.tag} onClick={() => navigate(`/search?q=${encodeURIComponent(t.tag)}`)}
              className="w-full flex items-center justify-between gap-2 py-1 text-left">
              <span className="text-sm font-bold truncate" style={{ color: "#dae2fd" }}>{i + 1}. {t.tag}</span>
              <span className="text-[11px] flex-shrink-0" style={{ color: "#6b7686" }}>{t.post_count || 0} posts</span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="px-4 pt-1 pb-2">
      <div className="relative rounded-2xl overflow-hidden" style={{ height: STACK_H, background: "#0d1424", border: "1px solid rgba(255,255,255,0.06)" }}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {/* Pile verticale animée */}
        <div style={{ height: STACK_H * pages.length, transform: `translateY(-${idx * STACK_H}px)`, transition: "transform 0.4s cubic-bezier(0.22,1,0.36,1)" }}>
          {pages.map((id) => (
            <div key={id} style={{ height: STACK_H }}>{pageNode(id)}</div>
          ))}
        </div>
        {/* Points indicateurs (façon iPhone) */}
        {pages.length > 1 && (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex flex-col gap-1.5">
            {pages.map((id, i) => (
              <button key={id} onClick={() => { manualUntilRef.current = Date.now() + 15000; setActive(i); }} aria-label={`Widget ${i + 1}`}
                className="rounded-full transition-all" style={{
                  width: 5, height: i === idx ? 12 : 5,
                  background: i === idx ? NEON : "rgba(255,255,255,0.28)",
                }} />
            ))}
          </div>
        )}
      </div>
      {openMatch && <MatchCenter match={openMatch} onClose={() => setOpenMatch(null)} />}
    </div>
  );
}
