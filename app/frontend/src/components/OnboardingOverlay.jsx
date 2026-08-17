// OnboardingOverlay.jsx — Première expérience utilisateur, légère et sautable.
// Présente rapidement les points forts de Nexus (confidentialité, Clips,
// messages, pourboires) en quelques slides. Affiché UNE seule fois (drapeau
// localStorage), puis plus jamais. Bottom-sheet sur mobile, centré sur PC.

import { useState, useEffect } from "react";

const STORAGE_KEY = "nexus_onboarding_v1_done";

const SLIDES = [
  {
    icon: "waving_hand",
    title: "Bienvenue sur Nexus",
    text: "Ton réseau social tout-en-un : publications, vidéos courtes, messages et soutien aux créateurs — au même endroit.",
  },
  {
    icon: "shield",
    title: "Ta vie privée d'abord",
    text: "Active le Mode Confidentialité stricte en un clic : compte privé, aucun suivi. Tu gardes le contrôle de tes données.",
  },
  {
    icon: "play_circle",
    title: "Nexus Clips",
    text: "Des vidéos courtes en plein écran, façon TikTok. Publie, scrolle, découvre — l'onglet Clips en bas.",
  },
  {
    icon: "volunteer_activism",
    title: "Messages & pourboires",
    text: "Discute en temps réel (photos, vidéos, vocaux) et soutiens tes créateurs préférés avec un pourboire.",
  },
];

export default function OnboardingOverlay() {
  const [show, setShow] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    try {
      // `nexus_show_onboarding` est posé juste après une INSCRIPTION → le guide
      // s'affiche à coup sûr pour les nouveaux comptes, même si l'appareil a déjà
      // vu le guide. Sinon, 1re fois seulement (drapeau « déjà vu » absent).
      const forced = localStorage.getItem("nexus_show_onboarding") === "1";
      if (forced || !localStorage.getItem(STORAGE_KEY)) setShow(true);
    } catch { /* localStorage indisponible → on n'affiche rien */ }
  }, []);

  const finish = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
      localStorage.removeItem("nexus_show_onboarding");
    } catch { /* ignore */ }
    setShow(false);
  };

  if (!show) return null;
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(2,6,23,0.78)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) finish(); }}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden"
        style={{
          background: "#0f172a",
          border: "1px solid rgba(255,255,255,0.08)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div className="p-6 sm:p-8 text-center">
          <div
            className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-5"
            style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)" }}
          >
            <span className="material-symbols-outlined text-white" style={{ fontSize: 32 }}>{s.icon}</span>
          </div>
          <h2 className="text-xl font-black text-white mb-2" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
            {s.title}
          </h2>
          <p className="text-sm text-slate-300 leading-relaxed max-w-xs mx-auto">{s.text}</p>

          {/* Indicateurs de progression */}
          <div className="flex justify-center gap-1.5 mt-6">
            {SLIDES.map((_, k) => (
              <span
                key={k}
                className="h-1.5 rounded-full transition-all"
                style={{ width: k === i ? 20 : 6, background: k === i ? "#22d3ee" : "rgba(255,255,255,0.2)" }}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 pb-6 pt-1">
          <button onClick={finish} className="text-xs font-bold text-slate-400 px-3 py-2 hover:text-slate-200 transition-colors">
            Passer
          </button>
          <div className="flex items-center gap-2">
            {i > 0 && (
              <button
                onClick={() => setI(i - 1)}
                className="px-3 py-2.5 rounded-xl text-sm font-bold text-slate-300 transition-all hover:bg-white/5"
              >
                Retour
              </button>
            )}
            <button
              onClick={() => (last ? finish() : setI(i + 1))}
              className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
              style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: "#04121f" }}
            >
              {last ? "Commencer 🚀" : "Suivant"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
