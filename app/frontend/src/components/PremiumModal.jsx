// Modale de vente « Nexus Premium » (paywall réutilisable).
// Ouverte quand un utilisateur gratuit tente une fonctionnalité de luxe
// (couleurs dégradées, widgets exclusifs, liens multiples…). Le CTA renvoie
// vers /premium, page qui gère le paiement Stripe (source unique de vérité).
import { useNavigate } from "react-router-dom";
import { Crown, Check } from "lucide-react";

const PERKS = [
  "Widgets exclusifs (Visites, AI Analytics, Astro)",
  "Thèmes de couleurs dégradés de luxe",
  "Plus de portée pour vos publications",
  "Vitrine de créateur (liens multiples)",
  "Badge Premium doré sur votre profil",
];

export default function PremiumModal({ open, onClose, feature }) {
  const navigate = useNavigate();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center sm:p-4"
      style={{ background: "rgba(2,6,20,0.86)", backdropFilter: "blur(4px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{ background: "#0d1424", border: "1px solid rgba(255,255,255,0.1)", animation: "clipSheetUp 0.28s cubic-bezier(0.22,1,0.36,1)" }}>
        {/* Bandeau doré */}
        <div className="px-6 pt-7 pb-6 text-center relative"
          style={{ background: "linear-gradient(135deg,#1a1405,#0d1424)" }}>
          <div className="mx-auto mb-3 w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg,#f9d976,#c8962c)", boxShadow: "0 8px 24px rgba(201,150,44,0.4)" }}>
            <Crown className="w-7 h-7" style={{ color: "#3a2a05" }} />
          </div>
          <h3 className="text-white font-black text-xl">Nexus Premium</h3>
          <p className="text-sm mt-1" style={{ color: "#c9b06a" }}>
            {feature || "Débloquez l'expérience de luxe"}
          </p>
        </div>

        <div className="px-6 py-5">
          <ul className="space-y-2.5 mb-5">
            {PERKS.map((p) => (
              <li key={p} className="flex items-start gap-2.5">
                <span className="mt-0.5 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "linear-gradient(135deg,#f9d976,#c8962c)" }}>
                  <Check className="w-2.5 h-2.5" style={{ color: "#3a2a05" }} strokeWidth={3.5} />
                </span>
                <span className="text-sm" style={{ color: "#dae2fd" }}>{p}</span>
              </li>
            ))}
          </ul>
          <button onClick={() => { onClose?.(); navigate("/premium"); }}
            className="w-full py-3 rounded-2xl font-black text-sm active:scale-[0.98] transition-transform"
            style={{ background: "linear-gradient(135deg,#f9d976,#c8962c)", color: "#3a2a05", boxShadow: "0 8px 24px rgba(201,150,44,0.35)" }}>
            Passer à Nexus Premium
          </button>
          <button onClick={onClose}
            className="w-full mt-2 py-2.5 rounded-xl text-sm font-bold" style={{ background: "#1a2234", color: "#a7b3cc" }}>
            Plus tard
          </button>
        </div>
      </div>
    </div>
  );
}
