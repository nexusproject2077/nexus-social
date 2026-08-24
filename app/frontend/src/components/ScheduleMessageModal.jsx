// Sélecteur d'heure pour planifier un message (DM). Raccourcis rapides +
// sélecteur date/heure. Renvoie une date ISO à l'appelant.
import { useState } from "react";

function atToday(h, m = 0) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now() + 60000) d.setDate(d.getDate() + 1); // déjà passé → demain
  return d;
}
function tomorrowAt(h, m = 0) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d;
}
function inHours(h) {
  return new Date(Date.now() + h * 3600 * 1000);
}
const fmt = (d) => d.toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });

// Valeur pour <input type="datetime-local"> (local, sans secondes), min = maintenant+5 min.
function toLocalInput(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function ScheduleMessageModal({ open, onClose, onConfirm, title = "Planifier le message" }) {
  const [custom, setCustom] = useState("");
  if (!open) return null;

  const quick = [
    { label: "Dans 1 heure", d: inHours(1) },
    { label: "Ce soir 18:00", d: atToday(18) },
    { label: "Ce soir 21:00", d: atToday(21) },
    { label: "Demain 10:00", d: tomorrowAt(10) },
  ];
  const confirm = (d) => { onConfirm?.(d.toISOString()); onClose?.(); };

  return (
    <div className="fixed inset-0 z-[96] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: "rgba(2,6,20,0.86)", backdropFilter: "blur(3px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5"
        style={{ background: "#0d1424", border: "1px solid rgba(255,255,255,0.1)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 1rem)", animation: "clipSheetUp 0.28s cubic-bezier(0.22,1,0.36,1)" }}>
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "rgba(255,255,255,0.22)" }} />
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined" style={{ color: "var(--nexus-accent-solid,#22d3ee)" }}>schedule_send</span>
          <h3 className="text-white font-black text-lg">{title}</h3>
        </div>
        <div className="space-y-2">
          {quick.map((q) => (
            <button key={q.label} onClick={() => confirm(q.d)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-2xl active:scale-[0.99] transition-transform"
              style={{ background: "#1a2234" }}>
              <span className="text-sm font-semibold text-white">{q.label}</span>
              <span className="text-xs" style={{ color: "#8b96a8" }}>{fmt(q.d)}</span>
            </button>
          ))}
        </div>
        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#6b7686" }}>Personnalisé</p>
          <div className="flex gap-2">
            <input type="datetime-local" value={custom} min={toLocalInput(inHours(0))}
              onChange={(e) => setCustom(e.target.value)}
              className="flex-1 px-3 py-2.5 rounded-2xl text-sm text-white outline-none"
              style={{ background: "#1a2234", border: "1px solid rgba(255,255,255,0.08)", colorScheme: "dark" }} />
            <button disabled={!custom} onClick={() => { const d = new Date(custom); if (!isNaN(d.getTime())) confirm(d); }}
              className="px-4 rounded-2xl font-black text-sm disabled:opacity-40"
              style={{ background: "linear-gradient(135deg,var(--nexus-accent),#3b82f6)", color: "#04121a" }}>OK</button>
          </div>
        </div>
        <button onClick={onClose} className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold" style={{ background: "#1a2234", color: "#a7b3cc" }}>Annuler</button>
      </div>
    </div>
  );
}
