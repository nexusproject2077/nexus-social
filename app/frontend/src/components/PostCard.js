import { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import CommentsSection from "./CommentsSection";

const C = {
  surface:    "#0b1326",
  container:  "#171f33",
  high:       "#222a3d",
  cyan:       "#22d3ee",
  onPrimary:  "#00363e",
  outline:    "#859397",
  onSurface:  "#dae2fd",
  onVariant:  "#bbc9cd",
};

export default function PostCard({ post, currentUser, onUpdate, onDelete }) {
  const [isLiked, setIsLiked]         = useState(post.is_liked || false);
  const [likesCount, setLikesCount]   = useState(post.likes_count || 0);
  const [sharesCount, setSharesCount] = useState(post.shares_count || 0);
  const [commentsCount, setCommentsCount] = useState(post.comments_count || 0);
  const [showComments, setShowComments]   = useState(false);
  const [reposted, setReposted]       = useState(!!post.repost_of && post.author_id === currentUser?.id);
  const [repostLoading, setRepostLoading] = useState(false);

  const handleLike = async () => {
    try {
      const res = await axios.post(`${API}/posts/${post.id}/like`);
      setIsLiked(res.data.liked);
      setLikesCount((p) => (res.data.liked ? p + 1 : p - 1));
    } catch {
      toast.error("Erreur lors du like");
    }
  };

  const handleRepost = async () => {
    if (!currentUser) { toast.error("Vous devez être connecté"); return; }
    if (reposted) { toast.info("Vous avez déjà reposté cette publication"); return; }
    if (post.author_id === currentUser.id) { toast.error("Vous ne pouvez pas reposter votre propre publication"); return; }

    try {
      setRepostLoading(true);
      await axios.post(`${API}/posts/${post.id}/repost`);
      setReposted(true);
      setSharesCount((p) => p + 1);
      toast.success("Publication repostée !");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors du repost");
    } finally {
      setRepostLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer ce post ?")) return;
    try {
      await axios.delete(`${API}/posts/${post.id}`);
      toast.success("Post supprimé avec succès");
      onDelete?.(post.id);
    } catch {
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleCommentAdded   = () => setCommentsCount((p) => p + 1);
  const handleCommentDeleted = () => setCommentsCount((p) => Math.max(0, p - 1));

  const getInitials = (u) => (u ? u.substring(0, 2).toUpperCase() : "??");

  const formatDate = (d) => {
    try { return formatDistanceToNow(new Date(d), { addSuffix: true, locale: fr }); }
    catch { return "À l'instant"; }
  };

  const isOwnPost = currentUser?.id === post.author_id;

  return (
    <article
      className="rounded-2xl border overflow-hidden"
      style={{ backgroundColor: C.container, borderColor: "rgba(255,255,255,0.05)" }}
    >
      {/* Repost banner */}
      {post.repost_of && (
        <div className="flex items-center gap-2 px-4 py-2 border-b text-xs font-bold" style={{ backgroundColor: C.high, borderColor: "rgba(255,255,255,0.05)", color: C.outline }}>
          <span className="material-symbols-outlined text-base" style={{ color: C.cyan }}>repeat</span>
          <span>Reposté par <span style={{ color: C.cyan }}>@{post.author_username}</span> depuis <Link to={`/profile/${post.original_author_id}`} style={{ color: C.onVariant }} className="hover:text-cyan-400">@{post.original_author_username}</Link></span>
        </div>
      )}

      <div className="p-4 lg:p-5 space-y-4">
        {/* Header */}
        <div className="flex justify-between items-start">
          <Link to={`/profile/${post.author_id}`} className="flex gap-3 items-center">
            {post.author_profile_pic ? (
              <img src={post.author_profile_pic} alt={post.author_username} className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
                {getInitials(post.author_username)}
              </div>
            )}
            <div>
              <p className="font-bold text-sm transition-colors hover:text-cyan-400" style={{ color: C.onSurface }}>
                {post.author_username}
              </p>
              <p className="text-xs" style={{ color: C.outline }}>{formatDate(post.created_at)}</p>
            </div>
          </Link>
          {isOwnPost && (
            <button onClick={handleDelete} className="transition-colors hover:text-red-400" style={{ color: C.outline }} title="Supprimer">
              <span className="material-symbols-outlined text-xl">delete</span>
            </button>
          )}
        </div>

        {/* Content */}
        <p className="leading-relaxed text-sm lg:text-base whitespace-pre-wrap" style={{ color: C.onVariant }}>
          {post.content}
        </p>

        {/* Media */}
        {post.media_url && post.media_type === "image" && (
          <div className="rounded-xl overflow-hidden border" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <img src={post.media_url} alt="Post media" className="w-full h-auto object-contain max-h-[560px]" loading="lazy" />
          </div>
        )}
        {post.media_url && post.media_type === "video" && (
          <div className="rounded-xl overflow-hidden border" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <video src={post.media_url} controls className="w-full max-h-[560px]" />
          </div>
        )}

        {/* Action bar */}
        <div className="flex items-center gap-5 pt-1" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {/* Like */}
          <button
            onClick={handleLike}
            className="flex items-center gap-1.5 text-xs font-medium transition-all hover:scale-105"
            style={{ color: isLiked ? "#f87171" : C.outline }}
          >
            <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: isLiked ? "'FILL' 1" : "'FILL' 0" }}>
              favorite
            </span>
            {likesCount > 0 && <span>{likesCount}</span>}
          </button>

          {/* Comment */}
          <button
            onClick={() => setShowComments(!showComments)}
            className="flex items-center gap-1.5 text-xs font-medium transition-all hover:scale-105"
            style={{ color: showComments ? C.cyan : C.outline }}
          >
            <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: showComments ? "'FILL' 1" : "'FILL' 0" }}>
              chat_bubble
            </span>
            {commentsCount > 0 && <span>{commentsCount}</span>}
          </button>

          {/* Repost */}
          {!isOwnPost && (
            <button
              onClick={handleRepost}
              disabled={repostLoading}
              title={reposted ? "Déjà reposté" : "Reposter"}
              className="flex items-center gap-1.5 text-xs font-medium transition-all hover:scale-105"
              style={{ color: reposted ? C.cyan : C.outline, opacity: repostLoading ? 0.6 : 1 }}
            >
              {repostLoading ? (
                <span className="material-symbols-outlined text-lg animate-spin" style={{ animationDuration: "0.7s" }}>refresh</span>
              ) : (
                <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: reposted ? "'FILL' 1" : "'FILL' 0" }}>repeat</span>
              )}
              {sharesCount > 0 && <span>{sharesCount}</span>}
            </button>
          )}
        </div>

        {/* Comments */}
        {showComments && (
          <CommentsSection
            postId={post.id}
            currentUser={currentUser}
            onCommentAdded={handleCommentAdded}
            onCommentDeleted={handleCommentDeleted}
          />
        )}
      </div>
    </article>
  );
}
