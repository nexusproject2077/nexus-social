// src/components/StoryViewer.tsx
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

interface StoryGroup {
  user: { username: string; avatar?: string };
  stories: { id: number; media_url: string; media_type: "image" | "video" }[];
}

export default function StoryViewer({ group, onClose }: { group: StoryGroup; onClose: () => void }) {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (currentIndex < group.stories.length - 1) {
        setCurrentIndex(i => i + 1);
      } else {
        onClose();
      }
    }, 5000); // 5 secondes par story
    return () => clearTimeout(timer);
  }, [currentIndex, group.stories.length]);

  const current = group.stories[currentIndex];

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-full w-screen h-screen p-0 bg-black">
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Progress bar */}
          <div className="absolute top-0 left-0 right-0 flex gap-1 p-3 z-10">
            {group.stories.map((_, i) => (
              <div key={i} className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-500"
                  style={{ width: i < currentIndex ? "100%" : i === currentIndex ? "60%" : "0%" }}
                />
              </div>
            ))}
          </div>

          {/* Close button */}
          <button onClick={onClose} className="absolute top-4 right-4 z-20 text-white">
            <X className="w-8 h-8" />
          </button>

          {/* Media */}
          {current.media_type === "image" ? (
            <img src={current.media_url} className="max-h-full max-w-full object-contain" />
          ) : (
            <video src={current.media_url} autoPlay loop className="max-h-full max-w-full object-contain" />
          )}

          {/* User info */}
          <div className="absolute bottom-10 left-6 flex items-center gap-3 text-white">
            <img src={group.user.avatar || "/default-avatar.png"} className="w-10 h-10 rounded-full" />
            <span className="font-medium">{group.user.username}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}