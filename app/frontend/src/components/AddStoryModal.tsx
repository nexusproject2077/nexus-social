import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { API } from "../App";

export default function AddStoryModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async () => {
    if (!file) {
      toast.error("Choisis une image ou vidéo");
      return;
    }

    const token = localStorage.getItem('access_token'); // Récupère le token JWT
    if (!token) {
      toast.error("Vous devez être connecté pour publier une story.");
      // Optionnel : Rediriger l'utilisateur vers la page de connexion
      onClose(); // Ferme la modale si non connecté
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API}/stories/`, {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${token}` // AJOUT DE L'EN-TÊTE D'AUTHENTIFICATION
          // 'Content-Type': 'multipart/form-data' n'est pas nécessaire avec FormData, le navigateur le définit automatiquement
        },
        // credentials: "include" n'est pas nécessaire ici car nous utilisons un token
        body: formData,
      });

      if (res.ok) {
        toast.success("Story publiée !");
        onSuccess();
      } else {
        const errorText = await res.text();
        console.error("Erreur serveur:", res.status, errorText);
        toast.error(`Erreur upload – ${res.status}: ${errorText.substring(0, 100)}...`); // Affiche un extrait de l'erreur
        // Gérer spécifiquement le cas 401/403 pour un token expiré ou invalide
        if (res.status === 401 || res.status === 403) {
            localStorage.removeItem('access_token'); // Efface le token invalide
            // Optionnel : Rediriger l'utilisateur pour qu'il se reconnecte
        }
      }
    } catch (err) {
      console.error("Erreur réseau:", err);
      toast.error("Erreur réseau lors de la publication de la story.");
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

        <div className="space-y-6 py-4">
          <input
            type="file"
            accept="image/*,video/*"
            onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
            className="block w-full text-sm text-slate-400 file:mr-4 file:py-3 file:px-6 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyan-500 file:text-white hover:file:bg-cyan-600"
          />

          {file && (
            <div className="text-center">
              <Button
                onClick={handleUpload}
                disabled={uploading}
                className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
              >
                {uploading ? "Publication..." : "Publier la story"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
