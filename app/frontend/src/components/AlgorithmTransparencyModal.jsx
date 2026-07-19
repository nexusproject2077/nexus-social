// src/components/AlgorithmTransparencyModal.jsx
// Transparence algorithmique (Digital Services Act, art. 27 & 38).
// Explique les principaux paramètres du système de recommandation et
// comment l'utilisateur peut les influencer, sans jargon.

import React from 'react';
import { X, Sparkles, Clock, TrendingUp, Megaphone, ShieldCheck } from 'lucide-react';

const ACCENT = "var(--nexus-accent)";

// Facteurs du fil « Pour toi », avec leur importance relative indicative.
const FACTORS = [
  { label: "Comptes que vous suivez", weight: 40, desc: "Les publications des personnes que vous suivez sont mises en avant." },
  { label: "Fraîcheur", weight: 25, desc: "Les publications récentes passent avant les plus anciennes." },
  { label: "Engagement", weight: 25, desc: "Les likes et commentaires reçus par une publication augmentent sa visibilité." },
  { label: "Vos centres d'intérêt", weight: 10, desc: "Les hashtags et sujets avec lesquels vous interagissez orientent les suggestions." },
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
              Comment fonctionne l'algorithme
            </h2>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="text-slate-400 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Contenu */}
        <div className="p-5 space-y-5 overflow-y-auto">
          <p className="text-xs leading-relaxed" style={{ color: "#859397" }}>
            Conformément au Digital Services Act (règlement européen sur les services
            numériques), voici les principaux paramètres qui déterminent les contenus
            que vous voyez sur Nexus, et comment les modifier.
          </p>

          {/* Fil Pour toi : facteurs pondérés */}
          <Section icon={Sparkles} title="Fil « Pour toi »">
            <p className="mb-3">
              Ce fil classe les publications selon plusieurs facteurs. Voici leur poids
              relatif approximatif :
            </p>
            <div className="space-y-2.5">
              {FACTORS.map((f) => (
                <div key={f.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-white">{f.label}</span>
                    <span className="text-[10px]" style={{ color: "#859397" }}>{f.weight}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div className="h-full rounded-full" style={{ width: `${f.weight}%`, background: ACCENT }} />
                  </div>
                  <p className="text-[11px] mt-1" style={{ color: "#859397" }}>{f.desc}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Fil chronologique */}
          <Section icon={Clock} title="Fil chronologique (sans algorithme)">
            Vous avez le droit à un fil non personnalisé. L'onglet <b>« Suivis »</b> de
            l'accueil affiche uniquement les publications des comptes que vous suivez,
            dans l'ordre chronologique, sans classement algorithmique.
          </Section>

          {/* Tendances */}
          <Section icon={TrendingUp} title="Tendances">
            Les tendances reflètent les hashtags les plus utilisés au cours des
            <b> dernières 24 heures</b>, pondérés par le nombre de publications et de
            likes. Elles se renouvellent automatiquement : aucun choix éditorial manuel.
          </Section>

          {/* Publicité */}
          <Section icon={Megaphone} title="Publicités">
            Les publicités affichées sont <b>non personnalisées</b> par défaut : elles ne
            reposent pas sur un profilage de votre comportement. Elles ne s'affichent
            qu'après votre consentement aux cookies.
          </Section>

          {/* Ce que nous n'utilisons pas */}
          <Section icon={ShieldCheck} title="Ce que nous n'utilisons pas">
            Aucun profilage fondé sur des données sensibles (opinions politiques,
            religion, orientation, santé). Vous pouvez désactiver les suggestions
            algorithmiques dans <b>Paramètres → Confidentialité</b>.
          </Section>
        </div>

        {/* Footer */}
        <div className="p-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl font-bold text-sm transition-all hover:opacity-90"
            style={{ background: ACCENT, color: "#00363e" }}
          >
            J'ai compris
          </button>
        </div>
      </div>
    </div>
  );
}
