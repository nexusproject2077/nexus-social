import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";

const C = {
  surface:    "#0b1326",
  low:        "#131b2e",
  container:  "#171f33",
  high:       "#222a3d",
  cyan:       (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee",
  onPrimary:  "#00363e",
  outline:    "#859397",
  outlineVar: "#3c494c",
  onSurface:  "#dae2fd",
  onVariant:  "#bbc9cd",
};

function Avatar({ user, size = 8 }) {
  const s = `w-${size} h-${size}`;
  return user?.profile_pic ? (
    <img src={user.profile_pic} alt={user.username} className={`${s} rounded-full object-cover flex-shrink-0`} />
  ) : (
    <div
      className={`${s} rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0`}
      style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}
    >
      {user?.username?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

function AuthorAvatar({ username, profilePic, size = 8 }) {
  return profilePic ? (
    <img src={profilePic} alt={username} className={`w-${size} h-${size} rounded-full object-cover flex-shrink-0`} />
  ) : (
    <div
      className={`w-${size} h-${size} rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0`}
      style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}
    >
      {username?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

export default function CommentsSection({ postId, currentUser, onCommentAdded, onCommentDeleted }) {
  const { t } = useTranslation();
  const [comments,    setComments]    = useState([]);
  const [newComment,  setNewComment]  = useState("");
  const [replyingTo,  setReplyingTo]  = useState(null);
  const [replyText,   setReplyText]   = useState("");
  const [loading,     setLoading]     = useState(true);
  const [submitting,  setSubmitting]  = useState(false);

  useEffect(() => { fetchComments(); }, [postId]);

  const fetchComments = async () => {
    try {
      const res = await axios.get(`${API}/posts/${postId}/comments`);
      setComments(res.data.map(c => ({
        ...c,
        isLiked: c.is_liked || false,
        likesCount: c.likes_count || 0,
        repliesCount: c.replies_count || 0,
        showReplies: false,
        replies: [],
      })));
    } catch (err) {
      console.error("Erreur commentaires:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      const res = await axios.post(`${API}/posts/${postId}/comments`, { content: newComment });
      setComments(prev => [{ ...res.data, isLiked: false, likesCount: 0, repliesCount: 0, showReplies: false, replies: [] }, ...prev]);
      setNewComment("");
      onCommentAdded?.();
    } catch { toast.error(t("comments.err_add_comment")); }
    finally { setSubmitting(false); }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm(t("comments.confirm_delete"))) return;
    try {
      await axios.delete(`${API}/posts/${postId}/comments/${commentId}`);
      setComments(prev => prev.filter(c => c.id !== commentId));
      onCommentDeleted?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors de la suppression");
    }
  };

  const handleLikeComment = async (commentId) => {
    try {
      const res = await axios.post(`${API}/comments/${commentId}/like`);
      setComments(prev => prev.map(c =>
        c.id === commentId ? { ...c, isLiked: res.data.liked, likesCount: c.likesCount + (res.data.liked ? 1 : -1) } : c
      ));
    } catch { toast.error(t("comments.err_like")); }
  };

  const handleReply = async (commentId) => {
    if (!replyText.trim()) return;
    try {
      const res = await axios.post(`${API}/comments/${commentId}/replies`, { content: replyText });
      setComments(prev => prev.map(c =>
        c.id === commentId ? { ...c, replies: [res.data, ...c.replies], repliesCount: c.repliesCount + 1 } : c
      ));
      setReplyText("");
      setReplyingTo(null);
    } catch { toast.error(t("comments.err_add_reply")); }
  };

  const toggleReplies = async (commentId) => {
    const comment = comments.find(c => c.id === commentId);
    if (!comment.showReplies && comment.replies.length === 0) {
      try {
        const res = await axios.get(`${API}/comments/${commentId}/replies`);
        setComments(prev => prev.map(c => c.id === commentId ? { ...c, replies: res.data, showReplies: true } : c));
      } catch { console.error("Erreur replies"); }
    } else {
      setComments(prev => prev.map(c => c.id === commentId ? { ...c, showReplies: !c.showReplies } : c));
    }
  };

  const formatDate = (d) => {
    try { return formatDistanceToNow(new Date(d), { addSuffix: true, locale: fr }); }
    catch { return "À l'instant"; }
  };

  return (
    <div className="space-y-4 pt-3" style={{ borderTop: `1px solid rgba(255,255,255,0.06)` }}>

      {/* ── Input ─────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmitComment} className="flex gap-3 items-end">
        <Avatar user={currentUser} size={8} />
        <div
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-2xl transition-all focus-within:ring-1"
          style={{ backgroundColor: C.high, border: `1px solid ${C.outlineVar}`, focusWithinRingColor: C.cyan }}
        >
          <input
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder={t("comments.add_comment")}
            className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-slate-500"
            style={{ color: C.onSurface }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmitComment(e); } }}
          />
          <button
            type="submit"
            disabled={submitting || !newComment.trim()}
            className="flex items-center justify-center w-8 h-8 rounded-xl transition-all active:scale-90 disabled:opacity-40"
            style={{ background: newComment.trim() ? "linear-gradient(135deg,#22d3ee,#3b82f6)" : C.high, color: newComment.trim() ? C.onPrimary : C.outline }}
          >
            <span className="material-symbols-outlined text-sm">{submitting ? "hourglass_top" : "send"}</span>
          </button>
        </div>
      </form>

      {/* ── Comments list ──────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-4">
          <div className="w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: `${C.cyan}33`, borderTopColor: C.cyan }} />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-center py-3" style={{ color: C.outline }}>{t("comments.empty")}</p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: `${C.high} transparent` }}>
          {comments.map((comment) => (
            <div key={comment.id} className="space-y-2">

              {/* Comment */}
              <div className="flex gap-2.5">
                <AuthorAvatar username={comment.author_username} profilePic={comment.author_profile_pic} size={8} />
                <div className="flex-1 min-w-0">
                  <div className="rounded-2xl rounded-tl-none px-3 py-2.5" style={{ backgroundColor: C.high }}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-bold" style={{ color: C.onSurface }}>{comment.author_username}</span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px]" style={{ color: C.outline }}>{formatDate(comment.created_at)}</span>
                        {currentUser?.id === comment.author_id && (
                          <button onClick={() => handleDeleteComment(comment.id)} className="hover:text-red-400 transition-colors" style={{ color: C.outline }}>
                            <span className="material-symbols-outlined text-xs">close</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: C.onVariant }}>{comment.content}</p>
                  </div>

                  {/* Comment actions */}
                  <div className="flex items-center gap-4 mt-1 ml-1">
                    <button
                      onClick={() => handleLikeComment(comment.id)}
                      className="flex items-center gap-1 text-[10px] font-bold transition-colors"
                      style={{ color: comment.isLiked ? "#f87171" : C.outline }}
                    >
                      <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: comment.isLiked ? "'FILL' 1" : "'FILL' 0" }}>favorite</span>
                      {comment.likesCount > 0 && <span>{comment.likesCount}</span>}
                    </button>
                    <button
                      onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                      className="text-[10px] font-bold transition-colors hover:text-cyan-400"
                      style={{ color: replyingTo === comment.id ? C.cyan : C.outline }}
                    >
                      {t("comments.reply")}
                    </button>
                    {comment.repliesCount > 0 && (
                      <button onClick={() => toggleReplies(comment.id)} className="text-[10px] font-bold transition-colors hover:text-cyan-400" style={{ color: C.outline }}>
                        {comment.showReplies ? t("comments.hide_replies") : t("comments.view_replies", { count: comment.repliesCount })}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Reply form */}
              {replyingTo === comment.id && (
                <div className="ml-10 flex gap-2 items-end">
                  <Avatar user={currentUser} size={7} />
                  <div
                    className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-2xl"
                    style={{ backgroundColor: C.high, border: `1px solid ${C.outlineVar}` }}
                  >
                    <input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={t("comments.reply_to_placeholder", { user: comment.author_username })}
                      className="flex-1 bg-transparent border-none outline-none text-xs placeholder:text-slate-500"
                      style={{ color: C.onSurface }}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleReply(comment.id); } }}
                    />
                    <button onClick={() => handleReply(comment.id)} disabled={!replyText.trim()} className="disabled:opacity-40 transition-colors hover:text-cyan-400" style={{ color: C.outline }}>
                      <span className="material-symbols-outlined text-sm">send</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Replies */}
              {comment.showReplies && comment.replies.length > 0 && (
                <div className="ml-10 space-y-2">
                  {comment.replies.map((reply) => (
                    <div key={reply.id} className="flex gap-2">
                      <AuthorAvatar username={reply.author_username} profilePic={reply.author_profile_pic} size={7} />
                      <div className="flex-1 rounded-2xl rounded-tl-none px-3 py-2" style={{ backgroundColor: C.container, border: `1px solid rgba(255,255,255,0.04)` }}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] font-bold" style={{ color: C.onSurface }}>{reply.author_username}</span>
                          <span className="text-[9px]" style={{ color: C.outline }}>{formatDate(reply.created_at)}</span>
                        </div>
                        <p className="text-xs leading-relaxed" style={{ color: C.onVariant }}>{reply.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
