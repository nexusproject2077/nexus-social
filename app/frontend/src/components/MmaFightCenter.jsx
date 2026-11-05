// Fiche UFC dédiée. Les deux colonnes proviennent du même event_id ESPN :
// aucune donnée d'un autre combat n'est réutilisée comme remplissage.
import { useCallback, useEffect, useState } from "react";
import { fetchMmaFightDetailsFromEspn } from "@/lib/espnClient";

const RED = "#f05252";
const statRows = [
  ["age", "Âge"], ["weight", "Poids"], ["height", "Taille"], ["reach", "Allonge"],
  ["winsByKo", "Victoires par KO"], ["sigStrikes", "Frappes significatives"],
  ["submissions", "Victoires par soumission"], ["takedowns", "Takedowns"],
];

const dateParis = (value) => {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "Date à confirmer";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
};

function FighterPortrait({ fighter, side }) {
  const [failed, setFailed] = useState(false);
  return <section className={`relative flex min-w-0 flex-1 flex-col items-center justify-end text-center ${side === "left" ? "items-start" : "items-end"}`}>
    <div className="relative flex h-52 w-full items-end justify-center overflow-hidden sm:h-72">
      {fighter.avatar && !failed ? <img src={fighter.avatar} alt={`Portrait de ${fighter.name}`} loading="eager" onError={() => setFailed(true)} className="h-full max-w-full object-contain object-bottom" style={{ filter: "drop-shadow(0 18px 22px rgba(0,0,0,.75))" }} /> : <span className="material-symbols-outlined text-7xl" style={{ color: "#363636" }}>sports_mma</span>}
      <span className="absolute inset-x-0 bottom-0 h-24" style={{ background: "linear-gradient(transparent,#050505)" }} />
    </div>
    <p className="relative -mt-11 min-h-10 px-1 text-lg font-black leading-tight text-white sm:text-2xl">{fighter.name}</p>
    <p className="relative mt-1 text-sm font-bold" style={{ color: "#a9a9a9" }}>{fighter.record || "Palmarès indisponible"}</p>
  </section>;
}

function Value({ value }) { return <span className="text-sm font-black tabular-nums text-white sm:text-lg">{value || "—"}</span>; }

export default function MmaFightCenter({ fight, onClose }) {
  const [detail, setDetail] = useState(() => ({ fighters: [fight.f1 || {}, fight.f2 || {}], event: fight.event, date: fight.date, state: fight.state, detail: fight.detail }));
  const eventId = fight.event_id || fight.id;
  const load = useCallback(() => {
    fetchMmaFightDetailsFromEspn(eventId, fight).then(setDetail).catch(() => {});
  }, [eventId, fight]);
  useEffect(() => { load(); const interval = setInterval(load, 60000); return () => clearInterval(interval); }, [load]);
  useEffect(() => { const previous = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = previous; }; }, []);

  const [left = {}, right = {}] = detail.fighters || [];
  const live = detail.state === "in";
  const hasStats = statRows.some(([key]) => left[key] || right[key]);
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/90 sm:items-center sm:p-5" onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}>
    <article className="flex h-[100dvh] w-full max-w-4xl flex-col overflow-hidden bg-[#050505] sm:h-[90dvh] sm:rounded-[28px]" aria-label="Fiche combat UFC">
      <header className="relative z-20 flex flex-shrink-0 items-center justify-between border-b border-white/10 bg-[#050505] px-3 pb-3 sm:px-6 sm:py-4" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition-transform active:scale-90" aria-label="Retour aux scores">
          <span className="material-symbols-outlined" style={{ fontSize: 27 }}>arrow_back</span>
        </button>
        <div className="min-w-0 flex-1 px-3 text-center"><p className="text-[10px] font-black uppercase tracking-[.18em]" style={{ color: RED }}>MMA / UFC</p><p className="mt-1 truncate text-sm font-bold text-white">{fight.event || "UFC"}</p></div>
        <button type="button" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition-transform active:scale-90" aria-label="Fermer"><span className="material-symbols-outlined">close</span></button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="px-4 pt-4 text-center sm:px-8"><p className="text-sm font-black text-white">{live ? "EN DIRECT" : detail.state === "post" ? (detail.detail || "Terminé") : dateParis(detail.date)}</p><p className="mt-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: live ? "#4ade80" : "#888" }}>{live ? detail.detail || "Combat en cours" : "Face-à-face"}</p></div>
        <div className="mx-auto mt-1 flex max-w-2xl items-end gap-2 px-3 sm:gap-8 sm:px-10"><FighterPortrait fighter={left} side="left" /><div className="mb-8 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 text-xs font-black text-white">VS</div><FighterPortrait fighter={right} side="right" /></div>
        <section className="mx-auto max-w-xl border-y border-white/10 px-5 py-5 sm:px-8" aria-label="Comparaison des combattants">
          {hasStats ? <div className="space-y-4">{statRows.filter(([key]) => left[key] || right[key]).map(([key, label]) => <div key={key} className="grid grid-cols-[1fr_auto_1fr] items-center gap-3"><div className="text-right"><Value value={left[key]} /></div><span className="min-w-28 text-center text-[10px] font-black uppercase tracking-wide" style={{ color: "#8b8b8b" }}>{label}</span><div><Value value={right[key]} /></div></div>)}</div> : <p className="py-3 text-center text-sm" style={{ color: "#9b9b9b" }}>Les statistiques détaillées de ce combat ne sont pas encore fournies par la source.</p>}
        </section>
        <p className="px-6 py-4 text-center text-[11px]" style={{ color: "#6f6f6f" }}>Données et portraits liés à cette affiche UFC uniquement · actualisation automatique</p>
      </main>
    </article>
  </div>;
}
