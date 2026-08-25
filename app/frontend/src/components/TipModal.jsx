// Pourboire (Tip) — montant + moyen de paiement.
// Le créateur peut proposer : carte (Stripe), PayPal (paiement automatique avec
// commission), lien PayPal.me (sans commission) et/ou crypto. On n'affiche que
// les moyens réellement activés par le créateur.
import { useTranslation } from "react-i18next";
import { useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";

const PRESETS = [1, 2, 5, 10];

export default function TipModal({
  userId, username,
  canReceiveTips = false, paypalReceivable = false, paypalLink = "", cryptoWallet = "",
  onClose,
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(2);   // montant sélectionné (€)
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(false);

  const value = custom ? Number(custom) : amount;
  const amountOk = value >= 1 && value <= 1000;
  const hasAmountMethod = canReceiveTips || paypalReceivable;

  const payStripe = async () => {
    if (!amountOk) { toast.error(t("tip.err_amount")); return; }
    setLoading(true);
    try {
      const res = await axios.post(`${API}/users/${userId}/tip-checkout`, { amount_cents: Math.round(value * 100) });
      if (res.data?.url) window.location.href = res.data.url;
      else { toast.error(t("tip.err_tip_unavailable")); setLoading(false); }
    } catch (e) { toast.error(e.response?.data?.detail || t("tip.err_tip_unavailable")); setLoading(false); }
  };

  const payPaypal = async () => {
    if (!amountOk) { toast.error(t("tip.err_amount")); return; }
    setLoading(true);
    try {
      const res = await axios.post(`${API}/users/${userId}/paypal-tip`, { amount_cents: Math.round(value * 100) });
      if (res.data?.url) window.location.href = res.data.url;
      else { toast.error(t("tip.err_paypal_unavailable")); setLoading(false); }
    } catch (e) { toast.error(e.response?.data?.detail || t("tip.err_paypal_unavailable")); setLoading(false); }
  };

  const copyCrypto = async () => {
    try { await navigator.clipboard.writeText(cryptoWallet); toast.success(t("tip.crypto_copied")); }
    catch { toast.info(cryptoWallet); }
  };

  const presetBtn = (v) => (
    <button key={v} onClick={() => { setAmount(v); setCustom(""); }} disabled={loading}
      className="py-3 rounded-xl font-black text-sm active:scale-95 transition-all disabled:opacity-50"
      style={{
        background: !custom && amount === v ? "linear-gradient(135deg,#22d3ee,#3b82f6)" : "#222a3d",
        color: !custom && amount === v ? "#00363e" : "#dae2fd",
        border: "1px solid rgba(255,255,255,0.08)",
      }}>
      {v} €
    </button>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: "rgba(2,6,20,0.8)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}>
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5"
        style={{ background: "#171f33", border: "1px solid rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined" style={{ color: "var(--nexus-accent)" }}>volunteer_activism</span>
          <h3 className="font-bold text-white">{username ? t("tip.support_user", { user: username }) : t("tip.support")}</h3>
        </div>
        <p className="text-[12px] mb-4" style={{ color: "#859397" }}>
          {t("tip.subtitle")}
        </p>

        {/* Montant partagé (carte + PayPal) */}
        {hasAmountMethod && (
          <>
            <div className="grid grid-cols-4 gap-2 mb-2">{PRESETS.map(presetBtn)}</div>
            <div className="flex items-center rounded-xl px-3 mb-3"
              style={{ background: "#222a3d", border: `1px solid ${custom ? "var(--nexus-accent)" : "rgba(255,255,255,0.08)"}` }}>
              <input type="number" min="1" max="1000" step="1" inputMode="decimal"
                value={custom} onChange={(e) => setCustom(e.target.value)}
                placeholder={t("tip.custom_amount")}
                className="flex-1 bg-transparent outline-none py-3 text-sm text-white" />
              <span className="text-sm font-bold" style={{ color: "#859397" }}>€</span>
            </div>

            <div className="space-y-2">
              {canReceiveTips && (
                <button onClick={payStripe} disabled={loading || !amountOk}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm active:scale-95 transition-all disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: "#00363e" }}>
                  <span className="material-symbols-outlined text-lg">credit_card</span>
                  {t("tip.pay_card", { amount: amountOk ? `${value} € ` : "" })}
                </button>
              )}
              {paypalReceivable && (
                <button onClick={payPaypal} disabled={loading || !amountOk}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-black text-sm active:scale-95 transition-all disabled:opacity-50"
                  style={{ background: "#ffc439", color: "#0a1628" }}>
                  <span className="material-symbols-outlined text-lg">account_balance_wallet</span>
                  {t("tip.pay_paypal", { amount: amountOk ? `${value} € ` : "" })}
                </button>
              )}
            </div>
            <p className="text-[11px] mt-2 mb-1" style={{ color: "#859397" }}>{t("tip.secure_note")}</p>
          </>
        )}

        {/* Moyens par lien (sans montant prédéfini) */}
        {((paypalLink && !paypalReceivable) || cryptoWallet) && (
          <>
            {hasAmountMethod && <div className="h-px my-3" style={{ background: "rgba(255,255,255,0.08)" }} />}
            <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: "#859397" }}>
              {hasAmountMethod ? t("tip.other_methods") : t("tip.available_methods")}
            </p>
            <div className="space-y-2">
              {paypalLink && !paypalReceivable && (
                <a href={paypalLink} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 rounded-xl active:scale-95 transition-all"
                  style={{ background: "#222a3d", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <span className="material-symbols-outlined" style={{ color: "#22d3ee" }}>account_balance_wallet</span>
                  <span className="text-sm font-bold text-white flex-1">{t("tip.pay_with_paypal")}</span>
                  <span className="material-symbols-outlined text-base" style={{ color: "#859397" }}>open_in_new</span>
                </a>
              )}
              {cryptoWallet && (
                <button onClick={copyCrypto}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl active:scale-95 transition-all text-left"
                  style={{ background: "#222a3d", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <span className="material-symbols-outlined" style={{ color: "#22d3ee" }}>currency_bitcoin</span>
                  <span className="text-sm font-bold text-white flex-1">{t("tip.copy_crypto")}</span>
                  <span className="material-symbols-outlined text-base" style={{ color: "#859397" }}>content_copy</span>
                </button>
              )}
            </div>
          </>
        )}

        <button onClick={onClose} disabled={loading}
          className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
          style={{ background: "#222a3d", color: "#a7b3cc" }}>
          {t("tip.close")}
        </button>
      </div>
    </div>
  );
}
