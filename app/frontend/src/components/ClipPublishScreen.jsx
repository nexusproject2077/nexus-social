import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

// Écran de publication d'un Clip — façon TikTok, intégré au design Nexus.
// Description + couverture, #/@ rapides, localisation, lien, audience,
// paramètres de confidentialité, plus d'options, brouillon + publier.
// Palette Nexus (bleu nuit + cyan), coins arrondis, icônes SVG (aucun emoji).
const C = {
  surface: "#0b1326",
  low: "#131b2e",
  high: "#222a3d",
  cyan: "#22d3ee",
  onCyan: "#00363e",
  text: "#eaf0ff",
  variant: "#bbc9cd",
  outline: "#7c8aa0",
  outlineVar: "#2b3650",
};
const MAX_CAPTION = 2200;
const SUGGESTED_PLACES = ["Paris", "Accor Arena", "Tour Eiffel", "Stade de France", "Nice"];

// ── Icônes SVG ──────────────────────────────────────────────────────────
const S = (d, extra = {}) => (p) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" {...extra} {...p}>{d}</svg>
);
const IBack = S(<path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />);
const IClose = S(<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />);
const IChevron = S(<path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />);
const IGlobe = S(<><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" /><path d="M3 12h18M12 3c2.5 2.4 2.5 15.6 0 18M12 3c-2.5 2.4-2.5 15.6 0 18" stroke="currentColor" strokeWidth="1.4" /></>);
const IFriends = S(<><circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M16 5.5a3.2 3.2 0 0 1 0 6M17.5 19a5.5 5.5 0 0 0-3-4.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>);
const ILock = S(<><rect x="5" y="10.5" width="14" height="9.5" rx="2.3" stroke="currentColor" strokeWidth="1.6" /><path d="M8 10.5V8a4 4 0 1 1 8 0v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></>);
const IPin = S(<><path d="M12 21c4-4.2 6.5-7.4 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 13.6 8 16.8 12 21z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="12" cy="10.4" r="2.3" stroke="currentColor" strokeWidth="1.6" /></>);
const ILink = S(<><rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.6" /><path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></>);
const IShieldEU = S(<><path d="M12 3l7 2.5v5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5v-5L12 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M15 9.5a3.4 3.4 0 1 0 0 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M8.7 12h3.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>);
const IPrivacy = S(<><rect x="5" y="10.5" width="14" height="9.5" rx="2.3" stroke="currentColor" strokeWidth="1.6" /><path d="M8 10.5V8a4 4 0 1 1 8 0v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></>);
const IOptions = S(<><circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.6" /><path d="M12 3v2.4M12 18.6V21M4.2 7.5l2 1.2M17.8 15.3l2 1.2M4.2 16.5l2-1.2M17.8 8.7l2-1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>);
const IComment = S(<path d="M20 12a8 8 0 1 1-3.4-6.5L20 4.5l-1 3.4A7.9 7.9 0 0 1 20 12z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />);
const IRemix = S(<><path d="M4 7h9l-2-2M20 17h-9l2 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M13 7l3.5 5L20 7M11 17L7.5 12 4 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></>);
const IAI = S(<><path d="M12 3l1.7 4.6L18 9.3l-4.3 1.7L12 15l-1.7-4L6 9.3l4.3-1.7L12 3z" fill="currentColor" /><circle cx="18.5" cy="17.5" r="2" fill="currentColor" /></>);
const IEyeOff = S(<><path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.8 2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /><path d="M6.7 6.9C4.6 8.2 3 10.3 2.5 12c1 3.2 5 6 9.5 6 1.6 0 3.1-.4 4.4-1M9.5 5.3A9.6 9.6 0 0 1 12 5c4.5 0 8.5 2.8 9.5 6-.4 1.2-1.2 2.4-2.3 3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></>);
const IImage = S(<><rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.6" /><circle cx="8.5" cy="9" r="1.6" stroke="currentColor" strokeWidth="1.4" /><path d="M4 17l4.5-4 3 2.5L16 11l4 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></>);
const IDraft = S(<><path d="M4 8l8-4 8 4-8 4-8-4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M4 12l8 4 8-4M4 16l8 4 8-4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></>);
const IUp = S(<><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" /><path d="M12 16V8M8.5 11.5L12 8l3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></>);
const ISpark = S(<path d="M12 2.6l1.9 5.1 5.1 1.9-5.1 1.9L12 16.6l-1.9-5.1L5 9.6l5.1-1.9L12 2.6z" fill="currentColor" />);

// ── Petits composants ───────────────────────────────────────────────────
function NavRow({ icon, label, value, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-3 px-1 py-3.5 active:opacity-70 transition-opacity"
      style={{ borderTop: `1px solid ${C.outlineVar}` }}>
      <span style={{ color: C.variant }}>{icon}</span>
      <span className="flex-1 text-left text-[15px] font-semibold min-w-0 truncate" style={{ color: C.text }}>{label}</span>
      {children}
      {value && <span className="text-[13px] truncate max-w-[42%]" style={{ color: C.outline }}>{value}</span>}
      <IChevron style={{ color: C.outline, width: 18, height: 18 }} />
    </button>
  );
}

function Toggle({ on }) {
  return (
    <span className="relative flex-shrink-0 rounded-full transition-colors" style={{ width: 46, height: 27, background: on ? C.cyan : "#3a4560" }}>
      <span className="absolute top-0.5 rounded-full bg-white transition-all" style={{ width: 23, height: 23, left: on ? 21 : 2 }} />
    </span>
  );
}

function ToggleRow({ icon, label, desc, on, onToggle }) {
  return (
    <button type="button" onClick={onToggle} className="w-full flex items-start gap-3 py-3 text-left active:opacity-80 transition-opacity">
      <span className="mt-0.5" style={{ color: C.variant }}>{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold" style={{ color: C.text }}>{label}</span>
        {desc && <span className="block text-[12px] mt-0.5 leading-snug" style={{ color: C.outline }}>{desc}</span>}
      </span>
      <Toggle on={on} />
    </button>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div className="absolute inset-0 z-[10] flex flex-col justify-end" style={{ background: "rgba(2,6,20,0.6)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rounded-t-3xl px-5 pt-4" style={{ background: C.low, paddingBottom: "max(env(safe-area-inset-bottom,0px), 16px)", animation: "clipSheetUp 0.28s cubic-bezier(0.22,1,0.36,1)" }}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-[17px] font-black" style={{ color: C.text }}>{title}</h3>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: C.high, color: C.variant }}><IClose width={16} height={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ClipPublishScreen({ previewUrl, uploading, progress, onClose, onPublish }) {
  const { t } = useTranslation();
  const [caption, setCaption] = useState("");
  const [visibility, setVisibility] = useState("public");
  const [euBlocked, setEuBlocked] = useState(false);
  const [location, setLocation] = useState("");
  const [link, setLink] = useState("");
  const [cover, setCover] = useState(null); // data URL de la couverture choisie
  const [allowComments, setAllowComments] = useState(true);
  const [allowRemix, setAllowRemix] = useState(false);
  const [mature, setMature] = useState(false);
  const [aiGenerated, setAiGenerated] = useState(false);
  const [sheet, setSheet] = useState(null); // 'audience' | 'privacy' | 'more' | 'cover' | 'location' | 'link'
  const [coverT, setCoverT] = useState(0);
  const taRef = useRef(null);
  const coverVidRef = useRef(null);

  useEffect(() => {
    const el = taRef.current; if (!el) return;
    el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 150) + "px";
  }, [caption]);

  const insert = (token) => setCaption((c) => (c + (c && !c.endsWith(" ") ? " " : "") + token).slice(0, MAX_CAPTION));

  const audienceLabel = { public: t("clips.visibility_public"), friends: t("clips.visibility_friends"), private: t("clips.visibility_private") }[visibility];
  const AudIcon = { public: <IGlobe />, friends: <IFriends />, private: <ILock /> }[visibility];

  const captureCover = () => {
    const v = coverVidRef.current; if (!v) return;
    try {
      const cv = document.createElement("canvas");
      cv.width = 320; cv.height = Math.round(320 * (v.videoHeight / v.videoWidth || 1.6));
      cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
      setCover(cv.toDataURL("image/jpeg", 0.7));
    } catch { /* frame protégée → on ignore */ }
    setSheet(null);
  };

  const submit = (isDraft) => onPublish({
    caption: caption.trim(), visibility, euBlocked,
    location: location.trim(), link: link.trim(), cover,
    allowComments, allowRemix, mature, aiGenerated, isDraft,
  });

  return (
    <div className="fixed inset-0 z-[90] flex flex-col" style={{ background: C.surface }}>
      {/* En-tête */}
      <div className="flex items-center gap-3 px-3 flex-shrink-0"
        style={{ paddingTop: "calc(env(safe-area-inset-top,0px) + 10px)", paddingBottom: 8 }}>
        <button type="button" onClick={onClose} disabled={uploading} aria-label={t("clips.cancel")}
          className="w-10 h-10 rounded-full flex items-center justify-center active:scale-90 transition-transform disabled:opacity-40" style={{ color: C.text }}>
          <IBack width={22} height={22} />
        </button>
      </div>

      {/* Contenu défilant */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-4" style={{ overscrollBehavior: "contain" }}>
        {/* Description + couverture */}
        <div className="flex gap-3 pt-1">
          <textarea ref={taRef} value={caption} onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION))}
            placeholder={t("clips.caption_placeholder")} rows={1}
            className="flex-1 bg-transparent outline-none resize-none text-[15px] leading-relaxed placeholder:text-slate-500 pt-1"
            style={{ color: C.text }} />
          <button type="button" onClick={() => { setCoverT(0); setSheet("cover"); }}
            className="flex-shrink-0 relative overflow-hidden rounded-2xl"
            style={{ width: 96, height: 132, background: "#000", border: `1px solid ${C.outlineVar}` }}>
            {cover ? <img src={cover} alt="" className="w-full h-full object-cover" />
              : previewUrl ? <video src={previewUrl} className="w-full h-full object-cover" muted playsInline preload="metadata" />
              : null}
            <span className="absolute bottom-0 inset-x-0 py-1.5 text-[11px] font-bold text-center text-white" style={{ background: "linear-gradient(180deg,transparent,rgba(0,0,0,0.75))" }}>
              {t("clips.edit_cover")}
            </span>
          </button>
        </div>

        {/* Chips #/@ */}
        <div className="flex gap-2 mt-3 mb-1">
          {[{ k: "#", l: t("clips.hashtags") }, { k: "@", l: t("clips.mention") }].map((c) => (
            <button key={c.k} type="button" onClick={() => insert(c.k)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-bold active:scale-95 transition-transform"
              style={{ background: C.high, color: C.text }}>
              <span style={{ color: C.cyan }}>{c.k}</span> {c.l}
            </button>
          ))}
        </div>

        {/* Lignes de navigation */}
        <div className="mt-3">
          <NavRow icon={<IPin />} label={t("clips.location")} value={location || undefined} onClick={() => setSheet("location")} />
          <NavRow icon={<ILink />} label={t("clips.add_link")} value={link || undefined} onClick={() => setSheet("link")} />
          <NavRow icon={AudIcon} label={t("clips.who_can_watch")} value={audienceLabel} onClick={() => setSheet("audience")} />
          <NavRow icon={<IPrivacy />} label={t("clips.privacy_settings")} onClick={() => setSheet("privacy")} />
          <NavRow icon={<IOptions />} label={t("clips.more_options")} onClick={() => setSheet("more")} />
        </div>
        <div className="h-3" style={{ borderTop: `1px solid ${C.outlineVar}` }} />
      </div>

      {/* Barre du bas : progression + Brouillons + Publier */}
      <div className="flex-shrink-0 px-4 pt-3" style={{ paddingBottom: "max(env(safe-area-inset-bottom,0px), 14px)", borderTop: `1px solid ${C.outlineVar}55` }}>
        {uploading && (
          <div className="mb-3">
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.high }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress || 0}%`, background: `linear-gradient(90deg,${C.cyan},#3b82f6)` }} />
            </div>
            <p className="text-[11px] text-center mt-1.5" style={{ color: C.outline }}>{t("clips.uploading")} {progress || 0}%</p>
          </div>
        )}
        <div className="flex gap-3">
          <button type="button" onClick={() => submit(true)} disabled={uploading}
            className="flex items-center justify-center gap-2 px-5 py-3.5 rounded-full text-[15px] font-bold active:scale-[0.98] transition-transform disabled:opacity-50"
            style={{ background: C.high, color: C.text }}>
            <IDraft width={18} height={18} /> {t("clips.draft")}
          </button>
          <button type="button" onClick={() => submit(false)} disabled={uploading}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-full text-[15px] font-black active:scale-[0.98] transition-transform disabled:opacity-50"
            style={{ background: `linear-gradient(90deg,${C.cyan},#3b82f6)`, color: C.onCyan }}>
            <IUp width={19} height={19} /> {uploading ? t("clips.publishing") : t("clips.publish")}
          </button>
        </div>
      </div>

      {/* ── Sous-panneaux ─────────────────────────────────────────────── */}
      {sheet === "audience" && (
        <Sheet title={t("clips.who_can_watch")} onClose={() => setSheet(null)}>
          <div className="space-y-2 pb-2">
            {[
              { id: "public", icon: <IGlobe />, l: t("clips.visibility_public"), d: t("clips.visibility_public_desc") },
              { id: "friends", icon: <IFriends />, l: t("clips.visibility_friends"), d: t("clips.visibility_friends_desc") },
              { id: "private", icon: <ILock />, l: t("clips.visibility_private"), d: t("clips.visibility_private_desc") },
            ].map((a) => {
              const on = visibility === a.id;
              return (
                <button key={a.id} type="button" onClick={() => { setVisibility(a.id); setSheet(null); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl active:scale-[0.99] transition-all"
                  style={{ background: on ? `${C.cyan}14` : C.high, border: `1px solid ${on ? C.cyan : C.outlineVar}` }}>
                  <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: on ? C.cyan : C.low, color: on ? C.onCyan : C.variant }}>{a.icon}</span>
                  <span className="flex-1 text-left min-w-0">
                    <span className="block text-sm font-bold" style={{ color: C.text }}>{a.l}</span>
                    <span className="block text-[11px]" style={{ color: C.outline }}>{a.d}</span>
                  </span>
                  <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ border: `2px solid ${on ? C.cyan : C.outlineVar}` }}>
                    {on && <span className="w-2.5 h-2.5 rounded-full" style={{ background: C.cyan }} />}
                  </span>
                </button>
              );
            })}
          </div>
        </Sheet>
      )}

      {sheet === "privacy" && (
        <Sheet title={t("clips.privacy_settings")} onClose={() => setSheet(null)}>
          <ToggleRow icon={<IComment />} label={t("clips.allow_comments")} on={allowComments} onToggle={() => setAllowComments((v) => !v)} />
          <ToggleRow icon={<IRemix />} label={t("clips.allow_remix")} desc={t("clips.allow_remix_desc")} on={allowRemix} onToggle={() => setAllowRemix((v) => !v)} />
          <ToggleRow icon={<IShieldEU />} label={t("clips.eu_restrict")} desc={t("clips.eu_restrict_desc")} on={euBlocked} onToggle={() => setEuBlocked((v) => !v)} />
        </Sheet>
      )}

      {sheet === "more" && (
        <Sheet title={t("clips.more_options")} onClose={() => setSheet(null)}>
          <ToggleRow icon={<IAI />} label={t("clips.ai_generated")} desc={t("clips.ai_generated_desc")} on={aiGenerated} onToggle={() => setAiGenerated((v) => !v)} />
          <ToggleRow icon={<IEyeOff />} label={t("clips.mature")} desc={t("clips.mature_desc")} on={mature} onToggle={() => setMature((v) => !v)} />
        </Sheet>
      )}

      {(sheet === "location" || sheet === "link") && (
        <Sheet title={sheet === "location" ? t("clips.location") : t("clips.add_link")} onClose={() => setSheet(null)}>
          <input autoFocus value={sheet === "location" ? location : link}
            onChange={(e) => (sheet === "location" ? setLocation : setLink)(e.target.value)}
            placeholder={sheet === "location" ? t("clips.location_placeholder") : t("clips.link_placeholder")}
            inputMode={sheet === "link" ? "url" : "text"}
            className="w-full rounded-2xl px-4 py-3 text-[15px] outline-none mb-3"
            style={{ background: C.high, color: C.text, border: `1px solid ${C.outlineVar}` }} />
          {sheet === "location" && (
            <div className="flex flex-wrap gap-2 mb-2">
              {SUGGESTED_PLACES.map((p) => (
                <button key={p} type="button" onClick={() => setLocation(p)}
                  className="px-3 py-1.5 rounded-full text-[13px] font-semibold" style={{ background: C.high, color: C.variant }}>{p}</button>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setSheet(null)}
            className="w-full py-3 rounded-full text-sm font-black mb-1" style={{ background: `linear-gradient(90deg,${C.cyan},#3b82f6)`, color: C.onCyan }}>
            {t("clips.done")}
          </button>
        </Sheet>
      )}

      {sheet === "cover" && (
        <Sheet title={t("clips.edit_cover")} onClose={() => setSheet(null)}>
          <div className="flex flex-col items-center pb-1">
            <video ref={coverVidRef} src={previewUrl} className="rounded-2xl mb-3" muted playsInline
              style={{ maxHeight: "42vh", background: "#000" }}
              onLoadedMetadata={(e) => { e.currentTarget.currentTime = 0; }} />
            <input type="range" min={0} max={coverVidRef.current?.duration || 0} step="0.1" value={coverT}
              onChange={(e) => { const v = Number(e.target.value); setCoverT(v); if (coverVidRef.current) coverVidRef.current.currentTime = v; }}
              className="w-full mb-3" style={{ accentColor: C.cyan }} />
            <button type="button" onClick={captureCover}
              className="w-full py-3 rounded-full text-sm font-black flex items-center justify-center gap-2"
              style={{ background: `linear-gradient(90deg,${C.cyan},#3b82f6)`, color: C.onCyan }}>
              <IImage width={17} height={17} /> {t("clips.use_frame")}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
