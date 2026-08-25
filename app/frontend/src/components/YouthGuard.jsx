// YouthGuard — garde-fous « éthique / bien-être » superposés aux FLUX (fil
// d'accueil + clips). Deux écrans bienveillants, plein écran, route-limités :
//   1. Couvre-feu de nuit (comptes MINEURS) entre 22 h et 06 h.
//   2. Limite de temps quotidienne configurable (tous), désactivable explicitement.
// Le suivi du temps est 100 % local (voir lib/screenTime). Les autres pages
// (réglages, profil, messages) restent accessibles : seuls les flux sont couverts.
import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { addSeconds, getTodayMinutes } from "@/lib/screenTime";
import i18n from "@/i18n";

const TICK_MS = 20000; // granularité du compteur (20 s)

// Routes considérées comme « flux » (fil + clips).
const isFeedRoute = (p) => /^\/(feed|clips|nexus-clips)(\/|$)?/.test(p || "");

export default function YouthGuard({ user, setUser }) {
  const location = useLocation();
  const [minutes, setMinutes] = useState(() => getTodayMinutes());
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);

  // Compteur de temps : n'incrémente que si l'onglet est visible.
  useEffect(() => {
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") addSeconds(TICK_MS / 1000);
      setMinutes(getTodayMinutes());
      setNow(new Date());
    }, TICK_MS);
    return () => clearInterval(iv);
  }, []);

  if (!user || !isFeedRoute(location.pathname)) return null;

  const hour = now.getHours();
  const isMinor = !!user.is_minor;
  const curfew = isMinor && (hour >= 22 || hour < 6);
  const limit = Number(user.daily_time_limit) || 0;
  const limitOn = user.time_limit_enabled !== false && limit > 0 && minutes >= limit;

  if (!curfew && !limitOn) return null;

  const disableLimit = () => {
    setBusy(true);
    axios.put(`${API}/users/me/time-limit`, { time_limit_enabled: false })
      .then(() => setUser?.((p) => (p ? { ...p, time_limit_enabled: false } : p)))
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  // ── Couvre-feu de nuit (prioritaire) ──
  if (curfew) {
    return (
      <Screen bg="#05070f">
        <MoonSvg />
        <p className="text-white text-xl font-black mt-6 mb-2">{i18n.t("youthguard.curfew_title")}</p>
        <p className="text-sm max-w-xs" style={{ color: "#8b96a8" }}>
          {i18n.t("youthguard.curfew_body")}
        </p>
      </Screen>
    );
  }

  // ── Limite de temps quotidienne atteinte ──
  return (
    <Screen bg="#080c18">
      <HourglassSvg />
      <p className="text-white text-xl font-black mt-6 mb-2">{i18n.t("youthguard.limit_title")}</p>
      <p className="text-sm max-w-xs mb-7" style={{ color: "#8b96a8" }}>
        {i18n.t("youthguard.limit_body", { min: Math.floor(minutes) })}
      </p>
      <button onClick={disableLimit} disabled={busy}
        className="px-5 py-2.5 rounded-full text-sm font-bold transition-opacity"
        style={{ background: "#1a2234", color: "#c7d0e0", border: "1px solid rgba(255,255,255,0.1)", opacity: busy ? 0.6 : 1 }}>
        {i18n.t("youthguard.disable_limit")}
      </button>
    </Screen>
  );
}

function Screen({ bg, children }) {
  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center text-center px-8"
      style={{ background: bg, animation: "youthFade 0.4s ease" }}>
      {children}
    </div>
  );
}

function MoonSvg() {
  return (
    <svg width="76" height="76" viewBox="0 0 48 48" fill="none" stroke="#93c5fd" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M31,30 a13,13 0 1 1 -11,-20 a10.5,10.5 0 0 0 11,20 z" />
      <circle cx="34" cy="12" r="0.9" fill="#93c5fd" stroke="none" />
      <circle cx="30" cy="7" r="0.7" fill="#93c5fd" stroke="none" />
      <circle cx="38" cy="18" r="0.7" fill="#93c5fd" stroke="none" />
    </svg>
  );
}

function HourglassSvg() {
  return (
    <svg width="72" height="72" viewBox="0 0 48 48" fill="none" stroke="#fbbf24" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14,8 h20 M14,40 h20" />
      <path d="M15,8 c0,9 8,11 9,16 c1,-5 9,-7 9,-16" />
      <path d="M15,40 c0,-9 8,-11 9,-16 c1,5 9,7 9,16" />
    </svg>
  );
}
