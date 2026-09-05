import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

// Écran de publication d'un Clip — façon TikTok, intégré au design Nexus.
// Aperçu vidéo + légende + audience + restriction UE, puis Publier.
// Palette Nexus (fond bleu nuit, accent cyan), coins arrondis, icônes SVG.
const C = {
  surface: "#0b1326",
  low: "#131b2e",
  high: "#222a3d",
  cyan: "#22d3ee",
  onCyan: "#00363e",
  text: "#dae2fd",
  variant: "#bbc9cd",
  outline: "#859397",
  outlineVar: "#3c494c",
};

const MAX_CAPTION = 2200;

// ── Icônes SVG (aucun emoji) ─────────────────────────────────────────────
const IconBack = (p) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const IconGlobe = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
    <path d="M3 12h18M12 3c2.5 2.4 2.5 15.6 0 18M12 3c-2.5 2.4-2.5 15.6 0 18" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);
const IconFriends = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}>
    <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M16 5.5a3.2 3.2 0 0 1 0 6M17.5 19a5.5 5.5 0 0 0-3-4.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const IconLock = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.3" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 10.5V8a4 4 0 1 1 8 0v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);
const IconShieldEU = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...p}>
    <path d="M12 3l7 2.5v5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5v-5L12 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M15 9.5a3.4 3.4 0 1 0 0 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M8.7 12h3.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
const IconSpark = (p) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M12 2.6l1.9 5.1 5.1 1.9-5.1 1.9L12 16.6l-1.9-5.1L5 9.6l5.1-1.9L12 2.6z" />
  </svg>
);

function Segment({ active, icon, label, desc, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all active:scale-[0.99]"
      style={{
        background: active ? `${C.cyan}14` : C.low,
        border: `1px solid ${active ? C.cyan : C.outlineVar}`,
      }}
    >
      <span
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: active ? C.cyan : C.high, color: active ? C.onCyan : C.variant }}
      >
        {icon}
      </span>
      <span className="flex-1 text-left min-w-0">
        <span className="block text-sm font-bold" style={{ color: C.text }}>{label}</span>
        <span className="block text-[11px]" style={{ color: C.outline }}>{desc}</span>
      </span>
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ border: `2px solid ${active ? C.cyan : C.outlineVar}` }}
      >
        {active && <span className="w-2.5 h-2.5 rounded-full" style={{ background: C.cyan }} />}
      </span>
    </button>
  );
}

export default function ClipPublishScreen({ previewUrl, uploading, progress, onClose, onPublish }) {
  const { t } = useTranslation();
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [euBlocked, setEuBlocked] = useState(false);
  const taRef = useRef(null);

  // Auto-agrandit la zone de légende avec le contenu.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [caption]);

  const audiences = [
    { id: "public", icon: <IconGlobe />, label: t("clips.visibility_public"), desc: t("clips.visibility_public_desc") },
    { id: "friends", icon: <IconFriends />, label: t("clips.visibility_friends"), desc: t("clips.visibility_friends_desc") },
    { id: "private", icon: <IconLock />, label: t("clips.visibility_private"), desc: t("clips.visibility_private_desc") },
  ];

  return (
    <div className="fixed inset-0 z-[90] flex flex-col" style={{ background: C.surface }}>
      {/* En-tête */}
      <div
        className="flex items-center gap-3 px-3 flex-shrink-0"
        style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 10px)", paddingBottom: 10, borderBottom: `1px solid ${C.outlineVar}55` }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={uploading}
          aria-label={t("clips.cancel")}
          className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform disabled:opacity-40"
          style={{ color: C.text, background: C.low }}
        >
          <IconBack />
        </button>
        <h2 className="flex-1 text-base font-black" style={{ color: C.text }}>{t("clips.publish_title")}</h2>
      </div>

      {/* Contenu défilant */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4" style={{ overscrollBehavior: "contain" }}>
        <div className="flex gap-3">
          {/* Aperçu vidéo */}
          <div
            className="flex-shrink-0 overflow-hidden rounded-2xl"
            style={{ width: 112, height: 160, background: "#000", border: `1px solid ${C.outlineVar}` }}
          >
            {previewUrl && (
              <video src={previewUrl} className="w-full h-full object-cover" muted loop autoPlay playsInline />
            )}
          </div>

          {/* Légende */}
          <div
            className="flex-1 min-w-0 rounded-2xl px-3 py-2.5 flex flex-col"
            style={{ background: C.low, border: `1px solid ${C.outlineVar}` }}
          >
            <textarea
              ref={taRef}
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION))}
              placeholder={t("clips.caption_placeholder")}
              rows={1}
              className="flex-1 w-full bg-transparent outline-none resize-none text-sm leading-relaxed placeholder:text-slate-500"
              style={{ color: C.text }}
            />
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] flex items-center gap-1" style={{ color: C.outline }}>
                <IconSpark style={{ width: 13, height: 13, color: C.cyan }} />
                {t("clips.caption_hint")}
              </span>
              <span className="text-[10px] tabular-nums" style={{ color: C.outline }}>{caption.length}/{MAX_CAPTION}</span>
            </div>
          </div>
        </div>

        {/* Audience */}
        <p className="text-[11px] font-bold uppercase tracking-wider mt-5 mb-2 px-1" style={{ color: C.outline }}>
          {t("clips.who_can_watch")}
        </p>
        <div className="space-y-2">
          {audiences.map((a) => (
            <Segment
              key={a.id}
              active={visibility === a.id}
              icon={a.icon}
              label={a.label}
              desc={a.desc}
              onClick={() => setVisibility(a.id)}
            />
          ))}
        </div>

        {/* Restriction UE (feature Nexus conservée) */}
        <button
          type="button"
          onClick={() => setEuBlocked((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl mt-3 transition-all active:scale-[0.99]"
          style={{ background: C.low, border: `1px solid ${euBlocked ? C.cyan : C.outlineVar}` }}
        >
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: euBlocked ? C.cyan : C.high, color: euBlocked ? C.onCyan : C.variant }}
          >
            <IconShieldEU />
          </span>
          <span className="flex-1 text-left min-w-0">
            <span className="block text-sm font-bold" style={{ color: C.text }}>{t("clips.eu_restrict")}</span>
            <span className="block text-[11px]" style={{ color: C.outline }}>{t("clips.eu_restrict_desc")}</span>
          </span>
          <span
            className="relative flex-shrink-0 rounded-full transition-colors"
            style={{ width: 42, height: 24, background: euBlocked ? C.cyan : "#333d52" }}
          >
            <span
              className="absolute top-0.5 rounded-full bg-white transition-all"
              style={{ width: 20, height: 20, left: euBlocked ? 20 : 2 }}
            />
          </span>
        </button>
      </div>

      {/* Barre du bas : progression + Publier (safe-area) */}
      <div
        className="flex-shrink-0 px-4 pt-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom,0px), 14px)", borderTop: `1px solid ${C.outlineVar}55` }}
      >
        {uploading && (
          <div className="mb-3">
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.high }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress || 0}%`, background: `linear-gradient(90deg,${C.cyan},#3b82f6)` }} />
            </div>
            <p className="text-[11px] text-center mt-1.5" style={{ color: C.outline }}>
              {t("clips.uploading")} {progress || 0}%
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => onPublish({ caption: caption.trim(), visibility, euBlocked })}
          disabled={uploading}
          className="w-full py-3.5 rounded-full text-sm font-black active:scale-[0.98] transition-transform disabled:opacity-50"
          style={{ background: `linear-gradient(90deg,${C.cyan},#3b82f6)`, color: C.onCyan }}
        >
          {uploading ? t("clips.publishing") : t("clips.publish")}
        </button>
      </div>
    </div>
  );
}
