import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "../App";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// Page PUBLIQUE « Devenir Premium » : accessible SANS connexion (les produits et
// tarifs doivent être visibles publiquement — exigence des processeurs de
// paiement). On liste honnêtement ce qui est ACTIF aujourd'hui et ce qui arrive.
const ACCENT = "#22d3ee";

// « live: true » = avantage réellement fonctionnel aujourd'hui.
// « live: false » = prévu / en cours de déploiement (affiché « Bientôt »).
const USER_PERKS = [
  { icon: "verified", label: t("premium_badge"), live: true },
  { icon: "block", label: t("ad_free"), live: true },
  { icon: "trending_up", label: t("for_you_priority"), live: true },
  { icon: "schedule", label: t("stories_48h"), live: true },
  { icon: "hd", label: "Upload vidéo 4K", live: false },
  { icon: "cloud_done", label: t("extended_storage"), live: false },
  { icon: "palette", label: t("exclusive_themes"), live: false },
  { icon: "download_for_offline", label: t("offline_playback"), live: false },
  { icon: "rocket_launch", label: t("early_access"), live: false },
];

const CREATOR_PERKS = [
  { icon: "push_pin", label: t("pin_post"), live: true },
  { icon: "analytics", label: t("advanced_analytics"), live: false },
  { icon: "payments", label: t("monetization_features"), live: false },
  { icon: "campaign", label: t("rec_priority"), live: false },
  {
    icon: "auto_fix_high",
    label: "Outils d'édition vidéo/photo plus poussés",
    live: false,
  },
  {
    icon: "shield",
    label: "Anti-spam renforcé + modération prioritaire",
    live: false,
  },
];

export default function PremiumPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(false);

  // Utilisateur courant (facultatif : la page marche déconnecté).
  let user = null;
  try {
    user = JSON.parse(localStorage.getItem("nexus_user") || "null");
  } catch {
    /* ignore */
  }
  const isLoggedIn =
    !!localStorage.getItem("token") || !!localStorage.getItem("nexus_token");
  const alreadyPremium = !!user?.is_premium;

  useEffect(() => {
    axios
      .get(`${API}/billing/plan`)
      .then((r) => setPlan(r.data))
      .catch(() => setPlan({ enabled: false }));
  }, []);

  const priceLabel = () => {
    if (!plan) return "…";
    if (plan.amount != null) {
      const per = plan.interval === "year" ? "an" : "mois";
      return `${plan.amount.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} ${plan.currency || "EUR"} / ${per}`;
    }
    // Paiement actif mais prix non lisible (ex. backend en cours de déploiement) :
    // on n'affiche pas « bientôt » — le tarif est confirmé à l'étape Stripe.
    if (plan.enabled) return "Voir le tarif à l'étape suivante";
    return "Tarif bientôt disponible";
  };

  const subscribe = async () => {
    if (!isLoggedIn) {
      navigate("/auth");
      return;
    }
    if (!plan?.enabled) {
      toast("Les paiements arrivent très bientôt 🙌");
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post(`${API}/billing/create-checkout-session`);
      if (res.data?.url) window.location.href = res.data.url;
    } catch (e) {
      toast.error(
        e.response?.data?.detail || "Paiement momentanément indisponible",
      );
    } finally {
      setLoading(false);
    }
  };

  const PerkList = ({ title, perks }) => (
    <div>
      <h3
        className="text-sm font-bold uppercase tracking-wide mb-3"
        style={{ color: ACCENT }}
      >
        {title}
      </h3>
      <ul className="space-y-2.5">
        {perks.map((p, i) => (
          <li key={i} className="flex items-start gap-3">
            <span
              className="material-symbols-outlined text-xl mt-0.5"
              style={{ color: p.live ? ACCENT : "#5b6b8c" }}
            >
              {p.icon}
            </span>
            <span
              className="text-sm leading-snug"
              style={{ color: p.live ? "#dae2fd" : "#8ea0c4" }}
            >
              {p.label}
              {!p.live && (
                <span
                  className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle"
                  style={{
                    background: "rgba(255,255,255,0.08)",
                    color: "#8ea0c4",
                  }}
                >
                  BIENTÔT
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div
      className="min-h-screen"
      style={{ background: "#0b1326", color: "#dae2fd" }}
    >
      {/* Barre supérieure */}
      <header
        className="flex items-center gap-3 px-4 h-14 border-b"
        style={{ borderColor: "rgba(255,255,255,0.06)" }}
      >
        <button
          onClick={() => navigate(isLoggedIn ? "/feed" : "/auth")}
          className="w-9 h-9 -ml-1 flex items-center justify-center rounded-full hover:bg-white/5"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <span className="font-bold">Nexus Premium</span>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        {/* Héro */}
        <div className="text-center mb-10">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-4 text-sm font-bold"
            style={{
              background: "linear-gradient(135deg,#22d3ee22,#3b82f622)",
              border: "1px solid rgba(34,211,238,0.3)",
              color: ACCENT,
            }}
          >
            <span
              className="material-symbols-outlined text-lg"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              workspace_premium
            </span>
            Nexus Premium
          </div>
          <h1
            className="text-3xl sm:text-4xl font-black mb-3"
            style={{ fontFamily: "Space Grotesk, sans-serif" }}
          >
            Passe au niveau supérieur
          </h1>
          <p className="text-base sm:text-lg mb-6" style={{ color: "#bbc9cd" }}>
            Une expérience sans publicité, des outils créateurs, et des
            avantages exclusifs.
          </p>
          <p className="text-2xl font-black mb-6" style={{ color: ACCENT }}>
            {priceLabel()}
          </p>

          {alreadyPremium ? (
            <div
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-bold"
              style={{ background: "rgba(34,211,238,0.15)", color: ACCENT }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                verified
              </span>
              Vous êtes déjà Premium — merci !
            </div>
          ) : (
            <button
              onClick={subscribe}
              disabled={loading}
              className="px-8 py-3.5 rounded-2xl font-black text-base transition-all active:scale-95 disabled:opacity-60"
              style={{
                background: "linear-gradient(135deg,#22d3ee,#3b82f6)",
                color: "#00363e",
              }}
            >
              {loading
                ? "Redirection…"
                : isLoggedIn
                  ? "Devenir Premium"
                  : "Se connecter pour s'abonner"}
            </button>
          )}
          {!alreadyPremium && plan && !plan.enabled && (
            <p className="text-xs mt-3" style={{ color: "#8ea0c4" }}>
              Le paiement en ligne sera activé très prochainement.
            </p>
          )}
        </div>

        {/* Avantages */}
        <div
          className="grid sm:grid-cols-2 gap-8 rounded-3xl p-6 sm:p-8"
          style={{
            background: "#171f33",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <PerkList title="Abonnement utilisateur" perks={USER_PERKS} />
          <PerkList title="Outils créateur" perks={CREATOR_PERKS} />
        </div>

        <p className="text-center text-xs mt-6" style={{ color: "#8ea0c4" }}>
          Les avantages marqués « Bientôt » sont en cours de déploiement et
          s'activeront automatiquement pour les membres Premium. Résiliation
          possible à tout moment depuis les paramètres.
        </p>

        {/* Liens légaux officiels (pages existantes servies par le backend). */}
        <div
          className="flex items-center justify-center gap-4 mt-6 text-xs flex-wrap"
          style={{ color: "#8ea0c4" }}
        >
          <a
            href={`${API}/legal/terms-of-service`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Conditions d'utilisation
          </a>
          <span>·</span>
          <a
            href={`${API}/legal/privacy-policy`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            {t("privacy")}
          </a>
          <span>·</span>
          <button
            onClick={() => navigate("/settings")}
            className="hover:underline"
          >
            Gérer l'abonnement
          </button>
        </div>
      </div>
    </div>
  );
}
