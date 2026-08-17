// Pourboire (Tip) — sélecteur de montant + moyens de paiement.
// Le créateur peut proposer : carte (Stripe Checkout), PayPal.me, crypto.
// On n'affiche QUE les moyens réellement activés par le créateur.
import { useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";

const PRESETS = [1, 2, 5, 10];

export default function TipModal({ userId, username, canReceiveTips = true, paypalLink = "", cryptoWallet = "", onClose }) {
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

  const copyCrypto = async () => {
    try { await navigator.clipboard.writeText(cryptoWallet); toast.success("Adresse crypto copiée 🙌"); }
    catch { toast.info(cryptoWallet); }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: "rgba(2,6,20,0.8)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
    >
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5"
        style={{ background: "#171f33", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined" style={{ color: "var(--nexus-accent)" }}>volunteer_activism</span>
          <h3 className="font-bold text-white">Soutenir{username ? ` @${username}` : ""}</h3>
        </div>
        <p className="text-[12px] mb-4" style={{ color: "#859397" }}>
          Un petit geste pour l'encourager. Choisis un montant et un moyen de paiement.
        </p>

        {/* ── Carte bancaire (Stripe) ── */}
        {canReceiveTips && (
          <>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#859397" }}>Par carte</p>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {PRESETS.map((v) => (
                <button key={v} onClick={() => send(v)} disabled={loading}
                  className="py-3 rounded-xl font-black text-sm active:scale-95 transition-all disabled:opacity-50"
                  style={{ background: "#222a3d", color: "#dae2fd", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {v} €
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mb-2">
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
            <p className="text-[11px] mb-3" style={{ color: "#859397" }}>
              Paiement sécurisé via Stripe.
            </p>
          </>
        )}

        {/* ── Autres moyens (PayPal / crypto) — sans commission Nexus ── */}
        {(paypalLink || cryptoWallet) && (
          <>
            {canReceiveTips && <div className="h-px my-1" style={{ background: "rgba(255,255,255,0.08)" }} />}
            <p className="text-[11px] font-bold uppercase tracking-widest mt-3 mb-2" style={{ color: "#859397" }}>
              {canReceiveTips ? "Autres moyens" : "Moyens disponibles"}
            </p>
            <div className="space-y-2">
              {paypalLink && (
                <a href={paypalLink} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 rounded-xl active:scale-95 transition-all"
                  style={{ background: "#222a3d", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <span className="material-symbols-outlined" style={{ color: "#22d3ee" }}>account_balance_wallet</span>
                  <span className="text-sm font-bold text-white flex-1">Payer avec PayPal</span>
                  <span className="material-symbols-outlined text-base" style={{ color: "#859397" }}>open_in_new</span>
                </a>
              )}
              {cryptoWallet && (
                <button onClick={copyCrypto}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl active:scale-95 transition-all text-left"
                  style={{ background: "#222a3d", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <span className="material-symbols-outlined" style={{ color: "#22d3ee" }}>currency_bitcoin</span>
                  <span className="text-sm font-bold text-white flex-1">Copier l'adresse crypto</span>
                  <span className="material-symbols-outlined text-base" style={{ color: "#859397" }}>content_copy</span>
                </button>
              )}
            </div>
          </>
        )}

        <button onClick={onClose} disabled={loading}
          className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
          style={{ background: "#222a3d", color: "#a7b3cc" }}>
          Fermer
        </button>
      </div>
    </div>
  );
}
