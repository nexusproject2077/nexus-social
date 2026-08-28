import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

const C = {
  bg: "#000",
  card: "#161616",
  line: "rgba(255,255,255,0.08)",
  muted: "#888",
  text: "#fff",
  accent:
    (typeof window !== "undefined" &&
      window.localStorage.getItem("nexus_accent")) ||
    "#22d3ee",
};

const DRAFTS_KEY = "nexus_clip_drafts";

/**
 * Écran de publication type TikTok / Reels, adapté à Nexus Clips.
 * Affiché après sélection (ou enregistrement) d'une vidéo.
 */
export default function ClipPublishScreen({
  file,
  previewUrl,
  user,
  onClose,
  onPublish,
  publishing = false,
  uploadProgress = 0,
}) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const [caption, setCaption] = useState("");
  const [coverTime, setCoverTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [coverDataUrl, setCoverDataUrl] = useState(null);
  const [location, setLocation] = useState("");
  const [link, setLink] = useState("");
  const [visibility, setVisibility] = useState("public"); // public | followers | private
  const [allowComments, setAllowComments] = useState(true);
  const [euBlocked, setEuBlocked] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [showCover, setShowCover] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const captionRef = useRef(null);

  const suggestedPlaces = [
    "Paris",
    "Istanbul",
    "London",
    "New York",
    "Berlin",
    "Madrid",
    "Tokyo",
  ];

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => {
      setDuration(v.duration || 0);
      captureFrame(Math.min(1, (v.duration || 2) * 0.1));
    };
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [previewUrl]);

  const captureFrame = (timeSec) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const seek = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        canvas.getContext("2d").drawImage(v, 0, 0);
        setCoverDataUrl(canvas.toDataURL("image/jpeg", 0.85));
        setCoverTime(timeSec);
      } catch {
        /* CORS / decode */
      }
    };
    if (Math.abs((v.currentTime || 0) - timeSec) < 0.05) seek();
    else {
      const onSeeked = () => {
        v.removeEventListener("seeked", onSeeked);
        seek();
      };
      v.addEventListener("seeked", onSeeked);
      v.currentTime = timeSec;
    }
  };

  const insertAtCursor = (text) => {
    const el = captionRef.current;
    if (!el) {
      setCaption((c) => (c ? `${c} ${text}` : text));
      return;
    }
    const start = el.selectionStart ?? caption.length;
    const end = el.selectionEnd ?? caption.length;
    const next = caption.slice(0, start) + text + caption.slice(end);
    setCaption(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const buildFinalCaption = () => {
    let c = caption.trim();
    if (location) c = c ? `${c}\n📍 ${location}` : `📍 ${location}`;
    if (link) c = c ? `${c}\n🔗 ${link}` : `🔗 ${link}`;
    return c;
  };

  const handlePublish = () => {
    onPublish?.({
      caption: buildFinalCaption(),
      visibility,
      allowComments,
      euBlocked,
      coverTime,
      coverDataUrl,
      location,
      link,
      duration,
    });
  };

  const handleSaveDraft = () => {
    try {
      const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || "[]");
      drafts.unshift({
        id: `draft-${Date.now()}`,
        caption,
        location,
        link,
        visibility,
        allowComments,
        euBlocked,
        coverTime,
        fileName: file?.name || "video",
        fileSize: file?.size || 0,
        createdAt: new Date().toISOString(),
        // Note: le File lui-même n'est pas persisté (sécurité navigateur).
        // On stocke les métadonnées ; l'utilisateur re-sélectionne la vidéo.
      });
      localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts.slice(0, 20)));
      toast.success(t("clip_draft_saved"));
      onClose?.();
    } catch {
      toast.error(t("error"));
    }
  };

  const visLabel =
    visibility === "followers"
      ? t("clip_vis_followers")
      : visibility === "private"
        ? t("clip_vis_private")
        : t("clip_vis_public");

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ background: C.bg, color: C.text }}
    >
      {/* Header */}
      <header
        className="flex items-center gap-3 px-3 py-3 safe-top"
        style={{ borderBottom: `1px solid ${C.line}` }}
      >
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full"
          aria-label={t("back")}
        >
          <span className="material-symbols-outlined text-2xl">arrow_back</span>
        </button>
        <h1 className="flex-1 text-base font-bold">
          {t("clip_publish_title")}
        </h1>
      </header>

      <div className="flex-1 overflow-y-auto pb-28">
        {/* Caption + cover */}
        <div className="flex gap-3 p-4">
          <textarea
            ref={captionRef}
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 2200))}
            placeholder={t("clip_add_description")}
            className="flex-1 bg-transparent border-none outline-none resize-none text-[15px] leading-relaxed min-h-[120px] placeholder:text-slate-500"
            maxLength={2200}
          />
          <div className="relative w-28 flex-shrink-0">
            <div
              className="rounded-xl overflow-hidden relative"
              style={{ aspectRatio: "9/16", background: "#111" }}
            >
              {coverDataUrl ? (
                <img
                  src={coverDataUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <video
                  ref={videoRef}
                  src={previewUrl}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
              )}
              {/* hidden video for frame capture if cover already set */}
              {coverDataUrl && (
                <video
                  ref={videoRef}
                  src={previewUrl}
                  className="hidden"
                  muted
                  playsInline
                  preload="metadata"
                />
              )}
              <div className="absolute top-1 left-1 right-1 text-center text-[10px] font-bold text-white/90 drop-shadow">
                {t("clip_preview")}
              </div>
              <button
                type="button"
                onClick={() => setShowCover(true)}
                className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-full text-[10px] font-bold whitespace-nowrap"
                style={{ background: "rgba(0,0,0,0.65)" }}
              >
                {t("clip_edit_cover")}
              </button>
            </div>
          </div>
        </div>

        {/* Hashtags / Mention */}
        <div className="flex gap-2 px-4 pb-3">
          <button
            type="button"
            onClick={() => insertAtCursor("#")}
            className="px-3 py-1.5 rounded-full text-sm font-semibold"
            style={{ background: C.card }}
          >
            # {t("clip_hashtags")}
          </button>
          <button
            type="button"
            onClick={() => insertAtCursor("@")}
            className="px-3 py-1.5 rounded-full text-sm font-semibold"
            style={{ background: C.card }}
          >
            @ {t("clip_mention")}
          </button>
        </div>

        <div style={{ height: 1, background: C.line }} className="mx-4 my-1" />

        {/* Location */}
        <button
          type="button"
          onClick={() => setShowLocation(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:opacity-80"
        >
          <span
            className="material-symbols-outlined text-xl"
            style={{ color: C.muted }}
          >
            location_on
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {location || t("clip_location")}
            </p>
            {location && (
              <p className="text-xs mt-0.5" style={{ color: C.muted }}>
                {t("clip_location_hint")}
              </p>
            )}
          </div>
          <span
            className="material-symbols-outlined"
            style={{ color: C.muted }}
          >
            chevron_right
          </span>
        </button>

        {/* Link */}
        <button
          type="button"
          onClick={() => setShowLink(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:opacity-80"
        >
          <span
            className="material-symbols-outlined text-xl"
            style={{ color: C.muted }}
          >
            add_link
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">
              {link || t("clip_add_link")}
            </p>
          </div>
          <span
            className="material-symbols-outlined"
            style={{ color: C.muted }}
          >
            chevron_right
          </span>
        </button>

        {/* Visibility */}
        <button
          type="button"
          onClick={() => setShowPrivacy(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:opacity-80"
        >
          <span
            className="material-symbols-outlined text-xl"
            style={{ color: C.muted }}
          >
            public
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{visLabel}</p>
          </div>
          <span
            className="material-symbols-outlined"
            style={{ color: C.muted }}
          >
            chevron_right
          </span>
        </button>

        {/* Privacy settings */}
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:opacity-80"
        >
          <span
            className="material-symbols-outlined text-xl"
            style={{ color: C.muted }}
          >
            lock
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{t("clip_privacy_settings")}</p>
            <p className="text-xs mt-0.5" style={{ color: C.muted }}>
              {t("clip_privacy_settings_sub")}
            </p>
          </div>
          <span
            className="material-symbols-outlined"
            style={{ color: C.muted }}
          >
            chevron_right
          </span>
        </button>

        {/* More options */}
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:opacity-80"
        >
          <span
            className="material-symbols-outlined text-xl"
            style={{ color: C.muted }}
          >
            settings
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{t("clip_more_options")}</p>
          </div>
          <span
            className="material-symbols-outlined"
            style={{ color: C.muted }}
          >
            chevron_right
          </span>
        </button>
      </div>

      {/* Bottom actions */}
      <div
        className="fixed bottom-0 left-0 right-0 p-4 flex gap-3"
        style={{
          background: "linear-gradient(transparent, #000 30%)",
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        }}
      >
        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={publishing}
          className="flex-1 py-3.5 rounded-full font-bold text-sm flex items-center justify-center gap-2"
          style={{ background: C.card }}
        >
          <span className="material-symbols-outlined text-lg">folder</span>
          {t("clip_drafts")}
        </button>
        <button
          type="button"
          onClick={handlePublish}
          disabled={publishing}
          className="flex-[1.4] py-3.5 rounded-full font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
          style={{
            background: "linear-gradient(90deg,#ec4899,#f43f5e)",
            color: "#fff",
          }}
        >
          {publishing ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {uploadProgress > 0 ? `${uploadProgress}%` : t("loading")}
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-lg">upload</span>
              {t("clip_publish")}
            </>
          )}
        </button>
      </div>

      {/* ---- Sheets ---- */}
      {showCover && (
        <Sheet title={t("clip_edit_cover")} onClose={() => setShowCover(false)}>
          <p className="text-xs mb-3" style={{ color: C.muted }}>
            {t("clip_cover_hint")}
          </p>
          <video
            src={previewUrl}
            className="w-full rounded-xl mb-3"
            style={{ maxHeight: 280, background: "#111" }}
            controls
            onTimeUpdate={(e) => setCoverTime(e.target.currentTime)}
          />
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={coverTime}
            onChange={(e) => {
              const tsec = Number(e.target.value);
              setCoverTime(tsec);
              captureFrame(tsec);
            }}
            className="w-full mb-4"
          />
          <button
            type="button"
            onClick={() => {
              captureFrame(coverTime);
              setShowCover(false);
            }}
            className="w-full py-3 rounded-full font-bold"
            style={{ background: C.accent, color: "#00363e" }}
          >
            {t("save")}
          </button>
        </Sheet>
      )}

      {showLocation && (
        <Sheet
          title={t("clip_location")}
          onClose={() => setShowLocation(false)}
        >
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder={t("clip_location_placeholder")}
            className="w-full rounded-xl px-4 py-3 mb-3 text-sm outline-none"
            style={{ background: C.card, color: C.text }}
          />
          <div className="flex flex-wrap gap-2 mb-4">
            {suggestedPlaces.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setLocation(p)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold"
                style={{
                  background: location === p ? C.accent : C.card,
                  color: location === p ? "#00363e" : C.text,
                }}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowLocation(false)}
            className="w-full py-3 rounded-full font-bold"
            style={{ background: C.accent, color: "#00363e" }}
          >
            {t("done")}
          </button>
        </Sheet>
      )}

      {showLink && (
        <Sheet title={t("clip_add_link")} onClose={() => setShowLink(false)}>
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://"
            inputMode="url"
            className="w-full rounded-xl px-4 py-3 mb-4 text-sm outline-none"
            style={{ background: C.card, color: C.text }}
          />
          <button
            type="button"
            onClick={() => setShowLink(false)}
            className="w-full py-3 rounded-full font-bold"
            style={{ background: C.accent, color: "#00363e" }}
          >
            {t("done")}
          </button>
        </Sheet>
      )}

      {showPrivacy && (
        <Sheet
          title={t("clip_who_can_watch")}
          onClose={() => setShowPrivacy(false)}
        >
          {[
            {
              id: "public",
              icon: "public",
              label: t("clip_vis_public"),
              sub: t("clip_vis_public_sub"),
            },
            {
              id: "followers",
              icon: "group",
              label: t("clip_vis_followers"),
              sub: t("clip_vis_followers_sub"),
            },
            {
              id: "private",
              icon: "lock",
              label: t("clip_vis_private"),
              sub: t("clip_vis_private_sub"),
            },
          ].map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                setVisibility(o.id);
                setShowPrivacy(false);
              }}
              className="w-full flex items-center gap-3 px-2 py-3 text-left rounded-xl mb-1"
              style={{
                background:
                  visibility === o.id ? "rgba(34,211,238,0.12)" : "transparent",
              }}
            >
              <span className="material-symbols-outlined">{o.icon}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold">{o.label}</p>
                <p className="text-xs" style={{ color: C.muted }}>
                  {o.sub}
                </p>
              </div>
              {visibility === o.id && (
                <span
                  className="material-symbols-outlined"
                  style={{ color: C.accent }}
                >
                  check_circle
                </span>
              )}
            </button>
          ))}
        </Sheet>
      )}

      {showMore && (
        <Sheet
          title={t("clip_more_options")}
          onClose={() => setShowMore(false)}
        >
          <ToggleRow
            label={t("clip_allow_comments")}
            sub={t("clip_allow_comments_sub")}
            checked={allowComments}
            onChange={setAllowComments}
          />
          <ToggleRow
            label={t("clip_eu_block")}
            sub={t("clip_eu_block_sub")}
            checked={euBlocked}
            onChange={setEuBlocked}
          />
          <button
            type="button"
            onClick={() => setShowMore(false)}
            className="w-full mt-4 py-3 rounded-full font-bold"
            style={{ background: C.accent, color: "#00363e" }}
          >
            {t("done")}
          </button>
        </Sheet>
      )}
    </div>
  );
}

function Sheet({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-[110] flex flex-col justify-end"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto"
        style={{ background: "#121212" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-base">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full"
            style={{ background: "#222" }}
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ToggleRow({ label, sub, checked, onChange }) {
  return (
    <div
      className="flex items-center gap-3 py-3"
      style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
    >
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        {sub && (
          <p className="text-xs mt-0.5" style={{ color: "#888" }}>
            {sub}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="relative w-11 h-6 rounded-full transition-all flex-shrink-0"
        style={{
          background: checked
            ? "linear-gradient(90deg,#22d3ee,#3b82f6)"
            : "#333",
        }}
      >
        <div
          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`}
        />
      </button>
    </div>
  );
}
