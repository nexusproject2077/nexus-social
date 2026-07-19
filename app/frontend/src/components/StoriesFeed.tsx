// src/components/StoriesFeed.tsx
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
  has_unviewed?: boolean;
}

export default function StoriesFeed() {
  const [stories, setStories] = useState<StoryGroup[]>([]);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null);
  const [showAddStory, setShowAddStory] = useState(false);

  const fetchStories = async () => {
    try {
      const response = await axios.get(`${API}/stories/feed`);
      if (Array.isArray(response.data)) {
        const storiesWithViewedState = response.data.map((group: StoryGroup) => ({
          ...group,
          has_unviewed: group.stories.some((story) => !story.has_viewed),
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

  const openStoryViewer = (index: number) => setSelectedGroupIndex(index);

  const closeStoryViewer = () => {
    setSelectedGroupIndex(null);
    fetchStories();
  };

  return (
    <>
      <section
        className="flex gap-4 overflow-x-auto py-4 px-4 pb-2"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {/* Add Story */}
        <button
          onClick={() => setShowAddStory(true)}
          className="flex flex-col items-center gap-2 flex-shrink-0 group"
        >
          <div
            className="p-0.5 rounded-full"
            style={{
              background: "linear-gradient(135deg, var(--nexus-accent), #3b82f6)",
            }}
          >
            <div
              className="w-14 h-14 lg:w-16 lg:h-16 rounded-full border-2 overflow-hidden relative flex items-center justify-center"
              style={{
                backgroundColor: "#171f33",
                borderColor: "#0b1326",
              }}
            >
              <span
                className="material-symbols-outlined text-2xl transition-transform group-hover:scale-110"
                style={{ color: "var(--nexus-accent)" }}
              >
                add
              </span>
            </div>
          </div>
          <span
            className="text-[9px] lg:text-[10px] font-medium"
            style={{ color: "#859397" }}
          >
            Votre story
          </span>
        </button>

        {/* Other Users' Stories */}
        {Array.isArray(stories) &&
          stories.map((group, index) => {
            const hasUnviewed = group.has_unviewed;
            return (
              <button
                key={group.user_id || index}
                onClick={() => openStoryViewer(index)}
                className="flex flex-col items-center gap-2 flex-shrink-0 group"
              >
                <div
                  className="p-0.5 lg:p-1 rounded-full transition-all duration-300"
                  style={{
                    background: hasUnviewed
                      ? "linear-gradient(135deg, var(--nexus-accent), #3b82f6)"
                      : "#222a3d",
                    opacity: hasUnviewed ? 1 : 0.7,
                  }}
                >
                  <div
                    className="w-14 h-14 lg:w-16 lg:h-16 rounded-full border-2 overflow-hidden"
                    style={{
                      borderColor: "#0b1326",
                      backgroundColor: "#222a3d",
                    }}
                  >
                    {group.profile_pic ? (
                      <img
                        src={group.profile_pic}
                        alt={group.username}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div
                        className="w-full h-full flex items-center justify-center font-bold text-sm"
                        style={{
                          background: "linear-gradient(135deg, var(--nexus-accent), #3b82f6)",
                          color: "#00363e",
                        }}
                      >
                        {group.username?.[0]?.toUpperCase() || "?"}
                      </div>
                    )}
                  </div>
                </div>
                {hasUnviewed && (
                  <div
                    className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 animate-pulse hidden"
                    style={{
                      backgroundColor: "var(--nexus-accent)",
                      borderColor: "#0b1326",
                    }}
                  />
                )}
                <span
                  className="text-[9px] lg:text-[10px] max-w-[64px] truncate transition-colors"
                  style={{ color: hasUnviewed ? "#dae2fd" : "#859397" }}
                >
                  {group.username || "Unknown"}
                </span>
              </button>
            );
          })}
      </section>

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
