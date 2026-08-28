// Paramètres des notifications — active/désactive chaque type (spec Instagram).
import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import { getPushState, enablePush, disablePush } from "@/lib/push";
import i18n from "@/i18n";

const ACCENT =
  (typeof window !== "undefined" &&
    window.localStorage.getItem("nexus_accent")) ||
  "#22d3ee";

// Regroupé par catégorie pour une UI lisible.
const GROUPS = [
  { gkey: "messages", items: [{ key: "message" }] },
  {
    gkey: "interactions",
    items: [
      { key: "like" },
      { key: "comment" },
      { key: "comment_reply" },
      { key: "mention" },
      { key: "tag" },
    ],
  },
  {
    gkey: "follows",
    items: [
      { key: "follow" },
      { key: "follow_request" },
      { key: "follow_accepted" },
    ],
  },
  {
    gkey: "stories",
    items: [
      { key: "story_reply" },
      { key: "story_reaction" },
      { key: "instant" },
      { key: "instant_reaction" },
    ],
  },
  {
    gkey: "live",
    items: [{ key: "live" }, { key: "trending" }, { key: "security" }],
  },
];

function Toggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className="w-11 h-6 rounded-full flex-shrink-0 transition-colors relative"
      style={{ background: on ? ACCENT : "#31394d" }}
      aria-pressed={on}
    >
      <span
        className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
        style={{ left: on ? 22 : 2 }}
      />
    </button>
  );
}

export default function NotificationSettings({ onClose }) {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);
  const [push, setPush] = useState(null); // état Web Push (support/permission/abonnement)
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    axios
      .get(`${API}/notifications/preferences`)
      .then((r) => setPrefs(r.data || {}))
      .catch(() => setPrefs({}));
    getPushState()
      .then(setPush)
      .catch(() => setPush({ supported: false }));
  }, []);

  const togglePush = async () => {
    if (pushBusy || !push) return;
    setPushBusy(true);
    try {
      if (push.subscribed) {
        await disablePush();
        toast.success(i18n.t("notifsettings.push_disabled"));
      } else {
        const res = await enablePush();
        if (!res.ok) {
          const msg =
            {
              "ios-install": i18n.t("notifsettings.reason_ios_install"),
              denied: i18n.t("notifsettings.reason_denied"),
              unsupported: i18n.t("notifsettings.reason_unsupported"),
              "no-key": i18n.t("notifsettings.reason_no_key"),
              "subscribe-failed": i18n.t(
                "notifsettings.reason_subscribe_failed",
              ),
              "backend-failed": i18n.t("notifsettings.reason_backend_failed"),
              "no-sw": i18n.t("notifsettings.reason_no_sw"),
            }[res.reason] || i18n.t("notifsettings.reason_default");
          toast.error(msg);
        } else {
          toast.success(i18n.t("notifsettings.push_enabled"));
        }
      }
    } finally {
      const st = await getPushState().catch(() => null);
      if (st) setPush(st);
      setPushBusy(false);
    }
  };

  const toggle = (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaving(true);
    axios
      .put(`${API}/notifications/preferences`, { prefs: next })
      .catch(() => toast.error(i18n.t("notifsettings.err_save")))
      .finally(() => setSaving(false));
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-4 pb-6 max-h-[85vh] overflow-y-auto"
        style={{
          background: "#0b1326",
          paddingBottom: "max(env(safe-area-inset-bottom), 20px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="w-10 h-1.5 rounded-full mx-auto mb-4 sm:hidden"
          style={{ background: "#222a3d" }}
        />
        <div className="flex items-center justify-between mb-4 px-1">
          <h3 className="font-black text-lg" style={{ color: "#dae2fd" }}>
            {i18n.t("notifsettings.title")}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/5"
          >
            <span
              className="material-symbols-outlined"
              style={{ color: "#dae2fd" }}
            >
              close
            </span>
          </button>
        </div>

        {/* Web Push : notifications même quand l'app est fermée. */}
        {push && (
          <div className="mb-5">
            <p
              className="text-[11px] font-bold uppercase tracking-widest mb-2 px-1"
              style={{ color: "#859397" }}
            >
              {i18n.t("notifsettings.push_hdr")}
            </p>
            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: "#171f33" }}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: "#dae2fd" }}>
                    {i18n.t("notifsettings.push_device")}
                  </p>
                  <p
                    className="text-[11px] mt-0.5"
                    style={{ color: "#5b6b8c" }}
                  >
                    {i18n.t("notifsettings.push_sub")}
                  </p>
                </div>
                {!push.supported ? (
                  <span
                    className="text-[11px] flex-shrink-0"
                    style={{ color: "#5b6b8c" }}
                  >
                    {i18n.t("notifsettings.push_unsupported")}
                  </span>
                ) : pushBusy ? (
                  <div
                    className="animate-spin rounded-full h-5 w-5 border-b-2 flex-shrink-0"
                    style={{ borderColor: ACCENT }}
                  />
                ) : (
                  <Toggle on={!!push.subscribed} onChange={togglePush} />
                )}
              </div>
              {push.supported && push.ios && !push.standalone && (
                <div
                  className="px-4 py-3"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <p className="text-[11px]" style={{ color: "#f0b429" }}>
                    {i18n.t("notifsettings.ios_hint")}
                  </p>
                </div>
              )}
              {push.supported && push.permission === "denied" && (
                <div
                  className="px-4 py-3"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <p className="text-[11px]" style={{ color: "#f0b429" }}>
                    {i18n.t("notifsettings.denied_hint")}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {!prefs ? (
          <div className="flex justify-center py-10">
            <div
              className="animate-spin rounded-full h-8 w-8 border-b-2"
              style={{ borderColor: ACCENT }}
            />
          </div>
        ) : (
          GROUPS.map((g) => (
            <div key={g.gkey} className="mb-5">
              <p
                className="text-[11px] font-bold uppercase tracking-widest mb-2 px-1"
                style={{ color: "#859397" }}
              >
                {i18n.t("notifsettings.group_" + g.gkey)}
              </p>
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: "#171f33" }}
              >
                {g.items.map((it, i) => (
                  <div
                    key={it.key}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{
                      borderTop: i
                        ? "1px solid rgba(255,255,255,0.05)"
                        : "none",
                    }}
                  >
                    <span
                      className="flex-1 text-sm"
                      style={{ color: "#dae2fd" }}
                    >
                      {i18n.t("notifsettings.item_" + it.key)}
                    </span>
                    <Toggle
                      on={prefs[it.key] !== false}
                      onChange={(v) => toggle(it.key, v)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
        <p
          className="text-center text-[11px] mt-1"
          style={{ color: "#5b6b8c" }}
        >
          {saving
            ? i18n.t("notifsettings.saving")
            : i18n.t("notifsettings.auto_saved")}
        </p>
      </div>
    </div>
  );
}
