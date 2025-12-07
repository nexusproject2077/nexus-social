// src/components/StoriesFeed.tsx
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import StoryViewer from "./StoryViewer";
import { API_URL } from "@/lib/constants"; // vérifie que tu as cette constante ou remplace par ton URL

interface StoryGroup {
  user: { id: number; username: string; avatar?: string };
  stories: { id: number; media_url: string; media_type: "image" | "video" }[];
}

export default function StoriesFeed() {
  const [stories, setStories] = useState<StoryGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<StoryGroup | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/stories/feed`, { credentials: "include" })
      .then(r => r.json())
      .then(setStories)
      .catch(() => {});
  }, []);

  return (
    <>
      <div className="flex gap-4 overflow-x-auto py-4 px-4 bg-background border-b scrollbar-hide">
        {/* Ta story à toi */}
        <button className="flex flex-col items-center gap-1 flex-shrink-0">
          <div className="relative">
            <Avatar className="w-16 h-16 ring-2 ring-border">
              <AvatarFallback className="bg-muted text-2xl">+</AvatarFallback>
            </Avatar>
            <div className="absolute bottom-0 right-0 w-8 h-8 bg-blue-600 rounded-full border-4 border-background flex items-center justify-center">
              <Plus className="w-5 h-5 text-white" />
            </div>
          </div>
          <span className="text-xs text-muted-foreground">Toi</span>
        </button>

        {/* Stories des autres */}
        {stories.map((group) => (
          <button
            key={group.user.id}
            onClick={() => setSelectedGroup(group)}
            className="flex flex-col items-center gap-1 flex-shrink-0 group"
          >
            <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-pink-500 via-red-500 to-yellow-500 p-0.5">
              <Avatar className="w-full h-full">
                <AvatarImage src={group.user.avatar} />
                <AvatarFallback>{group.user.username[0].toUpperCase()}</AvatarFallback>
              </Avatar>
            </div>
            <span className="text-xs max-w-16 truncate">{group.user.username}</span>
          </button>
        ))}
      </div>

      {/* Modal viewer */}
      {selectedGroup && (
        <StoryViewer group={selectedGroup} onClose={() => setSelectedGroup(null)} />
      )}
    </>
  );
}