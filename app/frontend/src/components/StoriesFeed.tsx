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
  stories: { id: string; media_url: string; media_type: "image" | "video" }[];
  last_story_time?: string;
}

export default function StoriesFeed() {
  const [stories, setStories] = useState<StoryGroup[]>([]);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null);
  const [showAddStory, setShowAddStory] = useState(false);

  const fetchStories = async () => {
    try {
      const response = await axios.get(`${API}/stories/feed`);
      if (Array.isArray(response.data)) {
        setStories(response.data);
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
    fetchStories(); // Rafraîchit après ajout
  };

  const openStoryViewer = (index: number) => {
    setSelectedGroupIndex(index);
  };

  const closeStoryViewer = () => {
    setSelectedGroupIndex(null);
  };

  return (
    <>
      <div className="flex gap-4 overflow-x-auto py-4 px-4 bg-slate-950 border-b border-slate-800 scrollbar-hide">
        {/* Toi */}
        <button
          onClick={() => setShowAddStory(true)}
          className="flex flex-col items-center gap-1 flex-shrink-0 group"
        >
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

        {/* Autres stories */}
        {Array.isArray(stories) &&
          stories.map((group, index) => (
            <button
              key={group.user_id || index}
              onClick={() => openStoryViewer(index)}
              className="flex flex-col items-center gap-1 flex-shrink-0 group"
            >
              <div className="w-16 h-16 rounded-full ring-2 ring-cyan-500 p-0.5">
                <div className="w-full h-full rounded-full overflow-hidden">
                  <Avatar className="w-full h-full">
                    <AvatarImage src={group.profile_pic} />
                    <AvatarFallback>
                      {group.username?.[0]?.toUpperCase() || '?'}
                    </AvatarFallback>
                  </Avatar>
                </div>
              </div>
              <span className="text-xs max-w-16 truncate text-slate-300">
                {group.username || 'Unknown'}
              </span>
            </button>
          ))}
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
