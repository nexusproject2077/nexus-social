import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Gift, Copy, Check, Share2 } from "lucide-react";

// Palette alignée sur le reste de l'app (fond Nexus, accent cyan).
const C = {
  card: "#111a2e",
  high: "#1a2336",
  line: "rgba(255,255,255,0.07)",
  cyan: "#22d3ee",
  onSurface: "#e8eefc",
  onVariant: "#aab6d0",
  outline: "#7c88a3",
  gold: "#f5c451",
};

/**
 * Carte de parrainage — design épuré et premium. Lien ?ref=<username>, partage,
 * et progression vers le prochain mois Premium offert (1 tous les 3 amis).
 * N'affiche rien tant que les données ne sont pas prêtes (pas de flash).
 */
export default function ReferralCard({ user }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    axios
      .get(`${API}/users/me/referrals`)
      .then((r) => alive && setData(r.data))
      .catch(() => {
        if (alive && user?.username)
          setData({
            code: user.username,
            count: user.referral_count || 0,
            per_reward: 3,
            to_next: 3 - ((user.referral_count || 0) % 3),
            rewards_granted: user.referral_rewards || 0,
          });
      });
    return () => {
      alive = false;
    };
  }, [user]);

  if (!data) return null;

  const per = data.per_reward || 3;
  const code = data.code || user?.username || "";
  const link = `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
  const prettyLink = link.replace(/^https?:\/\//, "");
  const inCycle = (data.count || 0) % per; // amis dans le cycle en cours

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success(t("referral.copied"));
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(t("error_occurred"));
    }
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Nexus Social",
          text: t("referral.share_text"),
          url: link,
        });
        return;
      } catch {
        /* annulé → repli copie */
      }
    }
    copy();
  };

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: `radial-gradient(120% 120% at 100% 0%, ${C.cyan}12, ${C.card} 55%)`,
        border: `1px solid ${C.line}`,
      }}
    >
      {/* En-tête */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: `${C.cyan}1f`, color: C.cyan }}
        >
          <Gift className="w-[18px] h-[18px]" />
        </div>
        <div className="min-w-0">
          <h3
            className="text-sm font-bold leading-tight"
            style={{ color: C.onSurface }}
          >
            {t("referral.title")}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: C.outline }}>
            {t("referral.subtitle", { total: per })}
          </p>
        </div>
      </div>

      {/* Lien : chip cliquable (copie) + bouton partager */}
      <div className="flex items-center gap-2">
        <button
          onClick={copy}
          className="flex-1 min-w-0 flex items-center gap-2 px-4 py-2.5 rounded-full text-left transition-colors"
          style={{ background: C.high, border: `1px solid ${C.line}` }}
        >
          <span
            className="flex-1 text-[13px] truncate font-medium"
            style={{ color: C.onVariant }}
            title={link}
          >
            {prettyLink}
          </span>
          {copied ? (
            <Check className="w-4 h-4 flex-shrink-0" style={{ color: C.cyan }} />
          ) : (
            <Copy
              className="w-4 h-4 flex-shrink-0"
              style={{ color: C.outline }}
            />
          )}
        </button>
        <button
          onClick={share}
          className="flex-shrink-0 flex items-center justify-center w-11 h-11 rounded-full active:scale-95 transition-transform"
          style={{
            background: "linear-gradient(135deg,#22d3ee,#3b82f6)",
            color: "#04233a",
          }}
          aria-label={t("referral.share")}
        >
          <Share2 className="w-[18px] h-[18px]" />
        </button>
      </div>

      {/* Progression vers le prochain mois offert */}
      <div className="mt-3.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold" style={{ color: C.onVariant }}>
            {t("referral.invited", { count: data.count || 0 })}
          </span>
          <span className="text-[11px] font-bold" style={{ color: C.cyan }}>
            {t("referral.to_next", { count: data.to_next, total: per })}
          </span>
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: per }).map((_, i) => (
            <span
              key={i}
              className="flex-1 rounded-full transition-colors"
              style={{
                height: 5,
                background:
                  i < inCycle
                    ? "linear-gradient(90deg,#22d3ee,#3b82f6)"
                    : C.high,
              }}
            />
          ))}
        </div>
      </div>

      {/* Récompenses gagnées (discret, doré) */}
      {data.rewards_granted > 0 && (
        <p
          className="text-[11px] font-semibold mt-2.5 flex items-center gap-1.5"
          style={{ color: C.gold }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: C.gold }}
          />
          {t("referral.rewards", { count: data.rewards_granted })}
          {data.premium_until
            ? " · " +
              t("referral.premium_until", {
                date: (() => {
                  try {
                    return new Date(data.premium_until).toLocaleDateString(
                      i18n.language || "fr",
                      { day: "numeric", month: "long", year: "numeric" },
                    );
                  } catch {
                    return "";
                  }
                })(),
              })
            : ""}
        </p>
      )}
    </div>
  );
}
