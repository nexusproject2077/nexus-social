// src/components/StoryViewer.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Avatar } from "@/components/ui/avatar";
import { X, MoreVertical, Trash2 } from 'lucide-react';
import { toast } from "sonner";
import { API } from "../App";
import { useNavigate } from 'react-router-dom';

interface Story {
  id: string;
  media_url: string;
  media_type: "image" | "video";
  author_id?: string;
  has_viewed?: boolean;
}

interface StoryGroup {
  user_id: string;
  username: string;
  profile_pic?: string;
  stories: Story[];
}

interface StoryViewerProps {
  allStories: StoryGroup[];
  initialGroupIndex: number;
  onClose: () => void;
  onDeleteStory: (storyId?: string) => void;
}

const STORY_IMAGE_DURATION = 15000; // 15 secondes pour les images

const StoryViewer: React.FC<StoryViewerProps> = ({ 
  allStories, 
  initialGroupIndex, 
  onClose, 
  onDeleteStory 
}) => {
  const navigate = useNavigate();
  const [currentGroupIndex, setCurrentGroupIndex] = useState(initialGroupIndex);
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0);
  const [showOptions, setShowOptions] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isLongPressing, setIsLongPressing] = useState(false);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  const currentGroup = allStories[currentGroupIndex];
  const currentStory = currentGroup?.stories[currentStoryIndex];

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [reacted, setReacted] = useState<string | null>(null);
  const [showViewers, setShowViewers] = useState(false);
  const [viewers, setViewers] = useState<any[]>([]);

  const authHeaders = () => ({
    "Authorization": `Bearer ${localStorage.getItem("token")}`,
    "Content-Type": "application/json",
  });

  const reactToStory = async (emoji: string) => {
    if (!currentStory) return;
    setReacted(emoji);
    try {
      await fetch(`${API}/stories/${currentStory.id}/react`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify({ emoji }),
      });
      toast("Réaction envoyée");
    } catch { toast.error("Impossible de réagir."); }
  };

  const sendReply = async () => {
    if (!currentStory || !replyText.trim()) return;
    setSendingReply(true);
    try {
      const res = await fetch(`${API}/stories/${currentStory.id}/reply`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify({ content: replyText.trim() }),
      });
      if (!res.ok) throw new Error();
      setReplyText("");
      toast.success("Réponse envoyée en message privé");
    } catch { toast.error("Réponse impossible."); }
    finally { setSendingReply(false); }
  };

  const openViewers = async () => {
    if (!currentStory) return;
    setShowViewers(true); setIsPaused(true);
    try {
      const res = await fetch(`${API}/stories/${currentStory.id}/viewers`, { headers: authHeaders() });
      setViewers(res.ok ? await res.json() : []);
    } catch { setViewers([]); }
  };

  // Récupérer l'ID de l'utilisateur connecté depuis le localStorage.
  // L'app stocke l'utilisateur sous « nexus_user » (pas « user ») : sans ça,
  // l'auteur n'était pas reconnu → impossible de supprimer ses propres stories.
  useEffect(() => {
    try {
      const stored = localStorage.getItem('nexus_user') || localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u?.username) setCurrentUsername(String(u.username));
        if (u?.id) { setCurrentUserId(String(u.id)); return; }
      }
      // Fallback: décoder le JWT
      const token = localStorage.getItem('token');
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setCurrentUserId(String(payload.sub));
      }
    } catch (e) {
      console.error("Failed to get current user:", e);
    }
  }, []);

  // Marquer la story comme vue
  const markStoryAsViewed = async (storyId: string) => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      await fetch(`${API}/stories/${storyId}/view`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (err) {
      console.error("Erreur marquage story vue:", err);
    }
  };

  // Reset quand on change de groupe
  useEffect(() => {
    setCurrentStoryIndex(0);
    setShowOptions(false);
    setShowConfirmModal(false);
    setProgress(0);
    setIsPaused(false);
  }, [currentGroupIndex]);

  // Gestion de la progression (images et vidéos)
  useEffect(() => {
    if (!currentStory || isPaused || isLongPressing || showConfirmModal) return;

    setProgress(0);
    startTimeRef.current = Date.now();

    if (currentStory.media_type === 'image') {
      // Image: progression sur 15 secondes
      progressIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current;
        const newProgress = Math.min((elapsed / STORY_IMAGE_DURATION) * 100, 100);
        setProgress(newProgress);

        if (newProgress >= 100) {
          handleNextStory();
        }
      }, 50);
    } else if (currentStory.media_type === 'video' && videoRef.current) {
      // Vidéo: progression basée sur la durée
      const video = videoRef.current;
      
      const updateProgress = () => {
        if (video.duration > 0) {
          const newProgress = (video.currentTime / video.duration) * 100;
          setProgress(newProgress);
        }
      };

      video.addEventListener('timeupdate', updateProgress);
      video.play().catch(e => console.error("Video autoplay blocked:", e));

      return () => {
        video.removeEventListener('timeupdate', updateProgress);
      };
    }

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, [currentStory, isPaused, isLongPressing, showConfirmModal]);

  // Marquer comme vue au chargement
  useEffect(() => {
    if (currentStory?.id) {
      markStoryAsViewed(currentStory.id);
      setReacted(null);
    }
  }, [currentStory?.id]);

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
        }
      }
    }
  }, [currentGroup, currentStoryIndex, currentGroupIndex, allStories]);

  // Long press pour pause/play
  const handleTouchStart = () => {
    longPressTimerRef.current = setTimeout(() => {
      setIsLongPressing(true);
      setIsPaused(true);
      if (videoRef.current) {
        videoRef.current.pause();
      }
    }, 200); // 200ms pour détecter le long press
  };

  const handleTouchEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
    }
    if (isLongPressing) {
      setIsLongPressing(false);
      setIsPaused(false);
      if (videoRef.current && currentStory?.media_type === 'video') {
        videoRef.current.play();
      }
    }
  };

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

      if (response.ok || response.status === 404) {
        // 404 = déjà supprimée : on la retire quand même localement.
        toast.success("Story supprimée !");
        setShowConfirmModal(false);
        setShowOptions(false);
        onDeleteStory(currentStory.id);   // retrait optimiste immédiat + refetch
        onClose();
      } else {
        toast.error(`Erreur: ${response.status}`);
      }
    } catch (err) {
      console.error("Erreur réseau:", err);
      toast.error("Erreur réseau");
    }
  };

  // Clic sur le pseudo → profil
  const handleUsernameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/profile/${currentGroup.user_id}`);
    onClose();
  };

  // Fermer options si clic en dehors
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

  const isAuthor =
    (currentStory as any).is_mine === true ||   // autorité serveur (fiable)
    (currentUserId !== null &&
      (String(currentStory.author_id) === currentUserId ||
        String(currentGroup.user_id) === currentUserId)) ||
    (currentUsername !== null && currentGroup.username === currentUsername);

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center select-none"
      style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}>
      <div className="relative w-full h-full max-w-lg mx-auto flex flex-col bg-black">
        {/* Boutons en haut à droite */}
        <div className="absolute top-4 right-4 z-30 flex gap-2">
          {isAuthor && (
            <div className="relative">
              <button
                ref={optionsButtonRef}
                onClick={(e) => { e.stopPropagation(); setShowOptions(prev => !prev); }}
                className="text-white bg-black/50 backdrop-blur-sm rounded-full p-2 hover:bg-black/70 transition-all"
              >
                <MoreVertical size={20} />
              </button>
              {showOptions && (
                <div className="absolute top-full right-0 mt-2 w-36 bg-slate-800/95 backdrop-blur-md rounded-lg shadow-xl overflow-hidden">
                  <button
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setShowConfirmModal(true); 
                      setShowOptions(false); 
                    }}
                    className="flex items-center w-full px-4 py-3 text-sm text-red-400 hover:bg-slate-700/50 transition-colors"
                  >
                    <Trash2 size={16} className="mr-2" /> Supprimer
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            onClick={onClose}
            className="text-white bg-black/50 backdrop-blur-sm rounded-full p-2 hover:bg-black/70 transition-all"
          >
            <X size={20} />
          </button>
        </div>

        {/* Header avec barres de progression */}
        <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black/80 via-black/40 to-transparent pb-8">
          {/* Barres de progression */}
          <div className="flex gap-1 px-4 pt-2 mb-3">
            {currentGroup.stories.map((story, idx) => (
              <div key={story.id} className="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
                <div
                  className="h-full bg-white transition-all duration-100"
                  style={{ 
                    width: idx < currentStoryIndex 
                      ? '100%' 
                      : idx === currentStoryIndex 
                        ? `${progress}%` 
                        : '0%' 
                  }}
                />
              </div>
            ))}
          </div>

          {/* Info utilisateur */}
          <div 
            onClick={handleUsernameClick}
            className="flex items-center gap-3 px-4 cursor-pointer hover:opacity-80 transition-opacity"
          >
            <Avatar className="w-10 h-10 ring-2 ring-white/50">
              <img 
                src={currentGroup.profile_pic || "https://placehold.co/150"} 
                alt={currentGroup.username} 
                className="object-cover"
              />
            </Avatar>
            <span className="text-white font-semibold text-sm drop-shadow-lg">
              {currentGroup.username}
            </span>
            <span className="text-white/60 text-xs">
              {Math.floor((Date.now() - startTimeRef.current) / 1000)}s
            </span>
          </div>
        </div>

        {/* Contenu de la story */}
        <div 
          className="flex-1 flex items-center justify-center relative"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleTouchStart}
          onMouseUp={handleTouchEnd}
          onMouseLeave={handleTouchEnd}
        >
          {currentStory.media_type === 'image' ? (
            <img 
              src={currentStory.media_url} 
              alt="Story" 
              className="max-w-full max-h-full object-contain select-none"
              draggable={false}
            />
          ) : (
            <video
              ref={videoRef}
              src={currentStory.media_url}
              className="max-w-full max-h-full object-contain"
              style={{ transform: (currentStory as any).mirror ? "scaleX(-1)" : "none" }}
              onEnded={handleNextStory}
              controls={false}
              muted={!!(currentStory as any).music_url}
              playsInline
              preload="auto"
            />
          )}

          {/* Musique de fond (extrait 30 s, à partir du passage choisi) */}
          {(currentStory as any).music_url && (
            <audio key={currentStory.id} src={(currentStory as any).music_url} autoPlay loop
              onLoadedMetadata={(e) => {
                const el = e.currentTarget as HTMLAudioElement;
                const s = (currentStory as any).music_start || 0;
                if (s > 0) { try { el.currentTime = s; } catch {} }
                el.play().catch(() => {});
              }}
              onCanPlay={(e) => { (e.currentTarget as HTMLAudioElement).play().catch(() => {}); }} />
          )}

          {/* Bandeau musique */}
          {(currentStory as any).music_title && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1 rounded-full pointer-events-none"
              style={{ background: "rgba(0,0,0,0.45)" }}>
              <span className="material-symbols-outlined text-white" style={{ fontSize: 15 }}>music_note</span>
              <span className="text-white text-xs font-semibold truncate" style={{ maxWidth: 200 }}>
                {(currentStory as any).music_title}{(currentStory as any).music_artist ? ` · ${(currentStory as any).music_artist}` : ""}
              </span>
            </div>
          )}

          {/* Texte incrusté (légende de publication) */}
          {(currentStory as any).text && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center px-6 pointer-events-none">
              <span className="text-center text-white text-2xl font-black leading-snug px-3 py-1 rounded-lg"
                style={{ background: "rgba(0,0,0,0.35)", textShadow: "0 2px 6px rgba(0,0,0,0.5)" }}>
                {(currentStory as any).text}
              </span>
            </div>
          )}

          {/* Indicateur pause */}
          {isPaused && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-black/50 backdrop-blur-sm rounded-full p-4">
                <div className="w-12 h-12 border-4 border-white rounded-full flex items-center justify-center">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-6 bg-white rounded-full" />
                    <div className="w-1.5 h-6 bg-white rounded-full" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Zones de navigation (gauche/droite) */}
        <div className="absolute inset-0 flex z-10">
          <div 
            className="w-1/3 cursor-pointer" 
            onClick={handlePrevStory}
          />
          <div className="w-1/3" /> {/* Zone centrale pour le long press */}
          <div 
            className="w-1/3 cursor-pointer" 
            onClick={handleNextStory}
          />
        </div>
      </div>

      {/* Pied : réponse + réactions (spectateur) OU « vu par » (auteur) */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 px-4 pb-5 pt-3"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)", background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {isAuthor ? (
          <button
            onClick={(e) => { e.stopPropagation(); openViewers(); }}
            className="flex items-center gap-2 text-white/90 text-sm font-semibold mx-auto"
          >
            <span className="material-symbols-outlined text-[20px]">visibility</span>
            Vu par {(currentStory as any).views_count ?? 0}
          </button>
        ) : (
          <>
            <div className="flex justify-center gap-2 mb-3">
              {["❤️", "😂", "😮", "😍", "🔥", "👏", "😢", "🙏"].map((e) => (
                <button key={e} onClick={(ev) => { ev.stopPropagation(); reactToStory(e); }}
                  className="text-2xl active:scale-125 transition-transform"
                  style={{ opacity: reacted && reacted !== e ? 0.4 : 1 }}>{e}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onFocus={() => setIsPaused(true)}
                onBlur={() => setIsPaused(false)}
                onKeyDown={(e) => { if (e.key === "Enter") sendReply(); }}
                placeholder={`Répondre à ${currentGroup.username}…`}
                className="flex-1 text-sm px-4 py-3 rounded-full border-none outline-none placeholder:text-white/50 text-white"
                style={{ background: "rgba(255,255,255,0.15)" }}
              />
              <button onClick={(e) => { e.stopPropagation(); sendReply(); }} disabled={sendingReply || !replyText.trim()}
                className="w-11 h-11 rounded-full flex items-center justify-center disabled:opacity-40"
                style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: "#00363e" }}>
                <span className="material-symbols-outlined">send</span>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Liste des vues (auteur) */}
      {showViewers && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={(e) => { e.stopPropagation(); setShowViewers(false); setIsPaused(false); }}>
          <div className="w-full max-w-md rounded-t-3xl p-4 pb-6 max-h-[70vh] overflow-y-auto"
            style={{ background: "#0b1326", paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }} onClick={(e) => e.stopPropagation()}>
            <div className="w-10 h-1.5 rounded-full mx-auto mb-4 bg-slate-700" />
            <h3 className="font-black text-lg mb-3 px-1 text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px]">visibility</span>
              {viewers.length} vue{viewers.length > 1 ? "s" : ""}
            </h3>
            {viewers.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-8">Personne n'a encore vu cette story.</p>
            ) : (
              <div className="space-y-1">
                {viewers.map((v) => (
                  <div key={v.user_id} className="flex items-center gap-3 px-2 py-2">
                    <img src={v.profile_pic || "https://placehold.co/80"} alt={v.username} className="w-9 h-9 rounded-full object-cover" />
                    <span className="text-sm font-medium text-white flex-1">@{v.username}</span>
                    {v.reaction && <span className="text-lg">{v.reaction}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modale de confirmation de suppression */}
      {showConfirmModal && (
        <div 
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setShowConfirmModal(false)}
        >
          <div 
            className="bg-slate-900 rounded-2xl p-6 shadow-2xl max-w-sm w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-white mb-2">
              Supprimer cette story ?
            </h3>
            <p className="text-slate-400 mb-6 text-sm">
              Cette action est irréversible
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="flex-1 px-5 py-2.5 rounded-xl bg-slate-700 text-white hover:bg-slate-600 transition-colors font-medium"
              >
                Annuler
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 px-5 py-2.5 rounded-xl bg-red-600 text-white hover:bg-red-500 transition-colors font-medium"
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
