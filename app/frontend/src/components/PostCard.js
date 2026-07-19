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
  cyan:       (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee",
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
  const [poll, setPoll]               = useState(post.poll || null);
  const [pollVote, setPollVote]       = useState(post.poll_user_vote || null);
  const [pollLoading, setPollLoading] = useState(false);

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

  const handleVote = async (optionId) => {
    if (pollLoading || pollVote === optionId) return;
    try {
      setPollLoading(true);
      const res = await axios.post(`${API}/posts/${post.id}/vote`, { option_id: optionId });
      setPoll(res.data.poll);
      setPollVote(res.data.poll_user_vote);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors du vote");
    } finally {
      setPollLoading(false);
    }
  };

  const handleCommentAdded   = () => setCommentsCount((p) => p + 1);
  const handleCommentDeleted = () => setCommentsCount((p) => Math.max(0, p - 1));

  const getInitials = (u) => (u ? u.substring(0, 2).toUpperCase() : "??");

  // Rend le contenu avec les hashtags cliquables (#tag -> recherche)
  const renderContent = (text) => {
    if (!text) return null;
    return text.split(/(\s+)/).map((part, i) => {
      if (/^#[\p{L}0-9_]+$/u.test(part)) {
        return (
          <Link
            key={i}
            to={`/search?q=${encodeURIComponent(part)}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:underline"
            style={{ color: C.cyan }}
          >
            {part}
          </Link>
        );
      }
      return part;
    });
  };

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
              <p className="font-bold text-sm transition-colors hover:text-cyan-400 flex items-center gap-1" style={{ color: C.onSurface }}>
                {post.author_username}
                {post.author_is_verified && (
                  <span
                    className="material-symbols-outlined text-sm"
                    style={{ color: "#3b82f6", fontVariationSettings: "'FILL' 1" }}
                    title="Compte vérifié"
                  >
                    verified
                  </span>
                )}
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
          {renderContent(post.content)}
        </p>

        {/* Poll / Sondage */}
        {poll && Array.isArray(poll.options) && poll.options.length > 0 && (
          <div className="space-y-2">
            {poll.options.map((opt) => {
              const total = poll.total_votes || 0;
              const pct = total > 0 ? Math.round((opt.votes / total) * 100) : 0;
              const voted = !!pollVote;
              const selected = pollVote === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => handleVote(opt.id)}
                  disabled={pollLoading}
                  data-testid={`poll-option-${opt.id}`}
                  className="relative w-full text-left rounded-xl overflow-hidden border px-3 py-2.5 text-sm transition-all"
                  style={{
                    borderColor: selected ? C.cyan : "rgba(255,255,255,0.08)",
                    backgroundColor: C.high,
                    opacity: pollLoading ? 0.7 : 1,
                    cursor: pollLoading ? "default" : "pointer",
                  }}
                >
                  {/* Barre de progression (résultats après vote) */}
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{
                      width: voted ? `${pct}%` : "0%",
                      background: selected ? "rgba(34,211,238,0.25)" : "rgba(255,255,255,0.06)",
                      transition: "width 0.4s ease",
                    }}
                  />
                  <div className="relative flex items-center justify-between gap-2" style={{ color: C.onSurface }}>
                    <span className="flex items-center gap-1.5 font-medium">
                      {selected && (
                        <span className="material-symbols-outlined text-base" style={{ color: C.cyan }}>
                          check_circle
                        </span>
                      )}
                      {opt.text}
                    </span>
                    {voted && (
                      <span className="text-xs font-bold flex-shrink-0" style={{ color: C.onVariant }}>
                        {pct}%
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            <p className="text-xs" style={{ color: C.outline }}>
              {poll.total_votes || 0} vote{(poll.total_votes || 0) !== 1 ? "s" : ""}
              {!pollVote && " · Appuyez pour voter"}
            </p>
          </div>
        )}

        {/* Lien affilié (bouton Shop) */}
        {post.affiliate_link && /^https?:\/\//.test(post.affiliate_link) && (
          <a
            href={post.affiliate_link}
            target="_blank"
            rel="noopener noreferrer nofollow sponsored"
            data-testid="affiliate-shop"
            onClick={(e) => {
              e.stopPropagation();
              axios.post(`${API}/posts/${post.id}/affiliate-click`).catch(() => {});
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}
          >
            <span className="material-symbols-outlined text-lg">shopping_bag</span>
            Shop
          </a>
        )}

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
