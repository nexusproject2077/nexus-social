tsx
// src/components/StoryViewer.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Avatar } from "@/components/ui/avatar";
import { X, ChevronLeft, ChevronRight, MoreVertical, Trash2 } from 'lucide-react'; // Ajout MoreVertical, Trash2
import { toast } from "sonner"; // Pour les notifications
import { API } from "../App"; // Assurez-vous que l'API est importée

interface Story {
  id: string;
  media_url: string;
  media_type: "image" | "video";
  user_id: string; // Ajout pour vérifier si l'utilisateur est l'auteur
}

interface StoryGroup {
  user: { id: string; username: string; avatar?: string };
  stories: Story[];
}

interface StoryViewerProps {
  allStories: StoryGroup[];
  initialGroupIndex: number;
  onClose: () => void;
  onDeleteStory: () => void; // Nouvelle prop pour rafraîchir les stories après suppression
}

const StoryViewer: React.FC<StoryViewerProps> = ({ allStories, initialGroupIndex, onClose, onDeleteStory }) => {
  const [currentGroupIndex, setCurrentGroupIndex] = useState(initialGroupIndex);
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [showOptions, setShowOptions] = useState(false); // État pour afficher/masquer les options
  const [showConfirmModal, setShowConfirmModal] = useState(false); // État pour la modale de confirmation
  const videoRef = useRef<HTMLVideoElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null); // Ref pour le bouton d'options

  const currentGroup = allStories[currentGroupIndex];
  const currentStory = currentGroup?.stories[currentStoryIndex];

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setCurrentUserId(payload.sub);
      } catch (e) {
        console.error("Failed to decode token:", e);
        setCurrentUserId(null);
      }
    }
  }, []);

  useEffect(() => {
    setCurrentStoryIndex(0);
    setShowOptions(false);
    setShowConfirmModal(false);
  }, [currentGroupIndex]);

  useEffect(() => {
    if (videoRef.current) {
      if (currentStory?.media_type === 'video') {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(e => console.error("Video autoplay blocked:", e));
      } else {
        videoRef.current.pause();
      }
    }
  }, [currentStory]);

  const handleNextStory = useCallback(() => {
    if (currentGroup) {
      if (currentStoryIndex < currentGroup.stories.length - 1) {
        setCurrentStoryIndex(prev => prev + 1);
      } else {
        if (currentGroupIndex < allStories.length - 1) {
          setCurrentGroupIndex(prev => prev + 1);
          setCurrentStoryIndex(0);
        } else {
          onClose();
        }
      }
    }
  }, [currentGroup, currentStoryIndex, currentGroupIndex, allStories.length, onClose]);

  const handlePrevStory = useCallback(() => {
    if (currentGroup) {
      if (currentStoryIndex > 0) {
        setCurrentStoryIndex(prev => prev - 1);
      } else {
        if (currentGroupIndex > 0) {
          setCurrentGroupIndex(prev => prev - 1);
          const prevGroup = allStories[currentGroupIndex - 1];
          setCurrentStoryIndex(prevGroup ? prevGroup.stories.length - 1 : 0);
        } else {
          // Ne rien faire si on est sur la première story du premier groupe
        }
      }
    }
  }, [currentGroup, currentStoryIndex, currentGroupIndex, allStories]);

  const handleDelete = async () => {
    if (!currentStory) return;

    const token = localStorage.getItem('token');
    if (!token) {
      toast.error("Vous devez être connecté pour supprimer une story.");
      return;
    }

    try {
      const response = await fetch(`${API}/stories/${currentStory.id}`, {
        method: "DELETE",
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        toast.success("Story supprimée avec succès !");
        setShowConfirmModal(false);
        setShowOptions(false);
        onDeleteStory();
        onClose();
      } else {
        const errorText = await response.text();
        console.error("Erreur serveur lors de la suppression:", response.status, errorText);
        toast.error(`Erreur suppression – ${response.status}: ${errorText.substring(0, 100)}...`);
      }
    } catch (err) {
      console.error("Erreur réseau lors de la suppression:", err);
      toast.error("Erreur réseau lors de la suppression de la story.");
    }
  };

  // Fermer les options si l'on clique en dehors
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (optionsButtonRef.current && !optionsButtonRef.current.contains(event.target as Node)) {
        setShowOptions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  if (!currentGroup || !currentStory) {
    onClose();
    return null;
  }

  const isAuthor = currentUserId === currentStory.user_id;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div
        className="relative w-full max-w-lg h-full max-h-[90vh] bg-slate-900 rounded-lg overflow-hidden flex flex-col shadow-lg"
      >
        {/* Conteneur pour les boutons en haut à droite (X et Options) */}
        <div className="absolute top-3 right-3 z-20 flex gap-2"> {/* MODIFIÉ ICI */}
          {isAuthor && (
            <div className="relative">
              <button
                ref={optionsButtonRef} {/* Ajout de la référence */}
                onClick={(e) => { e.stopPropagation(); setShowOptions(prev => !prev); }} {/* Empêche la propagation pour la navigation */}
                className="text-white bg-black/40 rounded-full p-1 hover:bg-black/60 transition focus:outline-none"
              >
                <MoreVertical size={20} />
              </button>
              {showOptions && (
                <div className="absolute top-full right-0 mt-2 w-32 bg-slate-800 rounded-md shadow-lg z-30">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowConfirmModal(true); setShowOptions(false); }} {/* Empêche la propagation */}
                    className="flex items-center w-full px-3 py-2 text-sm text-red-400 hover:bg-slate-700 rounded-md"
                  >
                    <Trash2 size={16} className="mr-2" /> Supprimer
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            onClick={onClose}
            className="text-white bg-black/40 rounded-full p-1 hover:bg-black/60 transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white"
          >
            <X size={20} />
          </button>
        </div>


        {/* Header de l'histoire (utilisateur et progression) */}
        <div className="absolute top-0 left-0 right-0 p-4 flex items-center bg-gradient-to-b from-black/60 to-transparent z-10">
          <Avatar className="w-8 h-8 mr-2 ring-1 ring-cyan-500">
            <img src={currentGroup.user.avatar || "https://placehold.co/150"} alt={currentGroup.user.username} /> {/* Utilisation de placehold.co */}
          </Avatar>
          <span className="text-white font-semibold text-sm">{currentGroup.user.username}</span>

          {/* Barres de progression des stories */}
          <div className="flex-1 flex gap-1 ml-4 h-1 items-center">
            {currentGroup.stories.map((_, idx) => (
              <div key={idx} className="flex-1 h-0.5 bg-slate-600 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-400"
                  style={{ width: idx < currentStoryIndex ? '100%' : idx === currentStoryIndex ? '50%' : '0%' }}
                ></div>
              </div>
            ))}
          </div>
        </div>

        {/* Contenu de la story (image/vidéo) */}
        <div className="flex-1 flex items-center justify-center bg-black">
          {currentStory.media_type === 'image' ? (
            <img src={currentStory.media_url} alt="Story" className="max-w-full max-h-full object-contain" />
          ) : (
            <video
              ref={videoRef}
              src={currentStory.media_url}
              className="max-w-full max-h-full object-contain"
              onEnded={handleNextStory}
              controls={false}
              autoPlay
              playsInline
              preload="auto"
            />
          )}
        </div>

        {/* Overlays pour les clics de navigation */}
        <div className="absolute inset-y-0 left-0 w-1/2 cursor-pointer z-10" onClick={handlePrevStory} />
        <div className="absolute inset-y-0 right-0 w-1/2 cursor-pointer z-10" onClick={handleNextStory} />
      </div>

      {/* Modale de confirmation de suppression */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-lg p-6 shadow-xl max-w-sm w-full text-center">
            <h3 className="text-xl font-semibold text-white mb-4">Confirmer la suppression</h3>
            <p className="text-slate-300 mb-6">Êtes-vous sûr de vouloir supprimer cette story ? Cette action est irréversible.</p>
            <div className="flex justify-center gap-4">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-5 py-2 rounded-md bg-slate-600 text-white hover:bg-slate-500 transition"
              >
                Annuler
              </button>
              <button
                onClick={handleDelete}
                className="px-5 py-2 rounded-md bg-red-600 text-white hover:bg-red-500 transition"
              >
                Supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoryViewer;

