// src/components/AddStoryModal.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { API } from "../App";

export default function AddStoryModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    if (!file) return toast.error("Choisis une image/vidéo");

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API}/stories/`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (res.ok) {
        toast.success("Story publiée ! Visible 24h");
        onSuccess();
      } else {
        toast.error("Erreur upload");
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-800">
        <DialogHeader>
          <DialogTitle className="text-white">Ajouter une story</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <input
            type="file"
            accept="image/*,video/*"
            onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
            className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyan-500 file:text-white hover:file:bg-cyan-600"
          />

          {file && (
            <div className="text-center">
              <Button onClick={handleUpload} disabled={uploading} className="bg-gradient-to-r from-cyan-500 to-blue-500">
                {uploading ? "Publication..." : "Publier la story"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}