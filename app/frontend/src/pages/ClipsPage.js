import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

const C = {
  surface:   "#0b1326",
  high:      "#222a3d",
  cyan:      (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee",
  onPrimary: "#00363e",
  outline:   "#859397",
  onSurface: "#dae2fd",
};

function ClipCard({ post, currentUser, isActive, onDelete }) {
  const navigate  = useNavigate();
  const videoRef  = useRef(null);
  const [isLiked, setIsLiked]       = useState(post.is_liked || false);
  const [likes, setLikes]           = useState(post.likes_count || 0);
  const [comments, setComments]     = useState(post.comments_count || 0);
  const [muted, setMuted]           = useState(true);
  const [paused, setPaused]         = useState(false);
  const [showComment, setShowComment] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentsList, setCommentsList] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);

  const openComments = async () => {
    const next = !showComment;
    setShowComment(next);
    if (next) {
      try {
        setLoadingComments(true);
        const r = await axios.get(`${API}/posts/${post.id}/comments`);
        setCommentsList(r.data || []);
      } catch { /* ignore */ }
      finally { setLoadingComments(false); }
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isActive) {
      video.play().catch(() => {});
      setPaused(false);
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }, [isActive]);

  const handleTap = () => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) { video.play(); setPaused(false); }
    else { video.pause(); setPaused(true); }
  };

  const handleLike = async (e) => {
    e.stopPropagation();
    try {
      const res = await axios.post(`${API}/posts/${post.id}/like`);
      setIsLiked(res.data.liked);
      setLikes(p => res.data.liked ? p + 1 : p - 1);
    } catch { toast.error("Erreur"); }
  };

  const handleSendComment = async () => {
    if (!commentText.trim()) return;
    try {
      const res = await axios.post(`${API}/posts/${post.id}/comments`, { content: commentText });
      setComments(p => p + 1);
      // Ajoute le commentaire en tête de liste immédiatement.
      if (res.data && res.data.id) setCommentsList((prev) => [res.data, ...prev]);
      else setCommentsList((prev) => [{ id: `tmp-${Date.now()}`, author_username: currentUser?.username, content: commentText, created_at: new Date().toISOString() }, ...prev]);
      setCommentText("");
    } catch { toast.error("Erreur"); }
  };

  const fmt = (n) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : n;
  const fmtDate = (d) => { try { return formatDistanceToNow(new Date(d), { addSuffix: true, locale: fr }); } catch { return ""; } };

  return (
    <div className="relative w-full h-screen flex-shrink-0 overflow-hidden" style={{ background: "#000" }}>
      {/* Video (Nexus Clips = vidéos uniquement) */}
      <video
        ref={videoRef}
        src={post.media_url}
        className="w-full h-full object-contain sm:object-cover"
        loop
        muted={muted}
        playsInline
        onClick={handleTap}
      />

      {/* Gradient overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 40%, rgba(0,0,0,0.2) 100%)" }} />

      {/* Pause indicator */}
      {paused && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
            <span className="material-symbols-outlined text-white text-4xl">pause</span>
          </div>
        </div>
      )}

      {/* Right action bar */}
      <div className="absolute right-4 bottom-32 flex flex-col gap-5 items-center">
        {/* Avatar */}
        <button onClick={() => navigate(`/profile/${post.author_id}`)} className="relative">
          {post.author_profile_pic ? (
            <img src={post.author_profile_pic} alt="" className="w-12 h-12 rounded-full object-cover border-2" style={{ borderColor: C.cyan }} />
          ) : (
            <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg" style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
              {post.author_username?.[0]?.toUpperCase()}
            </div>
          )}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full flex items-center justify-center text-white" style={{ background: C.cyan }}>
            <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>add</span>
          </div>
        </button>

        {/* Like */}
        <button onClick={handleLike} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
            <span className="material-symbols-outlined text-2xl" style={{ color: isLiked ? "#f87171" : "#fff", fontVariationSettings: isLiked ? "'FILL' 1" : "'FILL' 0" }}>
              favorite
            </span>
          </div>
          <span className="text-white text-xs font-bold">{fmt(likes)}</span>
        </button>

        {/* Comment */}
        <button onClick={(e) => { e.stopPropagation(); openComments(); }} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
            <span className="material-symbols-outlined text-2xl text-white">chat_bubble</span>
          </div>
          <span className="text-white text-xs font-bold">{fmt(comments)}</span>
        </button>

        {/* Mute */}
        {post.media_type === "video" && (
          <button onClick={(e) => { e.stopPropagation(); setMuted(p => !p); }} className="flex flex-col items-center gap-1">
            <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
              <span className="material-symbols-outlined text-2xl text-white">{muted ? "volume_off" : "volume_up"}</span>
            </div>
          </button>
        )}

        {/* Supprimer (auteur uniquement) */}
        {currentUser?.id === post.author_id && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete?.(post.id); }}
            data-testid="delete-clip"
            title="Supprimer ce clip"
            className="flex flex-col items-center gap-1"
          >
            <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
              <span className="material-symbols-outlined text-2xl" style={{ color: "#f87171" }}>delete</span>
            </div>
          </button>
        )}
      </div>

      {/* Bottom info */}
      <div className="absolute bottom-24 left-4 right-20">
        <button onClick={() => navigate(`/profile/${post.author_id}`)} className="font-bold text-white text-sm mb-1 hover:text-cyan-300 transition-colors">
          @{post.author_username}
        </button>
        <p className="text-white/80 text-sm leading-snug line-clamp-2">{post.content}</p>
        <p className="text-white/40 text-xs mt-1 flex items-center gap-1.5">
          <span>{fmtDate(post.created_at)}</span>
          <span>·</span>
          <span className="flex items-center gap-0.5">
            <span className="material-symbols-outlined text-xs">play_arrow</span>
            {fmt(post.views || 0)} vues
          </span>
        </p>
      </div>

      {/* Comment panel */}
      {showComment && (
        <div
          className="absolute bottom-0 left-0 right-0 rounded-t-3xl p-4"
          style={{ background: "rgba(11,19,38,0.95)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,255,255,0.08)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: C.outline }} />
          <h3 className="text-white font-bold text-sm mb-3">{comments} commentaire{comments !== 1 ? "s" : ""}</h3>

          {/* Liste des commentaires */}
          <div className="max-h-[40vh] overflow-y-auto space-y-3 mb-3" style={{ scrollbarWidth: "none" }}>
            {loadingComments ? (
              <p className="text-xs text-center py-4" style={{ color: C.outline }}>Chargement…</p>
            ) : commentsList.length === 0 ? (
              <p className="text-xs text-center py-4" style={{ color: C.outline }}>Aucun commentaire. Soyez le premier !</p>
            ) : (
              commentsList.map((c) => (
                <div key={c.id} className="flex gap-2.5 items-start">
                  {c.author_profile_pic ? (
                    <img src={c.author_profile_pic} alt={c.author_username} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
                      {(c.author_username || "?")[0].toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs" style={{ color: C.onSurface }}>
                      <span className="font-bold">@{c.author_username}</span>{" "}
                      <span style={{ color: C.onVariant }}>{c.content}</span>
                    </p>
                    <p className="text-[10px] mt-0.5" style={{ color: C.outline }}>{fmtDate(c.created_at)}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex gap-3 items-center">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Ajouter un commentaire…"
              className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-slate-500 py-2 px-3 rounded-xl"
              style={{ backgroundColor: C.high, color: C.onSurface, border: "1px solid rgba(255,255,255,0.08)" }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSendComment(); }}
            />
            <button onClick={handleSendComment} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
              <span className="material-symbols-outlined text-sm">send</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClipsPage({ user, setUser }) {
  const [clips, setClips]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [view, setView] = useState("immersive"); // "immersive" | "grid"
  const containerRef = useRef(null);
  const observerRef  = useRef(null);
  const fileInputRef = useRef(null);
  const viewedRef    = useRef(new Set());

  useEffect(() => {
    fetchClips();
  }, []);

  // Compte une vue quand un clip devient actif (une fois par clip et par visite)
  useEffect(() => {
    const clip = clips[activeIndex];
    if (!clip || viewedRef.current.has(clip.id)) return;
    viewedRef.current.add(clip.id);
    axios.post(`${API}/clips/${clip.id}/view`).catch(() => {});
  }, [activeIndex, clips]);

  useEffect(() => {
    if (view !== "immersive" || !containerRef.current || clips.length === 0) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = parseInt(entry.target.dataset.index, 10);
            setActiveIndex(idx);
          }
        });
      },
      { threshold: 0.6 }
    );
    const items = containerRef.current.querySelectorAll("[data-index]");
    items.forEach((el) => observerRef.current.observe(el));
    return () => observerRef.current?.disconnect();
  }, [clips, view]);

  const fetchClips = async () => {
    try {
      // Nexus Clips = uniquement des vidéos courtes, de tout le monde
      const res = await axios.get(`${API}/clips`);
      const videos = (res.data || []).filter(
        (p) => p.media_type === "video" && p.media_url
      );
      setClips(videos);
    } catch (err) {
      console.error("Erreur clips:", err);
      toast.error("Erreur lors du chargement des clips");
    } finally {
      setLoading(false);
    }
  };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleDeleteClip = async (clipId) => {
    if (!window.confirm("Supprimer définitivement ce clip ?")) return;
    try {
      await axios.delete(`${API}/posts/${clipId}`);
      setClips((prev) => {
        const next = prev.filter((c) => c.id !== clipId);
        setActiveIndex((idx) => Math.max(0, Math.min(idx, next.length - 1)));
        return next;
      });
      toast.success("Clip supprimé");
    } catch (err) {
      console.error("Erreur suppression clip:", err);
      toast.error("Erreur lors de la suppression");
    }
  };

  const uploadClip = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de re-sélectionner le même fichier
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Veuillez choisir un fichier vidéo");
      return;
    }
    const caption = window.prompt("Légende de votre clip (optionnel)") || "";
    setUploading(true);
    setUploadProgress(0);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("caption", caption);
      // axios ajoute le token via l'intercepteur + gère la limite multipart
      await axios.post(`${API}/clips`, form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => {
          if (evt.total) {
            setUploadProgress(Math.round((evt.loaded * 100) / evt.total));
          }
        },
      });
      toast.success("Clip publié !");
      setActiveIndex(0);
      await fetchClips();
    } catch (err) {
      console.error("Erreur upload clip:", err);
      toast.error("Erreur lors de la publication du clip");
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // Bouton flottant d'upload (réutilisé dans l'état vide et l'état principal)
  const uploadControls = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={uploadClip}
        data-testid="clip-file-input"
      />
      <button
        onClick={handleUploadClick}
        disabled={uploading}
        data-testid="upload-clip"
        title="Publier un clip"
        className="fixed z-50 top-16 right-4 lg:top-4 w-12 h-12 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all"
        style={{
          background: "linear-gradient(135deg,#22d3ee,#3b82f6)",
          color: C.onPrimary,
          opacity: uploading ? 0.6 : 1,
        }}
      >
        {uploading ? (
          <span className="text-[11px] font-black">{uploadProgress}%</span>
        ) : (
          <span className="material-symbols-outlined text-2xl">add</span>
        )}
      </button>
    </>
  );

  // Bascule entre la vue immersive (défilement vertical) et la vue grille
  const viewToggle = (
    <button
      onClick={() => setView((v) => (v === "immersive" ? "grid" : "immersive"))}
      data-testid="toggle-clips-view"
      title={view === "immersive" ? "Vue grille" : "Vue immersive"}
      className="fixed z-50 top-16 left-4 lg:top-4 w-12 h-12 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all"
      style={{ background: "rgba(0,0,0,0.5)", color: "#fff", backdropFilter: "blur(8px)" }}
    >
      <span className="material-symbols-outlined text-2xl">
        {view === "immersive" ? "grid_view" : "smart_display"}
      </span>
    </button>
  );

  if (loading) {
    return (
      <Layout user={user} setUser={setUser} compact>
        <div className="flex items-center justify-center h-screen">
          <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: `${C.cyan}33`, borderTopColor: C.cyan }} />
        </div>
      </Layout>
    );
  }

  if (clips.length === 0) {
    return (
      <Layout user={user} setUser={setUser} compact>
        <div className="flex flex-col items-center justify-center h-screen gap-4">
          <span className="material-symbols-outlined text-6xl" style={{ color: C.outline, opacity: 0.4 }}>play_circle</span>
          <p className="text-sm font-bold uppercase tracking-widest" style={{ color: C.outline }}>Aucun clip disponible</p>
          <p className="text-xs text-center max-w-xs" style={{ color: C.outline }}>
            Publiez une vidéo pour qu'elle apparaisse ici
          </p>
          <button
            onClick={handleUploadClick}
            disabled={uploading}
            data-testid="upload-clip-empty"
            className="mt-2 px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 active:scale-95 transition-all"
            style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary, opacity: uploading ? 0.6 : 1 }}
          >
            <span className="material-symbols-outlined text-lg">upload</span>
            {uploading ? `Publication… ${uploadProgress}%` : "Publier un clip"}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={uploadClip}
          data-testid="clip-file-input"
        />
      </Layout>
    );
  }

  return (
    <Layout user={user} setUser={setUser} compact>
      {view === "immersive" ? (
        /* Full-screen vertical scroll snapping */
        <div
          ref={containerRef}
          className="h-screen overflow-y-scroll"
          style={{
            scrollSnapType: "y mandatory",
            scrollBehavior: "smooth",
            WebkitOverflowScrolling: "touch",
            /* Adjust for mobile header/nav */
            marginTop: 0,
            scrollbarWidth: "none",
          }}
        >
          <style>{`
            div::-webkit-scrollbar { display: none; }
            [data-index] { scroll-snap-align: start; scroll-snap-stop: always; }
          `}</style>
          {clips.map((clip, idx) => (
            <div key={clip.id} data-index={idx} className="w-full" style={{ height: "100svh" }}>
              <ClipCard post={clip} currentUser={user} isActive={idx === activeIndex} onDelete={handleDeleteClip} />
            </div>
          ))}
        </div>
      ) : (
        /* Grille des clips (style Reels) */
        <div className="h-screen overflow-y-auto px-2 pt-16 pb-24 lg:pt-6" style={{ background: "#000" }}>
          <div className="grid grid-cols-3 gap-1.5 max-w-4xl mx-auto">
            {clips.map((clip, idx) => (
              <button
                key={clip.id}
                onClick={() => { setActiveIndex(idx); setView("immersive"); }}
                data-testid={`clip-grid-${clip.id}`}
                className="relative rounded-lg overflow-hidden active:scale-95 transition-transform"
                style={{ aspectRatio: "9 / 16", background: "#111" }}
              >
                <video
                  src={clip.media_url}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75), transparent 55%)" }}
                />
                {clip.content && (
                  <div className="absolute top-1.5 left-2 right-2 text-white text-[10px] line-clamp-1 opacity-80 text-left">
                    {clip.content}
                  </div>
                )}
                <div className="absolute bottom-1.5 left-2 right-2 flex items-center gap-2 text-white text-[11px]">
                  <span className="flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1", color: "#f87171" }}>favorite</span>
                    <span className="font-bold">{clip.likes_count || 0}</span>
                  </span>
                  <span className="flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-sm">play_arrow</span>
                    <span className="font-bold">{clip.views || 0}</span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bascule grille / immersif */}
      {viewToggle}

      {/* Nexus Clips branding overlay (top-left) */}
      <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none lg:top-4">
        <span
          className="text-white font-black text-sm tracking-widest uppercase"
          style={{ fontFamily: "Space Grotesk, sans-serif", textShadow: `0 0 20px ${C.cyan}` }}
        >
          NEXUS CLIPS
        </span>
      </div>

      {/* Bouton flottant : publier un clip */}
      {uploadControls}
    </Layout>
  );
}
