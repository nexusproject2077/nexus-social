// Paramètres des notifications — active/désactive chaque type (spec Instagram).
import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";

const ACCENT = (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee";

// Regroupé par catégorie pour une UI lisible.
const GROUPS = [
  {
    title: "Messages",
    items: [{ key: "message", label: "Messages privés & de groupe" }],
  },
  {
    title: "Interactions",
    items: [
      { key: "like", label: "J'aime (posts, clips, stories)" },
      { key: "comment", label: "Commentaires" },
      { key: "comment_reply", label: "Réponses à un commentaire" },
      { key: "mention", label: "Mentions (@)" },
      { key: "tag", label: "Identifications (tags)" },
    ],
  },
  {
    title: "Abonnements",
    items: [
      { key: "follow", label: "Nouvel abonné" },
      { key: "follow_request", label: "Demande d'abonnement" },
      { key: "follow_accepted", label: "Abonnement accepté" },
    ],
  },
  {
    title: "Stories & Instantanés",
    items: [
      { key: "story_reply", label: "Réponse à ta story" },
      { key: "story_reaction", label: "Réaction sur ta story" },
      { key: "instant", label: "Instantané reçu" },
      { key: "instant_reaction", label: "Réaction sur ton instantané" },
    ],
  },
  {
    title: "Live & Divers",
    items: [
      { key: "live", label: "Un compte suivi est en live" },
      { key: "trending", label: "Post dans les tendances" },
      { key: "security", label: "Sécurité (connexion inhabituelle)" },
    ],
  },
];

function Toggle({ on, onChange }) {
  return (
    <button onClick={() => onChange(!on)} className="w-11 h-6 rounded-full flex-shrink-0 transition-colors relative"
      style={{ background: on ? ACCENT : "#31394d" }} aria-pressed={on}>
      <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all" style={{ left: on ? 22 : 2 }} />
    </button>
  );
}

export default function NotificationSettings({ onClose }) {
  const [prefs, setPrefs] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get(`${API}/notifications/preferences`).then((r) => setPrefs(r.data || {})).catch(() => setPrefs({}));
  }, []);

  const toggle = (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaving(true);
    axios.put(`${API}/notifications/preferences`, { prefs: next })
      .catch(() => toast.error("Échec de l'enregistrement"))
      .finally(() => setSaving(false));
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose}>
      <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-4 pb-6 max-h-[85vh] overflow-y-auto"
        style={{ background: "#0b1326", paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }} onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1.5 rounded-full mx-auto mb-4 sm:hidden" style={{ background: "#222a3d" }} />
        <div className="flex items-center justify-between mb-4 px-1">
          <h3 className="font-black text-lg" style={{ color: "#dae2fd" }}>Notifications</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/5">
            <span className="material-symbols-outlined" style={{ color: "#dae2fd" }}>close</span>
          </button>
        </div>

        {!prefs ? (
          <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: ACCENT }} /></div>
        ) : (
          GROUPS.map((g) => (
            <div key={g.title} className="mb-5">
              <p className="text-[11px] font-bold uppercase tracking-widest mb-2 px-1" style={{ color: "#859397" }}>{g.title}</p>
              <div className="rounded-2xl overflow-hidden" style={{ background: "#171f33" }}>
                {g.items.map((it, i) => (
                  <div key={it.key} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: i ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                    <span className="flex-1 text-sm" style={{ color: "#dae2fd" }}>{it.label}</span>
                    <Toggle on={prefs[it.key] !== false} onChange={(v) => toggle(it.key, v)} />
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
        <p className="text-center text-[11px] mt-1" style={{ color: "#5b6b8c" }}>
          {saving ? "Enregistrement…" : "Les changements sont enregistrés automatiquement."}
        </p>
      </div>
    </div>
  );
}
