// Modale de vente « Nexus Premium » (paywall réutilisable).
// Deux offres : Mensuel 3,99 €/mois · Annuel 34,99 €/an (−25 %). Le CTA démarre
// le paiement Stripe pour l'offre sélectionnée ; repli vers /premium si le
// paiement n'est pas configuré. Icônes 100 % SVG (aucune emoji).
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Crown, Check, TrendingUp, Palette, Rocket, BadgeCheck, LayoutGrid } from "lucide-react";

const GOLD = "linear-gradient(135deg,#f9d976,#c8962c)";

// Les 5 piliers inclus dès 3,99 €.
const PERKS = [
  { icon: TrendingUp, text: "Widget Finance & Crypto en temps réel" },
  { icon: Palette, text: "Couleurs exclusives (Or Impérial, Cyberpunk…)" },
  { icon: Rocket, text: "Priorité algorithmique : +20 % de visibilité" },
  { icon: BadgeCheck, text: "Badge de certification néon près du pseudo" },
  { icon: LayoutGrid, text: "Widgets exclusifs (Visites, AI Analytics, Astro)" },
];

const PLANS = {
  annual: { label: "Annuel", price: "34,99 €", per: "/ an", note: "≈ 2,92 €/mois · engagement 12 mois", save: "ÉCONOMISEZ 25%" },
  monthly: { label: "Mensuel", price: "3,99 €", per: "/ mois", note: "Sans engagement", save: null },
};

export default function PremiumModal({ open, onClose, feature }) {
  const navigate = useNavigate();
  const [plan, setPlan] = useState("annual");
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const subscribe = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`${API}/billing/create-checkout-session`, { plan });
      if (r.data?.url) { window.location.href = r.data.url; return; }
      onClose?.(); navigate("/premium");
    } catch {
      onClose?.(); navigate("/premium");
    } finally {
      setBusy(false);
    }
  };

  const PlanCard = ({ id }) => {
    const p = PLANS[id];
    const on = plan === id;
    return (
      <button onClick={() => setPlan(id)}
        className="relative flex-1 rounded-2xl px-3 py-3 text-left transition-all active:scale-[0.98]"
        style={{ background: on ? "rgba(249,217,118,0.10)" : "#141c2e", border: `1.5px solid ${on ? "#c8962c" : "rgba(255,255,255,0.08)"}` }}>
        {p.save && (
          <span className="absolute -top-2.5 left-3 px-2 py-0.5 rounded-full text-[9px] font-black tracking-wide"
            style={{ background: "#4ade80", color: "#04250f", boxShadow: "0 0 10px rgba(74,222,128,0.6)" }}>{p.save}</span>
        )}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: on ? "#e8c874" : "#8b96a8" }}>{p.label}</span>
          <span className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: on ? GOLD : "transparent", border: on ? "none" : "1.5px solid #3a4759" }}>
            {on && <Check className="w-2.5 h-2.5" style={{ color: "#3a2a05" }} strokeWidth={3.5} />}
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-1">
          <span className="text-xl font-black text-white">{p.price}</span>
          <span className="text-[11px]" style={{ color: "#8b96a8" }}>{p.per}</span>
        </div>
        <p className="text-[10px] mt-0.5" style={{ color: "#6b7686" }}>{p.note}</p>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: "rgba(2,6,20,0.86)", backdropFilter: "blur(4px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{ background: "#0d1424", border: "1px solid rgba(255,255,255,0.1)", animation: "clipSheetUp 0.28s cubic-bezier(0.22,1,0.36,1)" }}>
        {/* Bandeau doré */}
        <div className="px-6 pt-7 pb-5 text-center" style={{ background: "linear-gradient(135deg,#1a1405,#0d1424)" }}>
          <div className="mx-auto mb-3 w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: GOLD, boxShadow: "0 8px 24px rgba(201,150,44,0.4)" }}>
            <Crown className="w-7 h-7" style={{ color: "#3a2a05" }} />
          </div>
          <h3 className="text-white font-black text-xl">Nexus Premium</h3>
          <p className="text-sm mt-1" style={{ color: "#c9b06a" }}>{feature || "Débloquez l'expérience de luxe"}</p>
        </div>

        <div className="px-6 py-5">
          {/* Offres */}
          <div className="flex gap-2.5 mb-5 pt-1">
            <PlanCard id="annual" />
            <PlanCard id="monthly" />
          </div>

          {/* 5 piliers */}
          <ul className="space-y-2.5 mb-5">
            {PERKS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-2.5">
                <span className="mt-0.5 w-5 h-5 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(249,217,118,0.14)" }}>
                  <Icon className="w-3 h-3" style={{ color: "#e8c874" }} />
                </span>
                <span className="text-sm" style={{ color: "#dae2fd" }}>{text}</span>
              </li>
            ))}
          </ul>

          <button onClick={subscribe} disabled={busy}
            className="w-full py-3 rounded-2xl font-black text-sm active:scale-[0.98] transition-transform disabled:opacity-60"
            style={{ background: GOLD, color: "#3a2a05", boxShadow: "0 8px 24px rgba(201,150,44,0.35)" }}>
            {busy ? "Redirection…" : `S'abonner · ${PLANS[plan].price} ${PLANS[plan].per}`}
          </button>
          <button onClick={onClose} disabled={busy}
            className="w-full mt-2 py-2.5 rounded-xl text-sm font-bold disabled:opacity-60" style={{ background: "#1a2234", color: "#a7b3cc" }}>
            Plus tard
          </button>
          <p className="text-[10px] text-center mt-2" style={{ color: "#6b7686" }}>Paiement sécurisé par Stripe · résiliable à tout moment</p>
        </div>
      </div>
    </div>
  );
}
