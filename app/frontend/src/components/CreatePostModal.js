import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Image, Video, X } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export default function CreatePostModal({ open, onClose, onPostCreated }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [content, setContent] = useState("");
  const [media, setMedia] = useState(null);
  const [mediaPreview, setMediaPreview] = useState(null);
  const [mediaType, setMediaType] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("post"); // "post" | "story" | "poll"
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [affiliateLink, setAffiliateLink] = useState("");

  const updateOption = (i, value) =>
    setPollOptions((opts) => opts.map((o, idx) => (idx === i ? value : o)));
  const addOption = () =>
    setPollOptions((opts) => (opts.length >= 6 ? opts : [...opts, ""]));
  const removeOption = (i) =>
    setPollOptions((opts) =>
      opts.length <= 2 ? opts : opts.filter((_, idx) => idx !== i),
    );

  const MAX_VIDEO_SECONDS = 60; // Nexus Clips = vidéos courtes
  const MAX_FILE_MB = 25;

  const readAndSet = (file, type) => {
    setMedia(file);
    setMediaType(type);
    const reader = new FileReader();
    reader.onloadend = () => setMediaPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleMediaChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      toast.error(`Fichier trop volumineux (max ${MAX_FILE_MB} Mo)`);
      e.target.value = "";
      return;
    }

    if (file.type.startsWith("image")) {
      readAndSet(file, "image");
    } else if (file.type.startsWith("video")) {
      // Vérifier la durée : on n'accepte que les vidéos courtes
      const url = URL.createObjectURL(file);
      const probe = document.createElement("video");
      probe.preload = "metadata";
      probe.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        if (probe.duration > MAX_VIDEO_SECONDS + 0.5) {
          toast.error(
            `Vidéo trop longue (max ${MAX_VIDEO_SECONDS}s pour un clip)`,
          );
          e.target.value = "";
          return;
        }
        readAndSet(file, "video");
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        toast.error(t("cannot_play_video"));
        e.target.value = "";
      };
      probe.src = url;
    }
  };

  const handleRemoveMedia = () => {
    setMedia(null);
    setMediaPreview(null);
    setMediaType(null);
  };

  const resetForm = () => {
    setContent("");
    setMedia(null);
    setMediaPreview(null);
    setMediaType(null);
    setPollOptions(["", ""]);
    setAffiliateLink("");
    setMode("post");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // --- Story : média obligatoire, publié vers /stories (expire en 24h) ---
    if (mode === "story") {
      if (!mediaPreview) {
        toast.error(t("add_story_media"));
        return;
      }
      setLoading(true);
      try {
        const form = new FormData();
        form.append("media_type", mediaType);
        form.append("media_url", mediaPreview); // base64 (CAS URL du backend)
        await axios.post(`${API}/stories`, form);
        toast.success(t("story_published"));
        resetForm();
        onClose?.();
      } catch (error) {
        console.error(t("error_create_story_log"), error);
        toast.error(
          error.response?.data?.detail || t("error_publishing_story"),
        );
      } finally {
        setLoading(false);
      }
      return;
    }

    // --- Post / Sondage ---
    if (!content.trim()) {
      toast.error(
        mode === "poll"
          ? t("poll_question_hint")
          : t("content_cannot_be_empty"),
      );
      return;
    }

    let poll_options = null;
    if (mode === "poll") {
      poll_options = pollOptions.map((o) => o.trim()).filter(Boolean);
      if (poll_options.length < 2) {
        toast.error(t("poll_min_options"));
        return;
      }
    }

    setLoading(true);
    try {
      // ✅ IMPORTANT: Envoie du JSON au lieu de FormData
      const postData = {
        content: content,
        media_type: mediaType || null,
        media_url: mediaPreview || null, // Base64 string
        poll_options, // null pour un post simple
        affiliate_link: affiliateLink.trim() || null,
      };

      const response = await axios.post(`${API}/posts`, postData, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      onPostCreated(response.data);
      resetForm();
      toast.success(mode === "poll" ? t("poll_published") : t("post_created"));
    } catch (error) {
      console.error(t("error_create_post_log"), error);
      toast.error(error.response?.data?.detail || t("error_creating_post"));
    } finally {
      setLoading(false);
    }
  };

  // Verrouille le scroll de l'arrière-plan + ferme sur Échap quand ouvert.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const title =
    mode === "story"
      ? t("create_story")
      : mode === "poll"
        ? t("create_poll")
        : t("whats_new");
  const canSubmit = mode === "story" ? !!mediaPreview : !!content.trim();

  return (
    // Plein écran sur mobile (vraie page), fenêtre centrée sur PC.
    <div
      className="fixed inset-0 z-[60] flex sm:items-center sm:justify-center sm:p-4"
      style={{ background: "rgba(2,6,20,0.85)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className="relative flex flex-col w-full bg-[#0b1326] text-white overflow-hidden
                   h-[100dvh] sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl sm:border sm:border-slate-800"
      >
        {/* Barre supérieure : fermer · titre · Publier (façon X) */}
        <div
          className="flex items-center gap-3 px-4 h-14 border-b border-slate-800 flex-shrink-0"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <button
            type="button"
            onClick={onClose}
            data-testid="cancel-post-button"
            className="w-9 h-9 -ml-1 flex items-center justify-center rounded-full hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
          <h2 className="text-base font-bold flex-1 truncate">{title}</h2>
          <Button
            type="submit"
            form="create-post-form"
            disabled={loading || !canSubmit}
            className="rounded-full px-5 h-9 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-slate-900 font-bold disabled:opacity-50"
            data-testid="submit-post-button"
          >
            {loading
              ? "…"
              : mode === "story"
                ? "Publier"
                : mode === "poll"
                  ? "Publier"
                  : "Publier"}
          </Button>
        </div>

        <form
          id="create-post-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto p-4 space-y-4"
        >
          {/* Mode selector : Post / Story / Sondage */}
          <div className="flex gap-2">
            {[
              { key: "post", label: t("publication"), icon: "article" },
              { key: "story", label: "Story", icon: "auto_stories" },
              { key: "poll", label: "Sondage", icon: "bar_chart" },
            ].map(({ key, label, icon }) => (
              <button
                key={key}
                type="button"
                data-testid={`mode-${key}`}
                onClick={() => setMode(key)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold transition-colors ${
                  mode === key
                    ? "bg-gradient-to-r from-cyan-500 to-blue-500 text-slate-900"
                    : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                }`}
              >
                <span className="material-symbols-outlined text-base">
                  {icon}
                </span>
                {label}
              </button>
            ))}
          </div>

          {mode !== "story" && (
            <div>
              <Label htmlFor="content">
                {mode === "poll" ? "Question" : "Contenu"}
              </Label>
              <Textarea
                id="content"
                data-testid="create-post-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={
                  mode === "poll" ? t("ask_your_question") : t("what_to_share")
                }
                className="bg-slate-800 border-slate-700 text-white min-h-32"
                rows={mode === "poll" ? 2 : 5}
              />
            </div>
          )}

          {/* Options de sondage */}
          {mode === "poll" && (
            <div className="space-y-2">
              <Label>Options</Label>
              {pollOptions.map((opt, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    value={opt}
                    data-testid={`poll-option-input-${i}`}
                    onChange={(e) => updateOption(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                    maxLength={80}
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                  {pollOptions.length > 2 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeOption(i)}
                      className="text-slate-400 hover:text-red-400 flex-shrink-0"
                      data-testid={`remove-poll-option-${i}`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
              {pollOptions.length < 6 && (
                <button
                  type="button"
                  onClick={addOption}
                  data-testid="add-poll-option"
                  className="text-sm font-medium text-cyan-400 hover:text-cyan-300"
                >
                  + Ajouter une option
                </button>
              )}
            </div>
          )}

          {mode === "story" && (
            <p className="text-sm text-slate-400">
              Votre story sera visible 24h puis disparaîtra. Ajoutez une photo
              ou une vidéo ci-dessous.
            </p>
          )}

          {/* Lien affilié (optionnel) */}
          {mode !== "story" && (
            <div>
              <Label htmlFor="affiliate">Lien affilié (optionnel)</Label>
              <Input
                id="affiliate"
                data-testid="affiliate-input"
                type="url"
                value={affiliateLink}
                onChange={(e) => setAffiliateLink(e.target.value)}
                placeholder="https://amzn.to/…"
                className="bg-slate-800 border-slate-700 text-white"
              />
              <p className="text-xs text-slate-500 mt-1">
                Affiche un bouton « Shop » sur votre publication (liens
                http/https uniquement).
              </p>
            </div>
          )}

          {mediaPreview && (
            <div className="relative">
              {mediaType === "image" ? (
                <img
                  src={mediaPreview}
                  alt="Preview"
                  className="w-full rounded-lg max-h-64 object-cover"
                />
              ) : mediaType === "video" ? (
                <video
                  src={mediaPreview}
                  controls
                  className="w-full rounded-lg max-h-64"
                />
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleRemoveMedia}
                className="absolute top-2 left-2 bg-slate-900/80 hover:bg-slate-800"
                data-testid="remove-media-button"
                title={t("remove_media")}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Inputs fichiers cachés (déclenchés par la barre d'outils ci-dessous) */}
          <Input
            id="image-upload"
            data-testid="upload-image-input"
            type="file"
            accept="image/*"
            onChange={handleMediaChange}
            className="hidden"
          />
          <Input
            id="video-upload"
            data-testid="upload-video-input"
            type="file"
            accept="video/*"
            onChange={handleMediaChange}
            className="hidden"
          />
          <Input
            id="gif-upload"
            data-testid="upload-gif-input"
            type="file"
            accept="image/gif"
            onChange={handleMediaChange}
            className="hidden"
          />
        </form>

        {/* Barre d'outils média (bas de page, façon « Quoi de neuf ? ») */}
        <div
          className="flex items-center gap-1 px-2 py-2 border-t border-slate-800 flex-shrink-0 overflow-x-auto no-scrollbar"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)" }}
        >
          <Label
            htmlFor="image-upload"
            className="cursor-pointer flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg hover:bg-slate-800 text-cyan-400"
          >
            <Image className="w-5 h-5" />
            <span className="text-[11px] font-medium">Photo</span>
          </Label>
          <Label
            htmlFor="video-upload"
            className="cursor-pointer flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg hover:bg-slate-800 text-cyan-400"
          >
            <Video className="w-5 h-5" />
            <span className="text-[11px] font-medium">Vidéo</span>
          </Label>
          <Label
            htmlFor="gif-upload"
            className="cursor-pointer flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg hover:bg-slate-800 text-cyan-400"
          >
            <span className="material-symbols-outlined text-[22px] leading-none">
              gif_box
            </span>
            <span className="text-[11px] font-medium">GIF</span>
          </Label>
          <button
            type="button"
            onClick={() => setMode("poll")}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg hover:bg-slate-800 ${mode === "poll" ? "text-cyan-300" : "text-cyan-400"}`}
          >
            <span className="material-symbols-outlined text-[22px] leading-none">
              bar_chart
            </span>
            <span className="text-[11px] font-medium">Sondage</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onClose?.();
              navigate("/live");
            }}
            className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg hover:bg-slate-800 text-rose-400"
          >
            <span className="material-symbols-outlined text-[22px] leading-none">
              sensors
            </span>
            <span className="text-[11px] font-medium">Live</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("story")}
            className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg hover:bg-slate-800 ${mode === "story" ? "text-cyan-300" : "text-cyan-400"}`}
          >
            <span className="material-symbols-outlined text-[22px] leading-none">
              auto_stories
            </span>
            <span className="text-[11px] font-medium">Story</span>
          </button>
        </div>
      </div>
    </div>
  );
}
