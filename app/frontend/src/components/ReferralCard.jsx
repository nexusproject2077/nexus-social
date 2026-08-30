import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Gift, Copy, Share2, Users, Crown, Check } from "lucide-react";

const C = {
  container: "#131b2e",
  high: "#222a3d",
  outlineVar: "#3c494c",
  onSurface: "#dae2fd",
  onVariant: "#bbc9cd",
  outline: "#859397",
  cyan: "#22d3ee",
  gold: "#f9d976",
};

// Carte de parrainage : lien unique ?ref=<username>, compteur de filleuls et
// progression vers le prochain mois Premium offert (1 mois tous les 3 amis).
export default function ReferralCard({ user }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    axios
      .get(`${API}/users/me/referrals`)
      .then((r) => alive && setData(r.data))
      .catch(() => {
        // Repli : on sait déjà construire le lien à partir du username courant.
        if (alive && user?.username)
          setData({
            code: user.username,
            count: user.referral_count || 0,
            rewards_granted: user.referral_rewards || 0,
            per_reward: 3,
            to_next: 3 - ((user.referral_count || 0) % 3),
            is_premium: !!user.is_premium,
            premium_until: user.premium_until || null,
          });
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [user]);

  if (loading || !data) return null;

  const per = data.per_reward || 3;
  const code = data.code || user?.username || "";
  const link = `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
  const inCycle = (data.count || 0) % per; // amis dans le cycle en cours (0..per-1)
  const shareText = t("referral.share_text");

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
        await navigator.share({ title: "Nexus Social", text: shareText, url: link });
        return;
      } catch {
        /* annulé → on retombe sur la copie */
      }
    }
    copy();
  };

  const fmtDate = (iso) => {
    try {
      return new Date(iso).toLocaleDateString(i18n.language || "en", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    } catch {
      return "";
    }
  };

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: `linear-gradient(160deg, ${C.cyan}14, ${C.container} 60%)`,
        border: `1px solid ${C.outlineVar}`,
      }}
    >
      {/* En-tête */}
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${C.cyan}22`, color: C.cyan }}
        >
          <Gift className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold" style={{ color: C.onSurface }}>
            {t("referral.title")}
          </h3>
          <p className="text-xs mt-0.5" style={{ color: C.outline }}>
            {t("referral.subtitle", { total: per })}
          </p>
        </div>
      </div>

      {/* Lien d'invitation */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3"
        style={{ background: C.high, border: `1px solid ${C.outlineVar}` }}
      >
        <span
          className="flex-1 text-xs truncate"
          style={{ color: C.onVariant }}
          title={link}
        >
          {link.replace(/^https?:\/\//, "")}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold transition-all active:scale-95"
          style={{ background: `${C.cyan}1f`, color: C.cyan }}
          aria-label={t("referral.copy")}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? t("referral.copied") : t("referral.copy")}
        </button>
        <button
          onClick={share}
          className="flex items-center justify-center w-7 h-7 rounded-lg transition-all active:scale-95"
          style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: "#00363e" }}
          aria-label={t("referral.share")}
        >
          <Share2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Progression vers le prochain mois offert */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: C.onVariant }}>
            <Users className="w-3.5 h-3.5" style={{ color: C.cyan }} />
            {t("referral.invited", { count: data.count || 0 })}
          </span>
          <span className="text-[11px] font-bold" style={{ color: C.cyan }}>
            {t("referral.to_next", { count: data.to_next, total: per })}
          </span>
        </div>
        {/* Barre de progression segmentée (per segments) */}
        <div className="flex gap-1">
          {Array.from({ length: per }).map((_, i) => (
            <span
              key={i}
              className="flex-1 h-1.5 rounded-full transition-colors"
              style={{ background: i < inCycle ? C.cyan : C.high }}
            />
          ))}
        </div>
      </div>

      {/* Récompenses gagnées / Premium actif */}
      {(data.rewards_granted > 0 || data.is_premium) && (
        <div
          className="flex items-center gap-2 mt-3 px-3 py-2 rounded-xl"
          style={{ background: `${C.gold}14`, border: `1px solid ${C.gold}33` }}
        >
          <Crown className="w-4 h-4 flex-shrink-0" style={{ color: C.gold }} />
          <span className="text-[11px] font-semibold" style={{ color: C.onVariant }}>
            {data.rewards_granted > 0
              ? t("referral.rewards", { count: data.rewards_granted })
              : t("referral.premium_on")}
            {data.premium_until ? " · " + t("referral.premium_until", { date: fmtDate(data.premium_until) }) : ""}
          </span>
        </div>
      )}
    </div>
  );
}
