// WidgetStack — pile de widgets « Smart Stack » (façon iOS) en haut du feed MOBILE.
// Foot / MMA / Tendances dans un emplacement de taille fixe. Balayage vertical +
// points indicateurs + rotation intelligente. Appui long (2 s) → mode Édition
// (bottom sheet : toggle rotation, réordonnancement Drag & Drop, swipe-to-delete).
// Config persistée dans user.widget_stack_config = { smart_rotate, order }.
import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API } from "@/App";
import { useNavigate } from "react-router-dom";
import MatchCenter from "@/components/MatchCenter";
import { MatchCard, MmaCard, displayMatches } from "@/components/LiveScores";
import { getTodayMinutes } from "@/lib/screenTime";
import { fetchLiveScoresFromEspn, searchTeamsFromEspn } from "@/lib/espnClient";

const NEON = "#4ade80";
const STACK_H = 150;
const ROW_H = 54;
const WIDGETS = {
  football: { label: "Football", icon: "sports_soccer", color: NEON },
  mma: { label: "MMA / UFC", icon: "sports_mma", color: "#ef4444" },
  trends: { label: "Tendances", icon: "trending_up", color: "#22d3ee" },
  weather: { label: "Météo", icon: "partly_cloudy_day", color: "#fbbf24" },
  finance: { label: "Finance", icon: "monitoring", color: "#a78bfa" },
  screentime: { label: "Temps d'écran", icon: "hourglass_top", color: "#34d399" },
};
const DEFAULT_ORDER = ["trends", "screentime", "weather", "finance", "football", "mma"];

// Catalogue crypto (aligné sur le backend) : id CoinGecko → ticker + nom.
const FINANCE_CATALOG = {
  bitcoin: { symbol: "BTC", name: "Bitcoin" },
  ethereum: { symbol: "ETH", name: "Ethereum" },
  solana: { symbol: "SOL", name: "Solana" },
  binancecoin: { symbol: "BNB", name: "BNB" },
  ripple: { symbol: "XRP", name: "XRP" },
  cardano: { symbol: "ADA", name: "Cardano" },
  dogecoin: { symbol: "DOGE", name: "Dogecoin" },
  polkadot: { symbol: "DOT", name: "Polkadot" },
  chainlink: { symbol: "LINK", name: "Chainlink" },
  "avalanche-2": { symbol: "AVAX", name: "Avalanche" },
  litecoin: { symbol: "LTC", name: "Litecoin" },
  "matic-network": { symbol: "MATIC", name: "Polygon" },
};
const DEFAULT_FINANCE_ASSETS = ["bitcoin", "ethereum", "solana"];

// Compétitions foot rangées par zone/pays (slugs ESPN). Les sélections
// nationales sont des favoris d'ÉQUIPE (favorite_teams) via leur id ESPN, ce qui
// les lie automatiquement aux matchs de Coupe du Monde / Euro.
const FOOT_SECTIONS = [
  { key: "europe", flag: "🇪🇺", label: "Europe",
    leagues: [["uefa.champions", "Ligue des Champions"], ["uefa.europa", "Ligue Europa"], ["uefa.europa.conf", "Ligue Conférence"]], nations: [] },
  { key: "france", flag: "🇫🇷", label: "France",
    leagues: [["fra.1", "Ligue 1"], ["fra.2", "Ligue 2"], ["fra.coupe_de_france", "Coupe de France"]], nations: [["478", "Équipe de France"]] },
  { key: "angleterre", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", label: "Angleterre",
    leagues: [["eng.1", "Premier League"], ["eng.2", "Championship"], ["eng.fa", "FA Cup"]], nations: [["448", "Équipe d'Angleterre"]] },
  { key: "espagne", flag: "🇪🇸", label: "Espagne",
    leagues: [["esp.1", "LaLiga"], ["esp.2", "LaLiga 2"], ["esp.copa_del_rey", "Coupe du Roi"]], nations: [["164", "Équipe d'Espagne"]] },
  { key: "italie", flag: "🇮🇹", label: "Italie",
    leagues: [["ita.1", "Serie A"], ["ita.2", "Serie B"], ["ita.coppa_italia", "Coupe d'Italie"]], nations: [["2925", "Équipe d'Italie"]] },
  { key: "allemagne", flag: "🇩🇪", label: "Allemagne",
    leagues: [["ger.1", "Bundesliga"], ["ger.2", "2. Bundesliga"], ["ger.dfb_pokal", "DFB-Pokal"]], nations: [["714", "Équipe d'Allemagne"]] },
  { key: "international", flag: "🌍", label: "International",
    leagues: [["fifa.world", "Coupe du Monde"], ["uefa.euro", "Euro"], ["conmebol.america", "Copa América"], ["caf.nations", "CAN"]], nations: [] },
];

// Interrupteur (même style partout).
const Switch = ({ on }) => (
  <span className="relative flex-shrink-0" style={{ width: 40, height: 22, borderRadius: 999, background: on ? NEON : "#333d52", transition: "background 0.2s" }}>
    <span className="absolute top-0.5 rounded-full bg-white" style={{ width: 18, height: 18, left: on ? 20 : 2, transition: "left 0.2s" }} />
  </span>
);

// Données de DÉMO (opt-in) : n'apparaissent QUE si le foot réel est vide ET que
// le mode démo est activé (?demo=1 ou localStorage nexus_demo_scores=1). Toujours
// étiquetées « DÉMO » → jamais présentées comme de vrais scores en direct.
const DEMO_FOOT = [
  // En direct (test de la carte LIVE) — le vrai match du soir.
  { id: "demo-ren-psg", sport: "foot", league: "Ligue 1", league_slug: "fra.1", home: "Rennes", away: "PSG", home_id: "", away_id: "", home_logo: null, away_logo: null, home_score: "0", away_score: "0", state: "in", clock: "1'", detail: "1'", date: new Date().toISOString(), demo: true },
  // À venir (test du compte à rebours + badge « À VENIR ») — coup d'envoi +2 h.
  { id: "demo-om-ol", sport: "foot", league: "Ligue 1", league_slug: "fra.1", home: "Marseille", away: "Lyon", home_id: "", away_id: "", home_logo: null, away_logo: null, home_score: null, away_score: null, state: "pre", clock: "", detail: "À venir", date: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), demo: true },
];
const DEMO_MMA = [
  { id: "demo-ufc", sport: "mma", event: "UFC 300", f1: { name: "Jon Jones", avatar: null, winner: false }, f2: { name: "Tom Aspinall", avatar: null, winner: false }, state: "in", round: 3, clock: "02:15", method: "", winner: null, detail: "R3 · 02:15", date: new Date().toISOString(), demo: true },
];
const demoScoresOn = () => {
  try { return new URLSearchParams(window.location.search).get("demo") === "1" || localStorage.getItem("nexus_demo_scores") === "1"; }
  catch { return false; }
};

// Prix EUR avec décimales adaptatives (gros montants entiers, micro-prix précis).
const fmtEur = (v) => {
  if (v == null) return "—";
  const d = v >= 100 ? 0 : v >= 1 ? 2 : 4;
  return v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }) + " €";
};

// ─────────────────────── Icônes météo SVG (fines, épurées) ────────────────────
// Traits fins (stroke=currentColor), minimalistes, adaptées à chaque état WMO.
function WeatherIcon({ cond, isDay = true, size = 56 }) {
  const p = { width: size, height: size, viewBox: "0 0 48 48", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" };
  const Sun = (cx = 18, cy = 16, r = 7) => (
    <g>
      <circle cx={cx} cy={cy} r={r} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
        const rad = (a * Math.PI) / 180, r1 = r + 3, r2 = r + 6.5;
        return <line key={a} x1={cx + r1 * Math.cos(rad)} y1={cy + r1 * Math.sin(rad)} x2={cx + r2 * Math.cos(rad)} y2={cy + r2 * Math.sin(rad)} />;
      })}
    </g>
  );
  const Cloud = (dy = 0) => <path d={`M14,${30 + dy} a6,6 0 0 1 1,-11.9 a8.5,8.5 0 0 1 16.4,2.4 a5.5,5.5 0 0 1 -1.4,10.8 z`} />;
  const Moon = <path d="M31,26 a11,11 0 1 1 -9,-17 a9,9 0 0 0 9,17 z" />;
  const drops = (ys) => ys.map((x, i) => <line key={i} x1={x} y1={33} x2={x - 2} y2={39} />);
  const snow = (xs) => xs.map((x, i) => <g key={i}><line x1={x} y1={34} x2={x} y2={40} /><line x1={x - 3} y1={37} x2={x + 3} y2={37} /></g>);

  switch (cond) {
    case "clear":
      return <svg {...p}>{isDay ? Sun(24, 22, 9) : Moon}</svg>;
    case "partly":
      return <svg {...p}>{isDay ? Sun(30, 13, 5.5) : <path d="M34,20 a7,7 0 1 1 -6,-11 a6,6 0 0 0 6,11 z" />}{Cloud(2)}</svg>;
    case "cloudy":
      return <svg {...p}>{Cloud(0)}<path d="M20,36 a5,5 0 0 1 0.8,-9.9 a7,7 0 0 1 13.5,2 a4.6,4.6 0 0 1 -1.2,8.9 z" opacity="0.5" /></svg>;
    case "fog":
      return <svg {...p}>{Cloud(-2)}<line x1={12} y1={34} x2={30} y2={34} /><line x1={16} y1={38} x2={34} y2={38} /></svg>;
    case "drizzle":
      return <svg {...p}>{Cloud(-2)}{drops([18, 26])}</svg>;
    case "rain":
      return <svg {...p}>{Cloud(-2)}{drops([15, 22, 29])}</svg>;
    case "snow":
      return <svg {...p}>{Cloud(-2)}{snow([16, 24, 32])}</svg>;
    case "storm":
      return <svg {...p}>{Cloud(-2)}<path d="M23,32 l-4,6 h4 l-3,6" /></svg>;
    default:
      return <svg {...p}>{Cloud(0)}</svg>;
  }
}

// ─────────────────────────── Éditeur (bottom sheet) ───────────────────────────
function StackEditor({ order, smartRotate, financeAssets, onChange, onClose }) {
  const [list, setList] = useState(order);
  const [smart, setSmart] = useState(smartRotate);
  const [fin, setFin] = useState(financeAssets);
  const [drag, setDrag] = useState(null);        // { index, hover, dy }
  const [swiped, setSwiped] = useState(null);    // id dont la suppression est révélée
  const dragRef = useRef(null);
  const removed = Object.keys(WIDGETS).filter((id) => !list.includes(id));

  // Actifs crypto suivis (cases à cocher) — au moins un doit rester sélectionné.
  const toggleAsset = (id) => {
    const next = fin.includes(id) ? fin.filter((x) => x !== id) : [...fin, id];
    if (!next.length) return;
    setFin(next); onChange({ finance_assets: next });
  };

  const commit = (next) => { setList(next); onChange({ order: next }); };

  // Drag & Drop vertical (pointer) via la poignée.
  const startDrag = (i, e) => {
    e.preventDefault();
    const startY = e.clientY;
    dragRef.current = { index: i, hover: i };
    setDrag({ index: i, hover: i, dy: 0 });
    const move = (ev) => {
      const dy = ev.clientY - startY;
      const hover = Math.max(0, Math.min(list.length - 1, i + Math.round(dy / ROW_H)));
      dragRef.current.hover = hover;
      setDrag({ index: i, hover, dy });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const d = dragRef.current; setDrag(null); dragRef.current = null;
      if (d && d.index !== d.hover) {
        const next = [...list];
        const [it] = next.splice(d.index, 1);
        next.splice(d.hover, 0, it);
        commit(next);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const rowTransform = (i) => {
    if (!drag) return "translateY(0)";
    if (i === drag.index) return `translateY(${drag.dy}px)`;
    if (drag.index < drag.hover && i > drag.index && i <= drag.hover) return `translateY(-${ROW_H}px)`;
    if (drag.index > drag.hover && i < drag.index && i >= drag.hover) return `translateY(${ROW_H}px)`;
    return "translateY(0)";
  };

  // Swipe-to-delete (horizontal) sur le corps de la ligne.
  const sw = useRef({ id: null, x: 0 });
  const onRowTouchStart = (id, e) => { sw.current = { id, x: e.touches[0].clientX }; };
  const onRowTouchMove = (id, e) => {
    const dx = e.touches[0].clientX - sw.current.x;
    if (dx < -30) setSwiped(id);
    else if (dx > 20) setSwiped((s) => (s === id ? null : s));
  };

  const remove = (id) => { setSwiped(null); commit(list.filter((x) => x !== id)); };
  const add = (id) => commit([...list, id]);
  const toggleSmart = () => { const v = !smart; setSmart(v); onChange({ smart_rotate: v }); };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center"
      style={{ background: "rgba(2,6,20,0.82)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full sm:max-w-md rounded-t-3xl p-5"
        style={{ background: "#0d1424", border: "1px solid rgba(255,255,255,0.08)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 1rem)", animation: "clipSheetUp 0.28s cubic-bezier(0.22,1,0.36,1)" }}>
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "rgba(255,255,255,0.22)" }} />
        <h3 className="text-white font-black text-lg mb-1">Modifier la pile</h3>
        <p className="text-xs mb-4" style={{ color: "#859397" }}>Réordonne (glisse la poignée), retire (balaye vers la gauche) ou ajoute un widget.</p>

        {/* Rotation intelligente */}
        <button onClick={toggleSmart}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl mb-4"
          style={{ background: smart ? NEON + "14" : "#1a2234" }}>
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined" style={{ color: smart ? NEON : "#8b96a8" }}>auto_mode</span>
            <div className="text-left">
              <p className="text-sm font-bold text-white">Rotation intelligente</p>
              <p className="text-[11px]" style={{ color: "#859397" }}>Bascule sur le direct, alterne sinon</p>
            </div>
          </div>
          <span className="relative flex-shrink-0" style={{ width: 42, height: 24, borderRadius: 999, background: smart ? NEON : "#333d52", transition: "background 0.2s" }}>
            <span className="absolute top-0.5 rounded-full bg-white" style={{ width: 20, height: 20, left: smart ? 20 : 2, transition: "left 0.2s" }} />
          </span>
        </button>

        {/* Liste réordonnable */}
        <div className="relative" style={{ height: list.length * ROW_H }}>
          {list.map((id, i) => {
            const w = WIDGETS[id];
            const dragging = drag && drag.index === i;
            const isSwiped = swiped === id;
            return (
              <div key={id} className="absolute left-0 right-0" style={{ top: i * ROW_H, height: ROW_H, transform: rowTransform(i), transition: dragging ? "none" : "transform 0.18s ease", zIndex: dragging ? 5 : 1 }}>
                {/* Bouton supprimer (révélé au swipe) */}
                <button onClick={() => remove(id)} aria-label="Retirer"
                  className="absolute right-0 top-1 bottom-1 flex items-center justify-center rounded-2xl"
                  style={{ width: 64, background: "#f87171", color: "#2a0808" }}>
                  <span className="material-symbols-outlined">delete</span>
                </button>
                {/* Corps de la ligne */}
                <div className="absolute inset-x-0 top-1 bottom-1 flex items-center gap-3 px-3 rounded-2xl"
                  style={{ background: dragging ? "#232c40" : "#1a2234", boxShadow: dragging ? "0 8px 22px rgba(0,0,0,0.5)" : "none", transform: `translateX(${isSwiped ? -72 : 0}px)`, transition: "transform 0.2s ease, background 0.15s" }}
                  onTouchStart={(e) => onRowTouchStart(id, e)} onTouchMove={(e) => onRowTouchMove(id, e)}
                  onClick={() => isSwiped && setSwiped(null)}>
                  <span onPointerDown={(e) => startDrag(i, e)} className="flex-shrink-0 touch-none cursor-grab active:cursor-grabbing" style={{ color: "#5b6577" }} aria-label="Déplacer">
                    <span className="material-symbols-outlined">drag_indicator</span>
                  </span>
                  <span className="material-symbols-outlined" style={{ color: w.color }}>{w.icon}</span>
                  <span className="text-sm font-bold text-white flex-1">{w.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Widgets retirés (à ré-ajouter) */}
        {removed.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#6b7686" }}>Ajouter</p>
            <div className="flex flex-wrap gap-2">
              {removed.map((id) => (
                <button key={id} onClick={() => add(id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                  style={{ background: "#1a2234", color: "#c7d0e0", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <span className="material-symbols-outlined text-base" style={{ color: WIDGETS[id].color }}>{WIDGETS[id].icon}</span>
                  {WIDGETS[id].label}
                  <span className="material-symbols-outlined text-base">add</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Actifs suivis (visible si le widget Finance est dans la pile) */}
        {list.includes("finance") && (
          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: "#6b7686" }}>Actifs suivis</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(FINANCE_CATALOG).map(([id, a]) => {
                const on = fin.includes(id);
                return (
                  <button key={id} onClick={() => toggleAsset(id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors"
                    style={{ background: on ? "#a78bfa22" : "#1a2234", color: on ? "#c4b5fd" : "#8b96a8", border: `1px solid ${on ? "#a78bfa66" : "rgba(255,255,255,0.08)"}` }}>
                    <span className="material-symbols-outlined text-base">{on ? "check_circle" : "radio_button_unchecked"}</span>
                    {a.symbol}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <button onClick={onClose} className="w-full mt-5 py-3 rounded-2xl font-black text-sm" style={{ background: `linear-gradient(135deg,${NEON},#22d3ee)`, color: "#04250f" }}>
          Terminé
        </button>
      </div>
    </div>
  );
}

// ─────────────── Personnalisation par widget (bottom sheet « ... ») ────────────
// Ouvert par les 3 points d'un widget : formulaire adapté au widget actif
// (ligues pour le Foot, cryptos pour la Finance, ville pour la Météo).
function WidgetConfig({ widgetId, favL, favT, financeAssets, weatherCity, onSaveFav, onSaveFinance, onSaveCity, onToggleTeam, onClose }) {
  const [busy, setBusy] = useState(false);
  const [leagues, setLeagues] = useState(() => new Set(favL));                 // Foot
  const [assets, setAssets] = useState(() => (financeAssets || []).slice());   // Finance
  const [q, setQ] = useState(weatherCity?.name || "");                          // Météo
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(weatherCity || null);
  const [teamQ, setTeamQ] = useState("");                                       // Recherche d'équipe (Foot)
  const [teamResults, setTeamResults] = useState([]);
  const [teamSearching, setTeamSearching] = useState(false);
  const [openSections, setOpenSections] = useState(() => new Set(["france"])); // Accordéon : France ouverte par défaut
  const label = WIDGETS[widgetId]?.label || "Widget";

  const toggleSection = (key) => setOpenSections((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const toggleLeague = (id) => setLeagues((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAsset = (id) => setAssets((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  // Recherche d'équipe (debounce 300 ms) : annuaire ESPN /teams, filtré côté client.
  useEffect(() => {
    if (widgetId !== "football") return;
    const term = teamQ.trim();
    if (term.length < 2) { setTeamResults([]); setTeamSearching(false); return; }
    setTeamSearching(true);
    let alive = true;
    const t = setTimeout(async () => {
      const res = await searchTeamsFromEspn(term).catch(() => []);
      if (alive) { setTeamResults(res); setTeamSearching(false); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [teamQ, widgetId]);

  const searchCity = async () => {
    const term = q.trim();
    if (term.length < 2) return;
    setSearching(true);
    try {
      // Géocodage keyless Open-Meteo (fetch brut : ne pas fuiter notre jeton).
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(term)}&count=6&language=fr&format=json`);
      const d = await r.json();
      setResults(Array.isArray(d.results) ? d.results : []);
    } catch { setResults([]); }
    setSearching(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      if (widgetId === "football") await onSaveFav([...leagues]);
      else if (widgetId === "finance") { if (assets.length) await onSaveFinance(assets); }
      else if (widgetId === "weather") await onSaveCity(picked);
    } finally { setBusy(false); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center"
      style={{ background: "rgba(2,6,20,0.82)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full sm:max-w-md rounded-t-3xl p-5"
        style={{ background: "#0d1424", border: "1px solid rgba(255,255,255,0.08)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 1rem)", animation: "clipSheetUp 0.28s cubic-bezier(0.22,1,0.36,1)" }}>
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "rgba(255,255,255,0.22)" }} />
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined" style={{ color: WIDGETS[widgetId]?.color }}>{WIDGETS[widgetId]?.icon}</span>
          <h3 className="text-white font-black text-lg">Personnaliser · {label}</h3>
        </div>

        {/* Foot : recherche d'équipe (favori immédiat) + ligues favorites */}
        {widgetId === "football" && (
          <div className="max-h-[52vh] overflow-y-auto no-scrollbar">
            {/* Barre de recherche épurée */}
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-full mb-3"
              style={{ background: "#0b1220", border: "1px solid rgba(255,255,255,0.08)" }}>
              <span className="material-symbols-outlined flex-shrink-0" style={{ color: "#6b7686", fontSize: 20 }}>search</span>
              <input value={teamQ} onChange={(e) => setTeamQ(e.target.value)}
                placeholder="Rechercher un club (Real, PSG, Dortmund…)"
                className="flex-1 bg-transparent text-sm text-white outline-none min-w-0"
                style={{ caretColor: NEON }} />
              {teamQ && (
                <button onClick={() => setTeamQ("")} className="flex-shrink-0" aria-label="Effacer">
                  <span className="material-symbols-outlined" style={{ color: "#6b7686", fontSize: 18 }}>close</span>
                </button>
              )}
            </div>

            {/* Résultats de recherche : logo · nom · étoile */}
            {teamQ.trim().length >= 2 && (
              <div className="mb-3">
                {teamSearching && teamResults.length === 0 ? (
                  <p className="text-xs px-1 py-2" style={{ color: "#6b7686" }}>Recherche…</p>
                ) : teamResults.length === 0 ? (
                  <p className="text-xs px-1 py-2" style={{ color: "#6b7686" }}>Aucun club trouvé.</p>
                ) : (
                  <div className="space-y-0.5">
                    {teamResults.map((t) => {
                      const on = favT?.has(t.id);
                      return (
                        <div key={t.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl" style={{ background: "#141c2e" }}>
                          {t.logo ? (
                            <img src={t.logo} alt="" className="w-6 h-6 object-contain flex-shrink-0" loading="lazy" />
                          ) : (
                            <span className="w-6 h-6 rounded-full flex-shrink-0" style={{ background: "#2a3446" }} />
                          )}
                          <span className="text-sm flex-1 truncate" style={{ color: "#dae2fd" }}>{t.name}</span>
                          <button onClick={() => onToggleTeam?.(t.id)} aria-label={on ? "Retirer des favoris" : "Ajouter aux favoris"}
                            className="flex items-center justify-center flex-shrink-0 w-8 h-8 active:scale-90 transition-transform">
                            <span className="material-symbols-outlined" style={{
                              fontSize: 20,
                              color: on ? NEON : "#5b6577",
                              fontVariationSettings: `'FILL' ${on ? 1 : 0}`,
                              filter: on ? `drop-shadow(0 0 5px ${NEON}77)` : "none",
                            }}>star</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Compétitions rangées par pays/zone (accordéon) */}
            {FOOT_SECTIONS.map((s) => {
              const open = openSections.has(s.key);
              return (
                <div key={s.key} className="mt-3 first:mt-0">
                  {/* En-tête de section cliquable */}
                  <button onClick={() => toggleSection(s.key)}
                    className="w-full flex items-center justify-between px-1 py-2 active:opacity-70 transition-opacity">
                    <span className="flex items-center gap-2 min-w-0">
                      <span style={{ fontSize: 16, lineHeight: 1 }}>{s.flag}</span>
                      <span className="text-[11px] font-bold uppercase tracking-widest truncate" style={{ color: "#8b96a8" }}>{s.label}</span>
                    </span>
                    <span className="material-symbols-outlined flex-shrink-0"
                      style={{ color: "#6b7686", fontSize: 20, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.25s ease" }}>expand_more</span>
                  </button>
                  {/* Corps de la section (collapse fluide) */}
                  <div style={{ maxHeight: open ? 480 : 0, overflow: "hidden", transition: "max-height 0.3s ease" }}>
                    <div className="space-y-1.5 pt-1 pb-1">
                      {/* Ligues → favorite_leagues (commit à « Enregistrer ») */}
                      {s.leagues.map(([id, name]) => {
                        const on = leagues.has(id);
                        return (
                          <button key={id} onClick={() => toggleLeague(id)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl"
                            style={{ background: on ? NEON + "14" : "#1a2234" }}>
                            <span className="text-sm font-semibold" style={{ color: on ? "#eaf7ee" : "#c7d0e0" }}>{name}</span>
                            <Switch on={on} />
                          </button>
                        );
                      })}
                      {/* Sélection nationale → favorite_teams (favori immédiat) */}
                      {s.nations.map(([id, name]) => {
                        const on = favT?.has(id);
                        return (
                          <button key={id} onClick={() => onToggleTeam?.(id)}
                            className="w-full flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl"
                            style={{ background: on ? NEON + "14" : "#1a2234" }}>
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 16, color: on ? NEON : "#6b7686" }}>flag</span>
                              <span className="text-sm font-semibold truncate" style={{ color: on ? "#eaf7ee" : "#c7d0e0" }}>{name}</span>
                            </span>
                            <Switch on={on} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Finance : cocher les actifs suivis */}
        {widgetId === "finance" && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(FINANCE_CATALOG).map(([id, a]) => {
              const on = assets.includes(id);
              return (
                <button key={id} onClick={() => toggleAsset(id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                  style={{ background: on ? "#a78bfa22" : "#1a2234", color: on ? "#c4b5fd" : "#8b96a8", border: `1px solid ${on ? "#a78bfa66" : "rgba(255,255,255,0.08)"}` }}>
                  <span className="material-symbols-outlined text-base">{on ? "check_circle" : "radio_button_unchecked"}</span>
                  {a.symbol}
                </button>
              );
            })}
          </div>
        )}

        {/* Météo : changer de ville (ou revenir à la localisation auto) */}
        {widgetId === "weather" && (
          <div>
            <div className="flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchCity()}
                placeholder="Rechercher une ville…"
                className="flex-1 px-4 py-2.5 rounded-2xl text-sm text-white outline-none"
                style={{ background: "#1a2234", border: "1px solid rgba(255,255,255,0.08)" }} />
              <button onClick={searchCity} className="px-4 rounded-2xl font-bold text-sm" style={{ background: "#232c40", color: "#c7d0e0" }}>
                <span className="material-symbols-outlined">search</span>
              </button>
            </div>
            {picked && (
              <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-2xl" style={{ background: "#fbbf2414" }}>
                <span className="material-symbols-outlined" style={{ color: "#fbbf24", fontSize: 18 }}>location_on</span>
                <span className="text-sm font-bold text-white flex-1">{picked.name}</span>
                <button onClick={() => { setPicked(null); setResults([]); setQ(""); }} className="text-xs font-bold" style={{ color: "#8b96a8" }}>Localisation auto</button>
              </div>
            )}
            <div className="mt-2 max-h-[34vh] overflow-y-auto no-scrollbar">
              {searching && <p className="text-xs py-2" style={{ color: "#6b7686" }}>Recherche…</p>}
              {results.map((r) => (
                <button key={`${r.id}`} onClick={() => { setPicked({ name: [r.name, r.admin1, r.country_code].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude }); setResults([]); }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left" style={{ color: "#dae2fd" }}>
                  <span className="material-symbols-outlined text-base" style={{ color: "#6b7686" }}>place</span>
                  <span className="text-sm truncate">{[r.name, r.admin1, r.country_code].filter(Boolean).join(", ")}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <button onClick={save} disabled={busy}
          className="w-full mt-5 py-3 rounded-2xl font-black text-sm disabled:opacity-60"
          style={{ background: `linear-gradient(135deg,${NEON},#22d3ee)`, color: "#04250f" }}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────── Pile principale ──────────────────────────────
export default function WidgetStack({ user, setUser }) {
  const navigate = useNavigate();
  const showFoot = user?.show_sports !== false;
  const showMma = user?.show_mma !== false;
  const cfg = user?.widget_stack_config || {};
  const smartRotate = cfg.smart_rotate !== false;
  const configOrder = (Array.isArray(cfg.order) && cfg.order.length) ? cfg.order : DEFAULT_ORDER;
  const financeAssets = (Array.isArray(cfg.finance_assets) && cfg.finance_assets.length) ? cfg.finance_assets : DEFAULT_FINANCE_ASSETS;
  const weatherCity = (cfg.weather_city && typeof cfg.weather_city === "object") ? cfg.weather_city : null;

  const [matches, setMatches] = useState([]);
  const [favL, setFavL] = useState(() => new Set());
  const [favT, setFavT] = useState(() => new Set());
  const [trends, setTrends] = useState([]);
  const [weather, setWeather] = useState(null);
  const [finance, setFinance] = useState([]);
  const [screenMin, setScreenMin] = useState(() => getTodayMinutes());
  const [flashing, setFlashing] = useState({});
  const [openMatch, setOpenMatch] = useState(null);
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(false);
  const [configWidget, setConfigWidget] = useState(null);  // id du widget en cours de personnalisation

  const sigRef = useRef({});
  const hasLiveRef = useRef(false);

  const load = useCallback(() => {
    // Scores : ESPN DIRECT (navigateur) car ESPN bloque l'IP Cloud Run (403).
    // Favoris : backend (/livescores renvoie aussi les favoris de l'utilisateur).
    const favP = axios.get(`${API}/livescores`).then((r) => r.data || {}).catch(() => ({}));
    const espnP = fetchLiveScoresFromEspn({ foot: showFoot, mma: showMma }).catch(() => []);
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
      setFavL(new Set(d.favorites?.leagues || []));
      setFavT(new Set(d.favorites?.teams || []));
      if (changed.length) {
        setFlashing((f) => { const n = { ...f }; changed.forEach((k) => (n[k] = true)); return n; });
        changed.forEach((k) => setTimeout(() => setFlashing((f) => { const n = { ...f }; delete n[k]; return n; }), 3000));
      }
    });
  }, [showFoot, showMma]);

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

  // Météo : ville choisie par l'utilisateur si définie, sinon géoloc du navigateur.
  // GET /weather (rafraîchi toutes les 10 min).
  const wantWeather = configOrder.includes("weather");
  const cityKey = weatherCity ? `${weatherCity.lat},${weatherCity.lon}` : "";
  useEffect(() => {
    if (!wantWeather) return;
    let alive = true;
    const fetchW = (lat, lon) => {
      axios.get(`${API}/weather`, { params: { lat, lon } })
        .then((r) => { if (alive) setWeather(r.data?.weather || null); }).catch(() => {});
    };
    const opts = { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 };
    const run = () => {
      if (weatherCity) fetchW(weatherCity.lat, weatherCity.lon);            // ville forcée
      else if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => fetchW(p.coords.latitude, p.coords.longitude), () => {}, opts);
    };
    run();
    const iv = setInterval(run, 600000);
    return () => { alive = false; clearInterval(iv); };
  }, [wantWeather, cityKey]);

  // Finance : cours crypto en direct (CoinGecko via backend), rafraîchi 60 s.
  const wantFinance = configOrder.includes("finance");
  const financeKey = financeAssets.join(",");
  useEffect(() => {
    if (!wantFinance) return;
    let alive = true;
    const loadFin = () => axios.get(`${API}/finance`, { params: { ids: financeKey } })
      .then((r) => { if (alive) setFinance(Array.isArray(r.data?.assets) ? r.data.assets : []); }).catch(() => {});
    loadFin();
    const iv = setInterval(loadFin, 60000);
    return () => { alive = false; clearInterval(iv); };
  }, [wantFinance, financeKey]);

  // Temps d'écran : rafraîchit le compteur local (bien-être) toutes les 30 s.
  useEffect(() => {
    const iv = setInterval(() => setScreenMin(getTodayMinutes()), 30000);
    return () => clearInterval(iv);
  }, []);

  const toggleFav = (kind, id) => {
    if (!id) return;
    const setFav = kind === "league" ? setFavL : setFavT;
    setFav((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    axios.post(`${API}/users/me/sports-favorites/toggle`, { kind, id }).catch(() => load());
  };

  // Persistance de la config (optimiste + PUT).
  const applyConfig = (patch) => {
    setUser?.((prev) => {
      if (!prev) return prev;
      const cur = prev.widget_stack_config || { smart_rotate: true, order: DEFAULT_ORDER };
      return { ...prev, widget_stack_config: {
        smart_rotate: patch.smart_rotate ?? (cur.smart_rotate !== false),
        order: patch.order ?? (cur.order || DEFAULT_ORDER),
        finance_assets: patch.finance_assets ?? (cur.finance_assets || DEFAULT_FINANCE_ASSETS),
        weather_city: "weather_city" in patch ? patch.weather_city : (cur.weather_city ?? null),
      } };
    });
    axios.put(`${API}/users/me/widget-stack`, patch).catch(() => {});
  };

  // Sauvegardes déclenchées par le bouton « ... » de chaque widget.
  const saveLeagues = async (leagues) => {
    setFavL(new Set(leagues));
    try { await axios.put(`${API}/users/me/sports-favorites`, { leagues, teams: Array.from(favT) }); }
    finally { load(); }
  };
  const saveFinance = (list) => applyConfig({ finance_assets: list });
  const saveCity = (city) => applyConfig({ weather_city: city });

  // Repli DÉMO (opt-in) quand le sport réel est vide → permet de tester le widget.
  const demoOn = demoScoresOn();
  const footBase = displayMatches(matches.filter((m) => m.sport !== "mma"), favL, favT);
  const footItems = footBase.length ? footBase : (demoOn ? DEMO_FOOT : []);
  const mmaBase = displayMatches(matches.filter((m) => m.sport === "mma"), favL, favT);
  const mmaItems = mmaBase.length ? mmaBase : (demoOn ? DEMO_MMA : []);
  const isFavLive = (m) => m.state === "in" && (favL.has(m.league_slug) || favT.has(m.home_id) || favT.has(m.away_id));
  // Pré-match « à surveiller » : favori OU Ligue 1, qui débute dans moins de 2 h.
  const isFavOrL1 = (m) => favL.has(m.league_slug) || favT.has(m.home_id) || favT.has(m.away_id) || m.league_slug === "fra.1";
  const startsWithin2h = (m) => { const t = new Date(m.date).getTime(); return Number.isFinite(t) && (t - Date.now()) <= 2 * 3600 * 1000 && (t - Date.now()) >= -15 * 60 * 1000; };
  const imminentFavPre = footItems.some((m) => m.state === "pre" && isFavOrL1(m) && startsWithin2h(m));
  const financeSwing = finance.some((a) => Math.abs(a.change_24h || 0) >= 5);
  const avail = { football: showFoot && footItems.length > 0, mma: showMma && mmaItems.length > 0, weather: !!weather, finance: finance.length > 0, screentime: true, trends: true };
  const pages = configOrder.filter((id) => avail[id]);

  // Rotation intelligente.
  const pagesRef = useRef(pages);
  const urgentRef = useRef(null);
  const smartRef = useRef(smartRotate);
  const manualUntilRef = useRef(0);
  const rotateAtRef = useRef(Date.now());
  const initRef = useRef(false);
  const mountedAtRef = useRef(Date.now());
  const wantWeatherRef = useRef(wantWeather);
  pagesRef.current = pages;
  smartRef.current = smartRotate;
  wantWeatherRef.current = wantWeather;
  // Urgence (rotation forcée) : direct favori foot > combat MMA en cours >
  // secousse crypto (±5 % sur 24 h) > pré-match favori/Ligue 1 imminent (< 2 h).
  let urgent = null;
  if (smartRotate) {
    if (footItems.some(isFavLive)) urgent = "football";
    else if (mmaItems.some((m) => m.state === "in")) urgent = "mma";
    else if (financeSwing) urgent = "finance";
    else if (imminentFavPre) urgent = "football";
  }
  urgentRef.current = urgent;

  useEffect(() => {
    const iv = setInterval(() => {
      const ps = pagesRef.current;
      if (!ps.length || !smartRef.current) return;
      if (Date.now() < manualUntilRef.current) return;
      const u = urgentRef.current;
      if (u && ps.includes(u)) { setActive(ps.indexOf(u)); rotateAtRef.current = Date.now(); return; }
      if (!initRef.current) {
        const hour = new Date().getHours();
        const morning = hour >= 6 && hour < 10;
        // Le matin (6 h–10 h) sans direct favori : la météo passe par défaut. Si
        // la géoloc n'a pas encore répondu, on patiente jusqu'à 5 s avant d'ouvrir.
        if (morning && wantWeatherRef.current && !ps.includes("weather") && Date.now() - mountedAtRef.current < 5000) return;
        initRef.current = true;
        let dflt = ps.indexOf("trends");
        if (morning && ps.includes("weather")) dflt = ps.indexOf("weather");
        setActive(dflt >= 0 ? dflt : 0);
        rotateAtRef.current = Date.now();
        return;
      }
      if (Date.now() - rotateAtRef.current >= 10000) {
        rotateAtRef.current = Date.now();
        setActive((a) => (a + 1) % ps.length);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const idx = Math.min(active, Math.max(0, pages.length - 1));

  // Gestes : swipe vertical (changer de widget) + appui long 2 s (mode Édition).
  // FIX iOS/Android : les écouteurs tactiles de React sont PASSIFS par défaut →
  // e.preventDefault() y est ignoré et la PAGE défile derrière la pile. On attache
  // donc des écouteurs NATIFS non passifs ({ passive:false }) sur le conteneur
  // (via ref) et on preventDefault + stopPropagation le geste vertical : le fil
  // d'arrière-plan (et son pull-to-refresh) reste figé pendant la manipulation.
  // Le geste HORIZONTAL n'est pas bloqué → les rangées de cartes restent
  // défilables, et les taps (clicks) continuent de fonctionner (pas de
  // preventDefault au touchstart).
  const containerRef = useRef(null);
  const touch = useRef({ x: 0, y: 0, active: false });
  const lpRef = useRef(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onStart = (e) => {
      e.stopPropagation();
      const t = e.touches[0];
      touch.current = { x: t.clientX, y: t.clientY, active: true };
      clearTimeout(lpRef.current);
      lpRef.current = setTimeout(() => setEditing(true), 2000);
    };
    const onMove = (e) => {
      e.stopPropagation();
      const t = e.touches[0];
      const dx = t.clientX - touch.current.x;
      const dy = t.clientY - touch.current.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(lpRef.current);
      // Geste vertical dominant → on NEUTRALISE le scroll de la page (force brute).
      if (Math.abs(dy) >= Math.abs(dx)) e.preventDefault();
    };
    const onEnd = (e) => {
      e.stopPropagation();
      clearTimeout(lpRef.current);
      if (!touch.current.active) return;
      touch.current.active = false;
      const ct = e.changedTouches[0];
      const dy = (ct?.clientY ?? touch.current.y) - touch.current.y;
      const dx = (ct?.clientX ?? touch.current.x) - touch.current.x;
      if (Math.abs(dy) < 30 || Math.abs(dx) > Math.abs(dy)) return; // vrai swipe vertical
      manualUntilRef.current = Date.now() + 15000;
      const n = pagesRef.current.length;
      setActive((a) => Math.max(0, Math.min(n - 1, a + (dy < 0 ? 1 : -1))));
    };
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, []);  // refs stables (pagesRef, manualUntilRef, lpRef, touch) ; setActive/setEditing stables

  const cardProps = {
    favL, favT,
    onToggleLeague: (id) => toggleFav("league", id),
    onToggleTeam: (id) => toggleFav("team", id),
    onOpen: setOpenMatch,
  };

  // Clic sur « ... » : ouvre la personnalisation du widget (ligues/cryptos/ville).
  // Pour les widgets sans réglage propre (tendances, MMA, temps d'écran), on
  // ouvre le mode Édition global de la pile.
  const CONFIGURABLE = { football: 1, finance: 1, weather: 1 };
  const openWidgetMenu = (id) => { if (CONFIGURABLE[id]) setConfigWidget(id); else setEditing(true); };

  const PageHeader = ({ id }) => {
    const w = WIDGETS[id];
    return (
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined" style={{ color: w.color, fontSize: 15 }}>{w.icon}</span>
          <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: "#8b96a8" }}>{w.label}</span>
        </div>
        <button onClick={() => openWidgetMenu(id)} aria-label="Personnaliser ce widget"
          className="flex items-center justify-center -m-1 p-1 rounded-lg active:scale-90 transition-transform">
          <span className="material-symbols-outlined" style={{ color: "#6b7686", fontSize: 16 }} title="Personnaliser">more_horiz</span>
        </button>
      </div>
    );
  };

  const pageNode = (id) => {
    if (id === "football") return (
      <div className="h-full flex flex-col pl-3 py-2.5">
        <div className="pr-3"><PageHeader id="football" /></div>
        <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar items-center" style={{ scrollSnapType: "x mandatory", paddingRight: 16 }}>
          {footItems.map((m) => (
            <div key={m.id} className="flex-shrink-0" style={{ scrollSnapAlign: "start" }}>
              <MatchCard m={m} flash={!!flashing[`foot-${m.id}`]} {...cardProps} />
            </div>
          ))}
        </div>
      </div>
    );
    if (id === "mma") return (
      <div className="h-full flex flex-col pl-3 py-2.5">
        <div className="pr-3"><PageHeader id="mma" /></div>
        <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar items-center" style={{ scrollSnapType: "x mandatory", paddingRight: 16 }}>
          {mmaItems.map((m) => (
            <div key={m.id} className="flex-shrink-0" style={{ scrollSnapAlign: "start" }}>
              <MmaCard m={m} flash={!!flashing[`mma-${m.id}`]} />
            </div>
          ))}
        </div>
      </div>
    );
    if (id === "screentime") {
      const mins = Math.max(0, Math.floor(screenMin));
      const h = Math.floor(mins / 60), mm = mins % 60;
      const big = h ? `${h}h${String(mm).padStart(2, "0")}` : `${mm}`;
      const unit = h ? "" : " min";
      const limit = Number(user?.daily_time_limit) || 0;
      const pct = limit ? Math.min(100, Math.round((mins / limit) * 100)) : 0;
      const over = limit && mins >= limit;
      return (
        <div className="h-full flex flex-col px-4 py-2.5">
          <PageHeader id="screentime" />
          <div className="flex-1 flex flex-col justify-center">
            <div className="flex items-baseline gap-1">
              <span className="font-extralight leading-none text-white" style={{ fontSize: 40, textShadow: "0 0 16px rgba(52,211,153,0.25)" }}>{big}</span>
              <span className="text-white/60 font-light" style={{ fontSize: 16 }}>{unit}</span>
              <span className="text-[11px] ml-1.5" style={{ color: "#8b96a8" }}>aujourd'hui</span>
            </div>
            {limit > 0 ? (
              <div className="mt-2.5">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#1a2234" }}>
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: over ? "#f87171" : "linear-gradient(90deg,#34d399,#22d3ee)", transition: "width 0.4s ease" }} />
                </div>
                <p className="text-[11px] mt-1" style={{ color: over ? "#f87171" : "#6b7686" }}>
                  {over ? "Limite du jour atteinte" : `sur ${limit} min · limite quotidienne`}
                </p>
              </div>
            ) : (
              <p className="text-[11px] mt-2" style={{ color: "#6b7686" }}>Fixe une limite dans Réglages → Bien-être numérique.</p>
            )}
          </div>
        </div>
      );
    }
    if (id === "finance") return (
      <div className="h-full flex flex-col px-4 py-2.5">
        <PageHeader id="finance" />
        <div className="flex-1 overflow-y-auto no-scrollbar">
          {finance.length === 0 ? (
            <p className="text-xs pt-2" style={{ color: "#6b7686" }}>Chargement des cours…</p>
          ) : finance.map((a) => {
            const chg = a.change_24h;
            const up = (chg || 0) >= 0;
            return (
              <div key={a.id} className="flex items-center gap-2 py-1">
                <span className="text-sm font-black text-white w-12 flex-shrink-0">{a.symbol}</span>
                <span className="text-sm font-semibold flex-1 text-center tabular-nums truncate" style={{ color: "#dae2fd" }}>{fmtEur(a.price)}</span>
                <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums"
                  style={up
                    ? { background: NEON + "22", color: NEON, boxShadow: `0 0 8px ${NEON}44` }
                    : { background: "#ef444418", color: "#f87171" }}>
                  {chg == null ? "—" : `${up ? "+" : ""}${chg.toFixed(2)}%`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
    if (id === "weather") return (
      <div className="h-full flex flex-col px-4 py-2.5">
        <PageHeader id="weather" />
        {weather ? (
          <div className="flex-1 flex items-center gap-3">
            <div style={{ color: weather.is_day ? "#fbbf24" : "#93c5fd", flexShrink: 0 }}>
              <WeatherIcon cond={weather.cond} isDay={weather.is_day} size={58} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start">
                <span className="font-extralight leading-none text-white" style={{ fontSize: 46, textShadow: "0 0 18px rgba(255,255,255,0.25)" }}>
                  {weather.temp != null ? weather.temp : "--"}
                </span>
                <span className="text-white/70 font-light mt-1" style={{ fontSize: 20 }}>°</span>
              </div>
              <p className="text-sm font-semibold truncate mt-0.5" style={{ color: "#dae2fd" }}>{weather.location || "Ma position"}</p>
              <p className="text-[11px] truncate" style={{ color: "#8b96a8" }}>
                {weather.label}
                {weather.feels_like != null && ` · ressenti ${weather.feels_like}°`}
                {weather.humidity != null && ` · ${weather.humidity}%`}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-xs" style={{ color: "#6b7686" }}>Autorise la localisation pour la météo.</p>
          </div>
        )}
      </div>
    );
    return (
      <div className="h-full flex flex-col px-4 py-2.5">
        <PageHeader id="trends" />
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

  if (!pages.length) return null;

  return (
    <div className="px-4 pt-1 pb-2">
      <div ref={containerRef} className="relative rounded-2xl overflow-hidden select-none"
        style={{ height: STACK_H, background: "#0d1424", border: "1px solid rgba(255,255,255,0.06)", touchAction: "pan-x" }}>
        <div style={{ height: STACK_H * pages.length, transform: `translateY(-${idx * STACK_H}px)`, transition: "transform 0.4s cubic-bezier(0.22,1,0.36,1)" }}>
          {pages.map((id) => (<div key={id} style={{ height: STACK_H }}>{pageNode(id)}</div>))}
        </div>
        {pages.length > 1 && (
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex flex-col gap-1.5">
            {pages.map((id, i) => (
              <button key={id} onClick={() => { manualUntilRef.current = Date.now() + 15000; setActive(i); }} aria-label={`Widget ${i + 1}`}
                className="rounded-full transition-all" style={{ width: 5, height: i === idx ? 12 : 5, background: i === idx ? NEON : "rgba(255,255,255,0.28)" }} />
            ))}
          </div>
        )}
      </div>
      {openMatch && <MatchCenter match={openMatch} onClose={() => setOpenMatch(null)} />}
      {editing && (
        <StackEditor order={configOrder} smartRotate={smartRotate} financeAssets={financeAssets} onChange={applyConfig} onClose={() => setEditing(false)} />
      )}
      {configWidget && (
        <WidgetConfig
          widgetId={configWidget}
          favL={favL}
          favT={favT}
          financeAssets={financeAssets}
          weatherCity={weatherCity}
          onSaveFav={saveLeagues}
          onSaveFinance={saveFinance}
          onSaveCity={saveCity}
          onToggleTeam={(id) => toggleFav("team", id)}
          onClose={() => setConfigWidget(null)}
        />
      )}
    </div>
  );
}
