// src/components/AddStoryModal.tsx
import { useState } from "react";
import { X, Camera, Image as ImageIcon, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import axios from "axios";
import { API } from "../App";
import { SURFACE, TEXT, OUTLINE, ACCENT_GRADIENT } from "@/lib/theme";
import { useTranslation } from "react-i18next";

interface AddStoryModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddStoryModal({ onClose, onSuccess }: AddStoryModalProps) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    // Vérification type
    if (!selected.type.startsWith("image/") && !selected.type.startsWith("video/")) {
      toast.error(t("addstory.err_type"));
      return;
    }

    // Vérification taille (10 Mo max)
    if (selected.size > 10 * 1024 * 1024) {
      toast.error(t("addstory.err_size"));
      return;
    }

    setFile(selected);

    // Prévisualisation
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(selected);
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      await axios.post(`${API}/stories/`, formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      toast.success(t("addstory.published"));
      // Rafraîchit immédiatement le bandeau des stories (sans recharger la page).
      window.dispatchEvent(new CustomEvent("nexus:realtime", { detail: { type: "story" } }));
      onSuccess();
    } catch (err: any) {
      console.error("Erreur upload story :", err);
      if (err.response?.status === 401) {
        toast.error(t("addstory.session_expired"));
      } else {
        toast.error(t("addstory.err_publish"));
      }
    } finally {
      setUploading(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setPreview(null);
    onClose();
  };

  return (
    <Dialog open onOpenChange={handleClose}>
      <DialogContent
        className="text-white max-w-md select-none"
        style={{ background: SURFACE.container, border: `1px solid ${OUTLINE}` }}
      >
        <DialogHeader>
          {/* Pas de bouton de fermeture custom ici : DialogContent fournit déjà
              sa propre croix (X) en haut à droite → évite la « double croix ». */}
          <DialogTitle className="text-xl font-bold">{t("addstory.title")}</DialogTitle>
        </DialogHeader>

        <div className="mt-4">
          {!preview ? (
            <label
              className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-2xl cursor-pointer transition"
              style={{ borderColor: OUTLINE, background: SURFACE.low }}
            >
              <div className="flex flex-col items-center gap-4">
                <Camera className="w-12 h-12" style={{ color: TEXT.muted }} />
                <p style={{ color: TEXT.muted }}>{t("addstory.cta_add")}</p>
                <div className="flex gap-4">
                  <div className="flex items-center gap-2" style={{ color: TEXT.muted }}>
                    <ImageIcon className="w-5 h-5" />
                    <span className="text-sm">{t("addstory.image")}</span>
                  </div>
                  <div className="flex items-center gap-2" style={{ color: TEXT.muted }}>
                    <Video className="w-5 h-5" />
                    <span className="text-sm">{t("addstory.video")}</span>
                  </div>
                </div>
              </div>
              <input
                type="file"
                accept="image/*,video/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          ) : (
            <div className="space-y-4">
              <div className="relative">
                {file?.type.startsWith("image/") ? (
                  <img src={preview} alt="Preview" className="w-full rounded-2xl" />
                ) : (
                  <video src={preview} controls className="w-full rounded-2xl" />
                )}
                <button
                  onClick={() => {
                    setFile(null);
                    setPreview(null);
                  }}
                  className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 rounded-full p-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <Button
                onClick={handleUpload}
                disabled={uploading}
                className="w-full font-semibold rounded-xl transition-all active:scale-95 hover:opacity-90"
                style={{ background: ACCENT_GRADIENT, color: TEXT.onAccent }}
              >
                {uploading ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    <span>{t("addstory.publishing")}</span>
                  </div>
                ) : (
                  t("addstory.publish")
                )}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}