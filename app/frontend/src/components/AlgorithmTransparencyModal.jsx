// src/components/AlgorithmTransparencyModal.jsx
// Transparence algorithmique (Digital Services Act, art. 27 & 38).
// Explique les principaux paramètres du système de recommandation et
// comment l'utilisateur peut les influencer, sans jargon.

import React from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { X, Sparkles, Clock, TrendingUp, Megaphone, ShieldCheck } from 'lucide-react';

const ACCENT = "var(--nexus-accent)";

// Facteurs du fil « Pour toi », avec leur importance relative indicative.
const FACTORS = [
  { k: "follow", weight: 40 },
  { k: "fresh", weight: 25 },
  { k: "engage", weight: 25 },
  { k: "interests", weight: 10 },
];

function Section({ icon: Icon, title, children }) {
  return (
    <div className="flex gap-3">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
           style={{ background: "rgba(255,255,255,0.05)" }}>
        <Icon className="h-4 w-4" style={{ color: ACCENT }} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-bold text-white mb-1">{title}</h3>
        <div className="text-xs leading-relaxed" style={{ color: "#bbc9cd" }}>{children}</div>
      </div>
    </div>
  );
}

export default function AlgorithmTransparencyModal({ onClose }) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{ background: "#131b2e", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" style={{ color: ACCENT }} />
            <h2 className="text-lg font-black text-white" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
              {t("algotransparency.title")}
            </h2>
          </div>
          <button onClick={onClose} aria-label={t("algotransparency.close")} className="text-slate-400 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Contenu */}
        <div className="p-5 space-y-5 overflow-y-auto">
          <p className="text-xs leading-relaxed" style={{ color: "#859397" }}>
            {t("algotransparency.intro")}
          </p>

          {/* Fil Pour toi : facteurs pondérés */}
          <Section icon={Sparkles} title={t("algotransparency.foryou_title")}>
            <p className="mb-3">
              {t("algotransparency.foryou_p")}
            </p>
            <div className="space-y-2.5">
              {FACTORS.map((f) => (
                <div key={f.k}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-white">{t("algotransparency.f_"+f.k+"_label")}</span>
                    <span className="text-[10px]" style={{ color: "#859397" }}>{f.weight}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div className="h-full rounded-full" style={{ width: `${f.weight}%`, background: ACCENT }} />
                  </div>
                  <p className="text-[11px] mt-1" style={{ color: "#859397" }}>{t("algotransparency.f_"+f.k+"_desc")}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Fil chronologique */}
          <Section icon={Clock} title={t("algotransparency.chrono_title")}>
            <Trans i18nKey="algotransparency.chrono_body" components={{ b: <b /> }} />
          </Section>

          {/* Tendances */}
          <Section icon={TrendingUp} title={t("algotransparency.trends_title")}>
            <Trans i18nKey="algotransparency.trends_body" components={{ b: <b /> }} />
          </Section>

          {/* Publicité */}
          <Section icon={Megaphone} title={t("algotransparency.ads_title")}>
            <Trans i18nKey="algotransparency.ads_body" components={{ b: <b /> }} />
          </Section>

          {/* Ce que nous n'utilisons pas */}
          <Section icon={ShieldCheck} title={t("algotransparency.notuse_title")}>
            <Trans i18nKey="algotransparency.notuse_body" components={{ b: <b /> }} />
          </Section>
        </div>

        {/* Footer */}
        <div className="p-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl font-bold text-sm transition-all hover:opacity-90"
            style={{ background: ACCENT, color: "#00363e" }}
          >
            {t("algotransparency.understood")}
          </button>
        </div>
      </div>
    </div>
  );
}
