// src/components/AddStoryModal.tsx
import { useState } from "react";
import { X, Camera, Image as ImageIcon, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import axios from "axios";
import { API } from "../App";
import { SURFACE, TEXT, OUTLINE, ACCENT_GRADIENT } from "@/lib/theme";

interface AddStoryModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddStoryModal({ onClose, onSuccess }: AddStoryModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    // Vérification type
    if (!selected.type.startsWith("image/") && !selected.type.startsWith("video/")) {
      toast.error("Seules les images et vidéos sont autorisées");
      return;
    }

    // Vérification taille (10 Mo max)
    if (selected.size > 10 * 1024 * 1024) {
      toast.error("Fichier trop lourd (max 10 Mo)");
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

      toast.success("Story publiée avec succès !");
      // Rafraîchit immédiatement le bandeau des stories (sans recharger la page).
      window.dispatchEvent(new CustomEvent("nexus:realtime", { detail: { type: "story" } }));
      onSuccess();
    } catch (err: any) {
      console.error("Erreur upload story :", err);
      if (err.response?.status === 401) {
        toast.error("Session expirée, veuillez vous reconnecter");
      } else {
        toast.error("Erreur lors de la publication de la story");
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
          <DialogTitle className="text-xl font-bold">Publier une story</DialogTitle>
        </DialogHeader>

        <div className="mt-4">
          {!preview ? (
            <label
              className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-2xl cursor-pointer transition"
              style={{ borderColor: OUTLINE, background: SURFACE.low }}
            >
              <div className="flex flex-col items-center gap-4">
                <Camera className="w-12 h-12" style={{ color: TEXT.muted }} />
                <p style={{ color: TEXT.muted }}>Cliquez pour ajouter une photo ou vidéo</p>
                <div className="flex gap-4">
                  <div className="flex items-center gap-2" style={{ color: TEXT.muted }}>
                    <ImageIcon className="w-5 h-5" />
                    <span className="text-sm">Image</span>
                  </div>
                  <div className="flex items-center gap-2" style={{ color: TEXT.muted }}>
                    <Video className="w-5 h-5" />
                    <span className="text-sm">Vidéo</span>
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
                    <span>Publication...</span>
                  </div>
                ) : (
                  "Publier la story"
                )}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}