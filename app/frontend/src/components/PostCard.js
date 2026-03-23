import { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import CommentsSection from "./CommentsSection";

export default function PostCard({ post, currentUser, onUpdate, onDelete }) {
  const [isLiked, setIsLiked] = useState(post.is_liked || false);
  const [likesCount, setLikesCount] = useState(post.likes_count || 0);
  const [commentsCount, setCommentsCount] = useState(post.comments_count || 0);
  const [showComments, setShowComments] = useState(false);

  const handleLike = async () => {
    try {
      const response = await axios.post(`${API}/posts/${post.id}/like`);
      setIsLiked(response.data.liked);
      setLikesCount((prev) => (response.data.liked ? prev + 1 : prev - 1));
    } catch (error) {
      console.error("Erreur lors du like:", error);
      toast.error("Erreur lors du like");
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer ce post ?")) return;
    try {
      await axios.delete(`${API}/posts/${post.id}`);
      toast.success("Post supprimé avec succès");
      onDelete?.(post.id);
    } catch (error) {
      console.error("Erreur lors de la suppression:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleCommentAdded = () => setCommentsCount((prev) => prev + 1);
  const handleCommentDeleted = () =>
    setCommentsCount((prev) => Math.max(0, prev - 1));

  const getInitials = (username) =>
    username ? username.substring(0, 2).toUpperCase() : "??";

  const formatDate = (dateString) => {
    try {
      return formatDistanceToNow(new Date(dateString), {
        addSuffix: true,
        locale: fr,
      });
    } catch {
      return "Il y a quelques instants";
    }
  };

  const isOwnPost = currentUser?.id === post.author_id;

  return (
    <article
      className="rounded-2xl p-4 lg:p-6 border space-y-4"
      style={{
        backgroundColor: "#171f33",
        borderColor: "rgba(255,255,255,0.05)",
      }}
    >
      {/* Header */}
      <div className="flex justify-between items-start">
        <div className="flex gap-3">
          <Link to={`/profile/${post.author_id}`}>
            {post.author_profile_pic ? (
              <img
                src={post.author_profile_pic}
                alt={post.author_username}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm"
                style={{
                  background: "linear-gradient(135deg, #22d3ee, #3b82f6)",
                  color: "#00363e",
                }}
              >
                {getInitials(post.author_username)}
              </div>
            )}
          </Link>
          <div>
            <Link
              to={`/profile/${post.author_id}`}
              className="font-bold text-sm transition-colors hover:text-cyan-400"
              style={{ color: "#dae2fd" }}
            >
              {post.author_username}
            </Link>
            <p className="text-xs" style={{ color: "#859397" }}>
              {formatDate(post.created_at)}
            </p>
          </div>
        </div>
        {isOwnPost && (
          <button
            onClick={handleDelete}
            className="transition-colors hover:text-red-400"
            style={{ color: "#859397" }}
            title="Supprimer le post"
          >
            <span className="material-symbols-outlined text-xl">delete</span>
          </button>
        )}
      </div>

      {/* Content */}
      <p
        className="leading-relaxed text-sm lg:text-base whitespace-pre-wrap"
        style={{ color: "#bbc9cd" }}
      >
        {post.content}
      </p>

      {/* Image */}
      {post.media_url && post.media_type === "image" && (
        <div
          className="rounded-xl overflow-hidden border"
          style={{ borderColor: "rgba(255,255,255,0.05)" }}
        >
          <img
            src={post.media_url}
            alt="Post media"
            className="w-full h-auto object-contain max-h-[600px]"
            loading="lazy"
          />
        </div>
      )}

      {/* Video */}
      {post.media_url && post.media_type === "video" && (
        <div className="rounded-xl overflow-hidden">
          <video
            src={post.media_url}
            controls
            className="w-full max-h-[600px]"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-6 pt-2">
        <button
          onClick={handleLike}
          className="flex items-center gap-2 font-medium text-xs lg:text-sm transition-colors"
          style={{ color: isLiked ? "#f87171" : "#859397" }}
        >
          <span
            className="material-symbols-outlined text-lg lg:text-xl"
            style={{
              fontVariationSettings: isLiked ? "'FILL' 1" : "'FILL' 0",
            }}
          >
            favorite
          </span>
          {likesCount}
        </button>

        <button
          onClick={() => setShowComments(!showComments)}
          className="flex items-center gap-2 font-medium text-xs lg:text-sm transition-colors hover:text-cyan-400"
          style={{ color: "#859397" }}
        >
          <span className="material-symbols-outlined text-lg lg:text-xl">
            chat_bubble
          </span>
          {commentsCount}
        </button>

        <button
          className="flex items-center gap-2 font-medium text-xs lg:text-sm transition-colors hover:text-cyan-400"
          style={{ color: "#859397" }}
        >
          <span className="material-symbols-outlined text-lg lg:text-xl">
            repeat
          </span>
        </button>
      </div>

      {/* Comments Section */}
      {showComments && (
        <CommentsSection
          postId={post.id}
          currentUser={currentUser}
          onCommentAdded={handleCommentAdded}
          onCommentDeleted={handleCommentDeleted}
        />
      )}
    </article>
  );
}
