import { useTranslation } from "react-i18next";
import { getCurrentChallenge } from "@/lib/challenges";
import { useNavigate } from "react-router-dom";

export default function ChallengeBanner({ onUseTag }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ch = getCurrentChallenge();

  return (
    <div
      className="mx-4 mb-3 rounded-2xl p-3 flex items-center gap-3"
      style={{
        background:
          "linear-gradient(135deg,rgba(34,211,238,0.12),rgba(59,130,246,0.1))",
        border: "1px solid rgba(34,211,238,0.25)",
      }}
    >
      <div
        className="w-11 h-11 rounded-2xl flex items-center justify-center text-lg flex-shrink-0"
        style={{ background: "rgba(34,211,238,0.2)" }}
      >
        #
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-white truncate">
          {t(ch.title_key)} · {ch.hashtag}
        </p>
        <p className="text-[11px]" style={{ color: "#859397" }}>
          {t(ch.endsHint)}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          onUseTag?.(ch.hashtag);
          navigate("/nexus-clips");
        }}
        className="px-3 py-1.5 rounded-full text-[11px] font-bold flex-shrink-0"
        style={{
          background: "linear-gradient(90deg,#22d3ee,#3b82f6)",
          color: "#00363e",
        }}
      >
        {t("challenge.join")}
      </button>
    </div>
  );
}
