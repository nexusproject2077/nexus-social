import { useState } from "react";
import axios from "axios";
import { API } from "@/App";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Image, Video, X } from "lucide-react";
import { toast } from "sonner";

export default function CreatePostModal({ open, onClose, onPostCreated }) {
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
    setPollOptions((opts) => (opts.length <= 2 ? opts : opts.filter((_, idx) => idx !== i)));

  const MAX_VIDEO_SECONDS = 60;   // Nexus Clips = vidéos courtes
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

    if (file.type.startsWith('image')) {
      readAndSet(file, 'image');
    } else if (file.type.startsWith('video')) {
      // Vérifier la durée : on n'accepte que les vidéos courtes
      const url = URL.createObjectURL(file);
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        if (probe.duration > MAX_VIDEO_SECONDS + 0.5) {
          toast.error(`Vidéo trop longue (max ${MAX_VIDEO_SECONDS}s pour un clip)`);
          e.target.value = "";
          return;
        }
        readAndSet(file, 'video');
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        toast.error("Impossible de lire cette vidéo");
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
        toast.error("Ajoutez une photo ou une vidéo pour votre story");
        return;
      }
      setLoading(true);
      try {
        const form = new FormData();
        form.append("media_type", mediaType);
        form.append("media_url", mediaPreview); // base64 (CAS URL du backend)
        await axios.post(`${API}/stories`, form);
        toast.success("Story publiée (disparaît dans 24h)");
        resetForm();
        onClose?.();
      } catch (error) {
        console.error("Erreur création story:", error);
        toast.error(error.response?.data?.detail || "Erreur lors de la publication de la story");
      } finally {
        setLoading(false);
      }
      return;
    }

    // --- Post / Sondage ---
    if (!content.trim()) {
      toast.error(mode === "poll" ? "Posez une question pour votre sondage" : "Le contenu ne peut pas être vide");
      return;
    }

    let poll_options = null;
    if (mode === "poll") {
      poll_options = pollOptions.map((o) => o.trim()).filter(Boolean);
      if (poll_options.length < 2) {
        toast.error("Ajoutez au moins 2 options de sondage");
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
          'Content-Type': 'application/json',
        },
      });

      onPostCreated(response.data);
      resetForm();
      toast.success(mode === "poll" ? "Sondage publié" : "Publication créée avec succès");
    } catch (error) {
      console.error("Erreur création post:", error);
      toast.error(error.response?.data?.detail || "Erreur lors de la création de la publication");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {mode === "story" ? "Créer une story" : mode === "poll" ? "Créer un sondage" : "Créer une publication"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Mode selector : Post / Story / Sondage */}
          <div className="flex gap-2">
            {[
              { key: "post", label: "Publication", icon: "article" },
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
                <span className="material-symbols-outlined text-base">{icon}</span>
                {label}
              </button>
            ))}
          </div>

          {mode !== "story" && (
            <div>
              <Label htmlFor="content">{mode === "poll" ? "Question" : "Contenu"}</Label>
              <Textarea
                id="content"
                data-testid="create-post-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={mode === "poll" ? "Posez votre question…" : "Que voulez-vous partager?"}
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
              Votre story sera visible 24h puis disparaîtra. Ajoutez une photo ou une vidéo ci-dessous.
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
                Affiche un bouton « Shop » sur votre publication (liens http/https uniquement).
              </p>
            </div>
          )}

          {mediaPreview && (
            <div className="relative">
              {mediaType === 'image' ? (
                <img
                  src={mediaPreview}
                  alt="Preview"
                  className="w-full rounded-lg max-h-64 object-cover"
                />
              ) : mediaType === 'video' ? (
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
                title="Retirer le média"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            <div>
              <Input
                id="image-upload"
                data-testid="upload-image-input"
                type="file"
                accept="image/*"
                onChange={handleMediaChange}
                className="hidden"
              />
              <Label
                htmlFor="image-upload"
                className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-md"
              >
                <Image className="w-4 h-4" />
                Image
              </Label>
            </div>

            <div>
              <Input
                id="video-upload"
                data-testid="upload-video-input"
                type="file"
                accept="video/*"
                onChange={handleMediaChange}
                className="hidden"
              />
              <Label
                htmlFor="video-upload"
                className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-md"
              >
                <Video className="w-4 h-4" />
                Vidéo
              </Label>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="border-slate-700"
              data-testid="cancel-post-button"
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={loading || (mode === "story" ? !mediaPreview : !content.trim())}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
              data-testid="submit-post-button"
            >
              {loading
                ? "Publication..."
                : mode === "story"
                ? "Publier la story"
                : mode === "poll"
                ? "Publier le sondage"
                : "Publier"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
