// src/components/StoriesFeed.tsx
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import axios from "axios";
import StoryViewer from "./StoryViewer";
import AddStoryModal from "./AddStoryModal";
import { API } from "../App";
import { toast } from "sonner";

interface StoryGroup {
  user_id: string;
  username: string;
  profile_pic?: string;
  stories: { 
    id: string; 
    media_url: string; 
    media_type: "image" | "video";
    has_viewed?: boolean;
  }[];
  last_story_time?: string;
  has_unviewed?: boolean; // Indicateur si le groupe a des stories non vues
}

export default function StoriesFeed() {
  const [stories, setStories] = useState<StoryGroup[]>([]);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null);
  const [showAddStory, setShowAddStory] = useState(false);

  const fetchStories = async () => {
    try {
      const response = await axios.get(`${API}/stories/feed`);
      if (Array.isArray(response.data)) {
        // Calculer si chaque groupe a des stories non vues
        const storiesWithViewedState = response.data.map((group: StoryGroup) => ({
          ...group,
          has_unviewed: group.stories.some(story => !story.has_viewed)
        }));
        setStories(storiesWithViewedState);
      } else {
        setStories([]);
      }
    } catch (err: any) {
      console.error("Erreur fetch stories :", err);
      if (err.response?.status === 401) {
        toast.error("Session expirée");
        localStorage.removeItem("token");
        window.location.href = "/auth";
      }
      setStories([]);
    }
  };

  useEffect(() => {
    fetchStories();
  }, []);

  const handleStoryAdded = () => {
    setShowAddStory(false);
    fetchStories();
  };

  const openStoryViewer = (index: number) => {
    setSelectedGroupIndex(index);
  };

  const closeStoryViewer = () => {
    setSelectedGroupIndex(null);
    // Rafraîchir pour mettre à jour l'état "vu"
    fetchStories();
  };

  return (
    <>
      <div className="flex gap-4 overflow-x-auto py-4 px-4 bg-slate-950 border-b border-slate-800 scrollbar-hide">
        {/* Bouton "Ajouter une story" */}
        <button
          onClick={() => setShowAddStory(true)}
          className="flex flex-col items-center gap-2 flex-shrink-0 group"
        >
          <div className="relative">
            <Avatar className="w-16 h-16 ring-2 ring-slate-700 group-hover:ring-cyan-400 transition-all duration-300">
              <AvatarFallback className="bg-gradient-to-br from-slate-800 to-slate-700 text-slate-400 text-2xl font-bold">
                +
              </AvatarFallback>
            </Avatar>
            <div className="absolute bottom-0 right-0 w-6 h-6 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full border-2 border-slate-950 flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg">
              <Plus className="w-4 h-4 text-white" strokeWidth={3} />
            </div>
          </div>
          <span className="text-xs text-slate-400 font-medium">Toi</span>
        </button>

        {/* Stories des autres utilisateurs */}
        {Array.isArray(stories) &&
          stories.map((group, index) => {
            const hasUnviewed = group.has_unviewed;
            
            return (
              <button
                key={group.user_id || index}
                onClick={() => openStoryViewer(index)}
                className="flex flex-col items-center gap-2 flex-shrink-0 group"
              >
                <div className="relative">
                  {/* Cercle extérieur : bleu si non vu, gris si déjà vu */}
                  <div 
                    className={`w-[68px] h-[68px] rounded-full p-0.5 transition-all duration-300 ${
                      hasUnviewed 
                        ? 'bg-gradient-to-tr from-cyan-500 via-blue-500 to-purple-500 group-hover:scale-105' 
                        : 'bg-gradient-to-tr from-slate-600 to-slate-500 opacity-70'
                    }`}
                  >
                    <div className="w-full h-full rounded-full bg-slate-950 p-0.5">
                      <Avatar className="w-full h-full">
                        <AvatarImage 
                          src={group.profile_pic} 
                          className="object-cover"
                        />
                        <AvatarFallback className="bg-slate-800 text-slate-300">
                          {group.username?.[0]?.toUpperCase() || '?'}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                  </div>
                  
                  {/* Indicateur "nouveau" */}
                  {hasUnviewed && (
                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-cyan-500 rounded-full border-2 border-slate-950 animate-pulse" />
                  )}
                </div>
                <span 
                  className={`text-xs max-w-[68px] truncate transition-colors ${
                    hasUnviewed ? 'text-slate-200 font-medium' : 'text-slate-500'
                  }`}
                >
                  {group.username || 'Unknown'}
                </span>
              </button>
            );
          })}
      </div>

      {selectedGroupIndex !== null && (
        <StoryViewer
          allStories={stories}
          initialGroupIndex={selectedGroupIndex}
          onClose={closeStoryViewer}
          onDeleteStory={fetchStories}
        />
      )}

      {showAddStory && (
        <AddStoryModal
          onClose={() => setShowAddStory(false)}
          onSuccess={handleStoryAdded}
        />
      )}
    </>
  );
}
