// src/components/StoryViewer.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Avatar } from "@/components/ui/avatar";
import { X, ChevronLeft, ChevronRight } from 'lucide-react'; // Ajout des icônes de navigation

interface Story {
  id: string;
  media_url: string;
  media_type: "image" | "video";
}

interface StoryGroup {
  user: { id: string; username: string; avatar?: string };
  stories: Story[];
}

interface StoryViewerProps {
  allStories: StoryGroup[]; // Tous les groupes d'histoires disponibles
  initialGroupIndex: number; // L'index du groupe à afficher initialement
  onClose: () => void;
}

const StoryViewer: React.FC<StoryViewerProps> = ({ allStories, initialGroupIndex, onClose }) => {
  const [currentGroupIndex, setCurrentGroupIndex] = useState(initialGroupIndex);
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  // viewerRef n'est plus nécessaire pour le onClick global car nous utilisons les overlays
  // const viewerRef = useRef<HTMLDivElement>(null);

  const currentGroup = allStories[currentGroupIndex];
  const currentStory = currentGroup?.stories[currentStoryIndex];

  // Reset story index when group changes
  useEffect(() => {
    setCurrentStoryIndex(0);
  }, [currentGroupIndex]);

  // Handle video playback
  useEffect(() => {
    if (videoRef.current) {
      if (currentStory?.media_type === 'video') {
        videoRef.current.play().catch(e => console.error("Video autoplay blocked:", e));
      } else {
        // Pause if it was a video and now it's an image
        videoRef.current.pause();
      }
    }
  }, [currentStory]); // Re-déclenche quand la story change

  const handleNextStory = useCallback(() => {
    if (currentGroup) {
      if (currentStoryIndex < currentGroup.stories.length - 1) {
        setCurrentStoryIndex(prev => prev + 1); // Prochaine story dans le même groupe
      } else {
        // Dernière story du groupe, passer au groupe suivant
        if (currentGroupIndex < allStories.length - 1) {
          setCurrentGroupIndex(prev => prev + 1);
          setCurrentStoryIndex(0); // Commencer par la première story du nouveau groupe
        } else {
          onClose(); // Plus d'histoires, fermer le viewer
        }
      }
    }
  }, [currentGroup, currentStoryIndex, currentGroupIndex, allStories.length, onClose]);

  const handlePrevStory = useCallback(() => {
    if (currentGroup) {
      if (currentStoryIndex > 0) {
        setCurrentStoryIndex(prev => prev - 1); // Story précédente dans le même groupe
      } else {
        // Première story du groupe, passer au groupe précédent
        if (currentGroupIndex > 0) {
          setCurrentGroupIndex(prev => prev - 1);
          // Aller à la dernière story du groupe précédent
          const prevGroup = allStories[currentGroupIndex - 1];
          setCurrentStoryIndex(prevGroup ? prevGroup.stories.length - 1 : 0);
        } else {
          // Si on est déjà sur la première story du premier groupe, ne rien faire
          // ou fermer si c'est le comportement souhaité. Pour l'instant, on ne fait rien.
        }
      }
    }
  }, [currentGroup, currentStoryIndex, currentGroupIndex, allStories]);


  // Si aucun groupe ou story n'est trouvé, fermer
  if (!currentGroup || !currentStory) {
    onClose();
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center p-4">
      <div
        // Supprimé: ref={viewerRef} et onClick={handleScreenClick} du conteneur principal
        className="relative w-full max-w-md h-full max-h-[80vh] bg-slate-900 rounded-lg overflow-hidden flex flex-col"
      >
        {/* Bouton Fermer */}
        <button onClick={onClose} className="absolute top-4 right-4 z-10 text-white bg-black/50 rounded-full p-2 hover:bg-black/70 transition">
          <X size={24} />
        </button>

        {/* Header de l'histoire */}
        <div className="absolute top-0 left-0 right-0 p-4 flex items-center bg-gradient-to-b from-black/60 to-transparent z-10">
          <Avatar className="w-8 h-8 mr-2">
            <img src={currentGroup.user.avatar || "https://via.placeholder.com/150"} alt={currentGroup.user.username} />
            {/* Fallback component omitted for brevity */}
          </Avatar>
          <span className="text-white font-semibold">{currentGroup.user.username}</span>
          {/* Barres de progression des stories */}
          <div className="flex-1 flex gap-1 ml-4 h-1">
            {currentGroup.stories.map((_, idx) => (
              <div key={idx} className={`flex-1 bg-gray-600 rounded-full ${idx === currentStoryIndex ? 'bg-white' : ''}`}>
                {/* Une barre de progression plus dynamique serait ici */}
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
              onEnded={handleNextStory} // Passe à la story suivante quand la vidéo se termine
              controls // Ajout des contrôles par défaut pour la vidéo
              playsInline
              preload="auto"
            />
          )}
        </div>

        {/* Overlays pour les clics de navigation : couvre toute la hauteur */}
        {/* Important: Ces overlays doivent être positionnés au-dessus du contenu de la story */}
        <div className="absolute inset-y-0 left-0 w-1/2 cursor-pointer z-10" onClick={handlePrevStory} />
        <div className="absolute inset-y-0 right-0 w-1/2 cursor-pointer z-10" onClick={handleNextStory} />
        
        {/* Flèches de navigation (désactivées car le clic sur l'écran est plus Insta-like) */}
        {/* Si vous voulez les flèches, assurez-vous qu'elles ont un z-index plus élevé que les overlays */}
        {/*
        <button onClick={handlePrevStory} className="absolute left-4 top-1/2 -translate-y-1/2 z-20 text-white bg-black/50 rounded-full p-2 hover:bg-black/70 transition">
          <ChevronLeft size={24} />
        </button>
        <button onClick={handleNextStory} className="absolute right-4 top-1/2 -translate-y-1/2 z-20 text-white bg-black/50 rounded-full p-2 hover:bg-black/70 transition">
          <ChevronRight size={24} />
        </button>
        */}
      </div>
    </div>
  );
};

export default StoryViewer;
