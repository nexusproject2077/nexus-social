// Pourboire (Tip) — sélecteur de montant réutilisable (profil + posts/clips).
// Montants prédéfinis OU montant libre. Redirige vers Stripe Checkout.
import { useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";

const PRESETS = [1, 2, 5, 10];

export default function TipModal({ userId, username, onClose }) {
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);

  const send = async (euros) => {
    const amount = Number(euros);
    if (!amount || amount < 1) { toast.error("Montant minimum : 1 €"); return; }
    if (amount > 1000) { toast.error("Montant maximum : 1 000 €"); return; }
    setLoading(true);
    try {
      const res = await axios.post(`${API}/users/${userId}/tip-checkout`, {
        amount_cents: Math.round(amount * 100),
      });
      if (res.data?.url) window.location.href = res.data.url;
      else { toast.error("Pourboire momentanément indisponible"); setLoading(false); }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Pourboire momentanément indisponible");
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: "rgba(2,6,20,0.8)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5"
        style={{ background: "#171f33", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined" style={{ color: "var(--nexus-accent)" }}>volunteer_activism</span>
          <h3 className="font-bold text-white">Envoyer un pourboire{username ? ` à @${username}` : ""}</h3>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-3">
          {PRESETS.map((v) => (
            <button key={v} onClick={() => send(v)} disabled={loading}
              className="py-3 rounded-xl font-black text-sm active:scale-95 transition-all disabled:opacity-50"
              style={{ background: "#222a3d", color: "#dae2fd", border: "1px solid rgba(255,255,255,0.08)" }}>
              {v} €
            </button>
          ))}
        </div>

        {/* Montant libre */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 flex items-center rounded-xl px-3"
            style={{ background: "#222a3d", border: "1px solid rgba(255,255,255,0.08)" }}>
            <input
              type="number" min="1" max="1000" step="1" inputMode="decimal"
              value={custom} onChange={(e) => setCustom(e.target.value)}
              placeholder="Autre montant"
              className="flex-1 bg-transparent outline-none py-3 text-sm text-white"
            />
            <span className="text-sm font-bold" style={{ color: "#859397" }}>€</span>
          </div>
          <button onClick={() => send(custom)} disabled={loading || !custom}
            className="px-4 py-3 rounded-xl font-bold text-sm active:scale-95 transition-all disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: "#00363e" }}>
            Envoyer
          </button>
        </div>

        <p className="text-[11px] text-center" style={{ color: "#859397" }}>
          Paiement sécurisé via Stripe. Le créateur reçoit le montant après commission de la plateforme.
        </p>
        <button onClick={onClose} disabled={loading}
          className="w-full mt-3 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
          style={{ background: "#222a3d", color: "#a7b3cc" }}>
          Annuler
        </button>
      </div>
    </div>
  );
}
