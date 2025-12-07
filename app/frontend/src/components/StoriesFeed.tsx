// src/components/StoriesFeed.tsx
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import StoryViewer from "./StoryViewer";
import AddStoryModal from "./AddStoryModal";
import { API } from "../App";

interface StoryGroup {
  user: { id: string; username: string; avatar?: string };
  stories: { id: string; media_url: string; media_type: "image" | "video" }[];
}

export default function StoriesFeed() {
  const [stories, setStories] = useState<StoryGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<StoryGroup | null>(null);
  const [showAddStory, setShowAddStory] = useState(false);

  const fetchStories = async () => {
    const token = localStorage.getItem('token'); // MODIFIÉ : Utilise 'token'

    if (!token) {
      console.warn("Utilisateur non connecté. Impossible de récupérer les stories.");
      setStories([]);
      return;
    }

    try {
      const response = await fetch(`${API}/stories/feed`, {
        method: "GET",
        headers: {
          'Authorization': `Bearer ${token}`
        },
        // credentials: "include" est supprimé
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          console.error("Authentification échouée ou token expiré. Veuillez vous reconnecter.");
          localStorage.removeItem('token'); // MODIFIÉ : Supprime 'token'
          // Optionnel : Rediriger l'utilisateur vers la page de connexion
        }
        throw new Error(`Erreur HTTP: ${response.status}`);
      }

      const data = await response.json();
      if (Array.isArray(data)) {
        setStories(data);
      } else {
        console.warn("Stories feed pas un tableau :", data);
        setStories([]);
      }
    } catch (err) {
      console.error("Erreur fetch stories :", err);
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

  return (
    <>
      <div className="flex gap-4 overflow-x-auto py-4 px-4 bg-slate-950 border-b border-slate-800 scrollbar-hide">
        {/* Toi */}
        <button onClick={() => setShowAddStory(true)} className="flex flex-col items-center gap-1 flex-shrink-0 group">
          <div className="relative">
            <Avatar className="w-16 h-16 ring-2 ring-slate-700 group-hover:ring-cyan-500 transition">
              <AvatarFallback className="bg-slate-800 text-2xl">+</AvatarFallback>
            </Avatar>
            <div className="absolute bottom-0 right-0 w-8 h-8 bg-cyan-500 rounded-full border-4 border-slate-950 flex items-center justify-center group-hover:scale-110 transition">
              <Plus className="w-5 h-5 text-white" />
            </div>
          </div>
          <span className="text-xs text-slate-400">Toi</span>
        </button>

        {/* Les autres – PROTECTION .map() */}
        {Array.isArray(stories) && stories.map((group) => (
          <button
            key={group.user.id}
            onClick={() => setSelectedGroup(group)}
            className="flex flex-col items-center gap-1 flex-shrink-0 group"
          >
            <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-pink-500 via-red-500 to-yellow-500 p-0.5">
              <div className="w-full h-full rounded-full overflow-hidden">
                <Avatar className="w-full h-full">
                  <AvatarImage src={group.user.avatar} />
                  <AvatarFallback>{group.user.username[0].toUpperCase()}</AvatarFallback>
                </Avatar>
              </div>
            </div>
            <span className="text-xs max-w-16 truncate text-slate-300">{group.user.username}</span>
          </button>
        ))}
      </div>

      {selectedGroup && <StoryViewer group={selectedGroup} onClose={() => setSelectedGroup(null)} />}
      {showAddStory && <AddStoryModal onClose={() => setShowAddStory(false)} onSuccess={handleStoryAdded} />}
    </>
  );
}
