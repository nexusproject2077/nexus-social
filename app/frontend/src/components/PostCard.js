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

  const handleMediaChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setMedia(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setMediaPreview(reader.result);
      // Le reader.result est déjà en base64
    };
    reader.readAsDataURL(file);

    if (file.type.startsWith('image')) {
      setMediaType('image');
    } else if (file.type.startsWith('video')) {
      setMediaType('video');
    }
  };

  const handleRemoveMedia = () => {
    setMedia(null);
    setMediaPreview(null);
    setMediaType(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim()) {
      toast.error("Le contenu ne peut pas être vide");
      return;
    }

    setLoading(true);
    try {
      // Prépare les données au format JSON attendu par le backend
      const postData = {
        content: content,
        media_type: mediaType || null,
        media_url: mediaPreview || null, // Base64 string
      };

      const response = await axios.post(`${API}/posts`, postData, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      onPostCreated(response.data);
      setContent("");
      setMedia(null);
      setMediaPreview(null);
      setMediaType(null);
      toast.success("Publication créée avec succès");
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
          <DialogTitle className="text-xl">Créer une publication</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="content">Contenu</Label>
            <Textarea
              id="content"
              data-testid="create-post-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Que voulez-vous partager?"
              className="bg-slate-800 border-slate-700 text-white min-h-32"
              rows={5}
            />
          </div>

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
                className="absolute top-2 right-2 bg-slate-900/80 hover:bg-slate-800"
                data-testid="remove-media-button"
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
              disabled={loading || !content.trim()}
              className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
              data-testid="submit-post-button"
            >
              {loading ? "Publication..." : "Publier"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
