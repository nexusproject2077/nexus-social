import { useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const DEFAULTS = {
  match_reminders: true,
  comment_replies: true,
  new_followers: true,
  likes_digest: false,
  marketing: false,
};

export default function SmartNotifCard({ user }) {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState(() => ({
    ...DEFAULTS,
    ...(user?.smart_notif_prefs || {}),
  }));
  const [saving, setSaving] = useState(false);

  const toggle = async (key) => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSaving(true);
    try {
      await axios.put(`${API}/users/me/smart-notif-prefs`, next);
      toast.success(t("smart_notif.saved"));
    } catch {
      try {
        await axios.put(`${API}/users/me/preferences`, {
          smart_notif_prefs: next,
        });
        toast.success(t("smart_notif.saved"));
      } catch {
        toast.message(t("smart_notif.local"));
        localStorage.setItem("nexus_smart_notif", JSON.stringify(next));
      }
    } finally {
      setSaving(false);
    }
  };

  const rows = [
    { key: "match_reminders", label: t("smart_notif.match") },
    { key: "comment_replies", label: t("smart_notif.comments") },
    { key: "new_followers", label: t("smart_notif.followers") },
    { key: "likes_digest", label: t("smart_notif.likes_digest") },
    { key: "marketing", label: t("smart_notif.marketing") },
  ];

  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "#131b2e",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <h3 className="text-sm font-bold text-white mb-1">
        {t("smart_notif.title")}
      </h3>
      <p className="text-[11px] mb-3" style={{ color: "#859397" }}>
        {t("smart_notif.sub")}
      </p>
      <div className="space-y-2">
        {rows.map((r) => (
          <button
            key={r.key}
            type="button"
            disabled={saving}
            onClick={() => toggle(r.key)}
            className="w-full flex items-center justify-between py-2.5 px-2 rounded-xl"
            style={{ background: "rgba(255,255,255,0.03)" }}
          >
            <span className="text-[13px] text-white text-left">{r.label}</span>
            <span
              className="w-10 h-6 rounded-full relative transition-colors"
              style={{
                background: prefs[r.key] ? "#22d3ee" : "rgba(255,255,255,0.15)",
              }}
            >
              <span
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                style={{ left: prefs[r.key] ? 18 : 2 }}
              />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
