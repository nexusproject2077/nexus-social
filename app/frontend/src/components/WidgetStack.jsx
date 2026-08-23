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
import { MatchCard, MmaCard, sortMatches } from "@/components/LiveScores";

const NEON = "#4ade80";
const STACK_H = 150;
const ROW_H = 54;
const WIDGETS = {
  football: { label: "Football", icon: "sports_soccer", color: NEON },
  mma: { label: "MMA / UFC", icon: "sports_mma", color: "#ef4444" },
  trends: { label: "Tendances", icon: "trending_up", color: "#22d3ee" },
  weather: { label: "Météo", icon: "partly_cloudy_day", color: "#fbbf24" },
  finance: { label: "Finance", icon: "monitoring", color: "#a78bfa" },
};
const DEFAULT_ORDER = ["trends", "weather", "finance", "football", "mma"];

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

// ─────────────────────────────── Pile principale ──────────────────────────────
export default function WidgetStack({ user, setUser }) {
  const navigate = useNavigate();
  const showFoot = user?.show_sports !== false;
  const showMma = user?.show_mma !== false;
  const cfg = user?.widget_stack_config || {};
  const smartRotate = cfg.smart_rotate !== false;
  const configOrder = (Array.isArray(cfg.order) && cfg.order.length) ? cfg.order : DEFAULT_ORDER;
  const financeAssets = (Array.isArray(cfg.finance_assets) && cfg.finance_assets.length) ? cfg.finance_assets : DEFAULT_FINANCE_ASSETS;

  const [matches, setMatches] = useState([]);
  const [favL, setFavL] = useState(() => new Set());
  const [favT, setFavT] = useState(() => new Set());
  const [trends, setTrends] = useState([]);
  const [weather, setWeather] = useState(null);
  const [finance, setFinance] = useState([]);
  const [flashing, setFlashing] = useState({});
  const [openMatch, setOpenMatch] = useState(null);
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(false);

  const sigRef = useRef({});
  const hasLiveRef = useRef(false);

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

  // Météo : géoloc du navigateur → GET /weather (rafraîchi toutes les 10 min).
  const wantWeather = configOrder.includes("weather");
  useEffect(() => {
    if (!wantWeather || !navigator.geolocation) return;
    let alive = true;
    const fetchW = (pos) => {
      axios.get(`${API}/weather`, { params: { lat: pos.coords.latitude, lon: pos.coords.longitude } })
        .then((r) => { if (alive) setWeather(r.data?.weather || null); }).catch(() => {});
    };
    const opts = { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 };
    navigator.geolocation.getCurrentPosition(fetchW, () => {}, opts);
    const iv = setInterval(() => navigator.geolocation.getCurrentPosition(fetchW, () => {}, opts), 600000);
    return () => { alive = false; clearInterval(iv); };
  }, [wantWeather]);

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
      } };
    });
    axios.put(`${API}/users/me/widget-stack`, patch).catch(() => {});
  };

  const footItems = sortMatches(matches.filter((m) => m.sport !== "mma"), favL, favT);
  const mmaItems = matches.filter((m) => m.sport === "mma");
  const isFavLive = (m) => m.state === "in" && (favL.has(m.league_slug) || favT.has(m.home_id) || favT.has(m.away_id));
  const financeSwing = finance.some((a) => Math.abs(a.change_24h || 0) >= 5);
  const avail = { football: showFoot && footItems.length > 0, mma: showMma && mmaItems.length > 0, weather: !!weather, finance: finance.length > 0, trends: true };
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
  // secousse crypto (±5 % sur 24 h) d'un actif suivi.
  let urgent = null;
  if (smartRotate) {
    if (footItems.some(isFavLive)) urgent = "football";
    else if (mmaItems.some((m) => m.state === "in")) urgent = "mma";
    else if (financeSwing) urgent = "finance";
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
  const touch = useRef({ x: 0, y: 0, active: false });
  const lpRef = useRef(null);
  // Isolation stricte du geste : on stoppe la propagation vers les parents
  // (notamment le pull-to-refresh du fil) pour que SEULE la pile réagisse. Le
  // défilement vertical natif de la PAGE est déjà coupé par `touchAction: pan-x`
  // sur le conteneur (les rangées horizontales internes restent défilables).
  const onTouchStart = (e) => {
    e.stopPropagation();
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, active: true };
    clearTimeout(lpRef.current);
    lpRef.current = setTimeout(() => setEditing(true), 2000);
  };
  const onTouchMove = (e) => {
    e.stopPropagation();
    const t = e.touches[0];
    if (Math.abs(t.clientX - touch.current.x) > 12 || Math.abs(t.clientY - touch.current.y) > 12) clearTimeout(lpRef.current);
  };
  const onTouchEnd = (e) => {
    e.stopPropagation();
    clearTimeout(lpRef.current);
    if (!touch.current.active) return;
    touch.current.active = false;
    const dy = (e.changedTouches[0]?.clientY ?? touch.current.y) - touch.current.y;
    const dx = (e.changedTouches[0]?.clientX ?? touch.current.x) - touch.current.x;
    if (Math.abs(dy) < 30 || Math.abs(dx) > Math.abs(dy)) return; // vrai swipe vertical uniquement
    manualUntilRef.current = Date.now() + 15000;
    setActive((a) => Math.max(0, Math.min(pages.length - 1, a + (dy < 0 ? 1 : -1))));
  };

  const cardProps = {
    favL, favT,
    onToggleLeague: (id) => toggleFav("league", id),
    onToggleTeam: (id) => toggleFav("team", id),
    onOpen: setOpenMatch,
  };

  const PageHeader = ({ id }) => {
    const w = WIDGETS[id];
    return (
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined" style={{ color: w.color, fontSize: 15 }}>{w.icon}</span>
          <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: "#8b96a8" }}>{w.label}</span>
        </div>
        <span className="material-symbols-outlined" style={{ color: "#3b475e", fontSize: 15 }} title="Appui long pour éditer">more_horiz</span>
      </div>
    );
  };

  const pageNode = (id) => {
    if (id === "football") return (
      <div className="h-full flex flex-col px-3 py-2.5">
        <PageHeader id="football" />
        <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar items-center">
          {footItems.map((m) => <MatchCard key={m.id} m={m} flash={!!flashing[`foot-${m.id}`]} {...cardProps} />)}
        </div>
      </div>
    );
    if (id === "mma") return (
      <div className="h-full flex flex-col px-3 py-2.5">
        <PageHeader id="mma" />
        <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar items-center">
          {mmaItems.map((m) => <MmaCard key={m.id} m={m} flash={!!flashing[`mma-${m.id}`]} />)}
        </div>
      </div>
    );
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
      <div className="relative rounded-2xl overflow-hidden select-none"
        style={{ height: STACK_H, background: "#0d1424", border: "1px solid rgba(255,255,255,0.06)", touchAction: "pan-x" }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
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
    </div>
  );
}
