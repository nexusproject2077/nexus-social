// src/components/StoriesFeed.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import StoryViewer from "./StoryViewer";
import AddStoryModal from "./AddStoryModal";
import { API } from "../App";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface LiveSession {
  host_id: string;
  host_username: string;
  host_profile_pic?: string;
  room_id: string;
  started_at?: string;
}

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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stories, setStories] = useState<StoryGroup[]>([]);
  const [lives, setLives] = useState<LiveSession[]>([]);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null);
  const [showAddStory, setShowAddStory] = useState(false);

  const fetchLives = async () => {
    try {
      const res = await axios.get(`${API}/live/active`);
      setLives(Array.isArray(res.data) ? res.data : []);
    } catch {
      setLives([]);
    }
  };

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
      console.error(t("error_fetch_stories"), err);
      if (err.response?.status === 401) {
        toast.error(t("session_expired_short"));
        localStorage.removeItem("token");
        window.location.href = "/auth";
      }
      setStories([]);
    }
  };

  useEffect(() => {
    fetchStories();
    fetchLives();
    const t = setInterval(fetchLives, 30000);   // rafraîchit les directs
    const ts = setInterval(fetchStories, 45000); // rafraîchit les stories

    // Auto-refetch « façon React Query » : au retour sur l'onglet et via WebSocket.
    const onFocus = () => { fetchStories(); fetchLives(); };
    const onVisible = () => { if (document.visibilityState === "visible") onFocus(); };
    const onRealtime = (e: any) => {
      const type = e?.detail?.type;
      if (type === "new_story" || type === "story" || type === "live_started" || type === "new_live") { fetchStories(); fetchLives(); }
    };
    const onResync = () => { fetchStories(); fetchLives(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("nexus:realtime", onRealtime as EventListener);
    window.addEventListener("nexus:resync", onResync);
    return () => {
      clearInterval(t); clearInterval(ts);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("nexus:realtime", onRealtime as EventListener);
      window.removeEventListener("nexus:resync", onResync);
    };
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
        className="flex gap-4 overflow-x-auto py-4 px-4 pb-2 select-none"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
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

        {/* Passer en direct (accessible aussi sur mobile) */}
        <button
          onClick={() => navigate("/live")}
          className="flex flex-col items-center gap-2 flex-shrink-0 group"
        >
          <div className="p-0.5 rounded-full" style={{ background: "linear-gradient(135deg,#ef4444,#f97316)" }}>
            <div
              className="w-14 h-14 lg:w-16 lg:h-16 rounded-full border-2 overflow-hidden flex items-center justify-center"
              style={{ backgroundColor: "#171f33", borderColor: "#0b1326" }}
            >
              <span className="material-symbols-outlined text-2xl transition-transform group-hover:scale-110" style={{ color: "#ef4444" }}>
                sensors
              </span>
            </div>
          </div>
          <span className="text-[9px] lg:text-[10px] font-medium" style={{ color: "#859397" }}>{t("nav_live")}</span>
        </button>

        {/* Directs en cours (abonnements) */}
        {lives.map((live) => (
          <button
            key={live.room_id}
            onClick={() => navigate(`/live/${live.room_id}`)}
            className="flex flex-col items-center gap-2 flex-shrink-0 group relative"
          >
            <div className="p-0.5 lg:p-1 rounded-full" style={{ background: "linear-gradient(135deg,#ef4444,#f97316)" }}>
              <div className="w-14 h-14 lg:w-16 lg:h-16 rounded-full border-2 overflow-hidden" style={{ borderColor: "#0b1326", backgroundColor: "#222a3d" }}>
                {live.host_profile_pic ? (
                  <img src={live.host_profile_pic} alt={live.host_username} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center font-bold text-sm" style={{ background: "linear-gradient(135deg,#ef4444,#f97316)", color: "#fff" }}>
                    {live.host_username?.[0]?.toUpperCase() || "?"}
                  </div>
                )}
              </div>
            </div>
            <span className="absolute top-8 lg:top-10 left-1/2 -translate-x-1/2 px-1.5 rounded text-[8px] font-black tracking-wide" style={{ background: "#ef4444", color: "#fff" }}>
              LIVE
            </span>
            <span className="text-[9px] lg:text-[10px] max-w-[64px] truncate" style={{ color: "#dae2fd" }}>
              {live.host_username}
            </span>
          </button>
        ))}

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
