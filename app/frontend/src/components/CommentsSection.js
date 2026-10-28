import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API } from "@/App";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Heart,
  MessageCircle,
  Share2,
  MoreHorizontal,
  Trash2,
  Flag,
  Link2,
  ChevronDown,
  ChevronUp,
  Send,
  X,
  BadgeCheck,
} from "lucide-react";

const MAX_LEN = 280;

const C = {
  surface: "#0b1326",
  low: "#131b2e",
  container: "#171f33",
  high: "#222a3d",
  cyan:
    (typeof window !== "undefined" &&
      window.localStorage.getItem("nexus_accent")) ||
    "#22d3ee",
  onPrimary: "#00363e",
  outline: "#859397",
  outlineVar: "#3c494c",
  onSurface: "#dae2fd",
  onVariant: "#bbc9cd",
  rose: "#f43f5e",
};

// Âge relatif compact et localisé (« il y a 3 h » / « 3h ago »), façon X.
function compactTime(iso, lang) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  try {
    const rtf = new Intl.RelativeTimeFormat(lang || "en", {
      numeric: "always",
      style: "narrow",
    });
    if (s < 60) return rtf.format(-s, "second");
    if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
    if (s < 86400) return rtf.format(-Math.floor(s / 3600), "hour");
    if (s < 604800) return rtf.format(-Math.floor(s / 86400), "day");
    if (s < 2592000) return rtf.format(-Math.floor(s / 604800), "week");
    return d.toLocaleDateString(lang || "en", {
      day: "numeric",
      month: "short",
    });
  } catch {
    return d.toLocaleDateString();
  }
}

function Avatar({ user, size = 36, onClick }) {
  const style = { width: size, height: size };
  return user?.profile_pic ? (
    <img
      src={user.profile_pic}
      alt={user.username}
      onClick={onClick}
      style={style}
      className={`rounded-full object-cover flex-shrink-0 ${onClick ? "cursor-pointer" : ""}`}
    />
  ) : (
    <div
      onClick={onClick}
      style={{
        ...style,
        background: "linear-gradient(135deg,#22d3ee,#3b82f6)",
        color: C.onPrimary,
      }}
      className={`rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0 ${onClick ? "cursor-pointer" : ""}`}
    >
      {user?.username?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

function AuthorAvatar({ username, profilePic, size = 36, onClick }) {
  return (
    <Avatar
      user={{ username, profile_pic: profilePic }}
      size={size}
      onClick={onClick}
    />
  );
}

// Textarea qui grandit avec le contenu (auto-resize).
function AutoTextarea({ value, onChange, placeholder, onEnter, small }) {
  const ref = useRef(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, small ? 120 : 180) + "px";
  }, [small]);
  useEffect(() => {
    resize();
  }, [value, resize]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      maxLength={MAX_LEN}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="flex-1 bg-transparent border-none outline-none resize-none text-sm placeholder:text-slate-500 leading-relaxed"
      style={{ color: C.onSurface }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onEnter?.();
        }
      }}
    />
  );
}

export default function CommentsSection({
  postId,
  currentUser,
  onCommentAdded,
  onCommentDeleted,
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const lang = i18n?.resolvedLanguage || i18n?.language;
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [sort, setSort] = useState("relevant"); // "relevant" | "recent"
  const [menuId, setMenuId] = useState(null); // id du commentaire dont le menu ⋯ est ouvert

  useEffect(() => {
    fetchComments();
  }, [postId]); // eslint-disable-line

  const fetchComments = async () => {
    try {
      const res = await axios.get(`${API}/posts/${postId}/comments`);
      setComments(
        res.data.map((c) => ({
          ...c,
          isLiked: c.is_liked || false,
          likesCount: c.likes_count || 0,
          repliesCount: c.replies_count || 0,
          showReplies: false,
          replies: [],
        })),
      );
    } catch (err) {
      console.error(t("error_comments_log"), err);
    } finally {
      setLoading(false);
    }
  };

  // Tri d'affichage : « Pertinents » = engagement d'abord (Premium, likes,
  // réponses) ; « Récents » = strictement par date décroissante.
  const sortedComments = [...comments].sort((a, b) => {
    if (sort === "recent") {
      return new Date(b.created_at) - new Date(a.created_at);
    }
    const score = (c) =>
      (c.author_is_premium ? 1000 : 0) + c.likesCount * 2 + c.repliesCount;
    const d = score(b) - score(a);
    return d !== 0 ? d : new Date(b.created_at) - new Date(a.created_at);
  });

  const handleSubmitComment = async () => {
    if (!newComment.trim() || submitting) return;
    setSubmitting(true);
    try {
      const res = await axios.post(`${API}/posts/${postId}/comments`, {
        content: newComment.trim(),
      });
      setComments((prev) => [
        {
          ...res.data,
          isLiked: false,
          likesCount: 0,
          repliesCount: 0,
          showReplies: false,
          replies: [],
        },
        ...prev,
      ]);
      setNewComment("");
      onCommentAdded?.();
    } catch {
      toast.error(t("comments.err_add_comment"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    setMenuId(null);
    if (!window.confirm(t("comments.confirm_delete"))) return;
    try {
      await axios.delete(`${API}/posts/${postId}/comments/${commentId}`);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      onCommentDeleted?.();
    } catch (err) {
      toast.error(err.response?.data?.detail || t("error_deleting"));
    }
  };

  const handleLikeComment = async (commentId) => {
    // Optimiste : on inverse tout de suite, on corrige si l'API refuse.
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? {
              ...c,
              isLiked: !c.isLiked,
              likesCount: c.likesCount + (c.isLiked ? -1 : 1),
            }
          : c,
      ),
    );
    try {
      const res = await axios.post(`${API}/comments/${commentId}/like`);
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? {
                ...c,
                isLiked: res.data.liked,
              }
            : c,
        ),
      );
    } catch {
      // rollback
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? {
                ...c,
                isLiked: !c.isLiked,
                likesCount: c.likesCount + (c.isLiked ? -1 : 1),
              }
            : c,
        ),
      );
      toast.error(t("comments.err_like"));
    }
  };

  const handleReply = async (commentId) => {
    if (!replyText.trim()) return;
    try {
      const res = await axios.post(`${API}/comments/${commentId}/replies`, {
        content: replyText.trim(),
      });
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? {
                ...c,
                replies: [...c.replies, res.data],
                repliesCount: c.repliesCount + 1,
                showReplies: true,
              }
            : c,
        ),
      );
      setReplyText("");
      setReplyingTo(null);
    } catch {
      toast.error(t("comments.err_add_reply"));
    }
  };

  const toggleReplies = async (commentId) => {
    const comment = comments.find((c) => c.id === commentId);
    if (!comment.showReplies && comment.replies.length === 0) {
      try {
        const res = await axios.get(`${API}/comments/${commentId}/replies`);
        setComments((prev) =>
          prev.map((c) =>
            c.id === commentId
              ? { ...c, replies: res.data, showReplies: true }
              : c,
          ),
        );
      } catch {
        console.error(t("error_replies"));
      }
    } else {
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId ? { ...c, showReplies: !c.showReplies } : c,
        ),
      );
    }
  };

  const commentLink = (commentId) =>
    `${window.location.origin}/post/${postId}#comment-${commentId}`;

  const handleCopyLink = async (commentId) => {
    setMenuId(null);
    try {
      await navigator.clipboard.writeText(commentLink(commentId));
      toast.success(t("comments.link_copied"));
    } catch {
      toast.error(t("error_occurred"));
    }
  };

  const handleShare = async (commentId, authorUsername) => {
    const url = commentLink(commentId);
    if (navigator.share) {
      try {
        await navigator.share({ title: `@${authorUsername}`, url });
        return;
      } catch {
        /* l'utilisateur a annulé — on retombe sur la copie */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("comments.link_copied"));
    } catch {
      toast.error(t("error_occurred"));
    }
  };

  const handleReport = async (commentId) => {
    setMenuId(null);
    try {
      await axios.post(`${API}/reports`, {
        reported_content_id: commentId,
        content_type: "comment",
        reason: "user_report",
      });
      toast.success(t("comments.reported"));
    } catch {
      toast.error(t("comments.err_report"));
    }
  };

  const goProfile = (id) => id && navigate(`/profile/${id}`);

  const overCount = newComment.length;
  const nearLimit = overCount >= MAX_LEN - 20;

  return (
    <div
      className="pt-3"
      style={{ borderTop: `1px solid rgba(255,255,255,0.06)` }}
    >
      {/* ── Onglets de tri — contrôle segmenté 50/50, coins arrondis ─────── */}
      {comments.length > 0 && (
        <div
          className="flex items-center gap-1 mb-3 p-1 rounded-full"
          style={{ backgroundColor: C.container, border: `1px solid ${C.outlineVar}` }}
        >
          {[
            { id: "relevant", label: t("comments.sort_relevant") },
            { id: "recent", label: t("comments.sort_recent") },
          ].map((tab) => {
            const active = sort === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setSort(tab.id)}
                className="flex-1 py-1.5 text-xs font-bold rounded-full text-center transition-all active:scale-[0.98]"
                style={{
                  background: active ? C.cyan : "transparent",
                  color: active ? C.onPrimary : C.outline,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Compositeur principal — plat, façon X ──────────────────────── */}
      <div
        className="flex gap-3 items-start pb-3 mb-1"
        style={{ borderBottom: `1px solid ${C.outlineVar}55` }}
      >
        <Avatar user={currentUser} size={36} />
        <div className="flex-1 flex flex-col gap-1 pt-1.5">
          <AutoTextarea
            value={newComment}
            onChange={setNewComment}
            placeholder={t("comments.add_comment")}
            onEnter={handleSubmitComment}
          />
          <div className="flex items-center justify-end gap-3">
            <span
              className="text-[10px] tabular-nums"
              style={{ color: nearLimit ? C.rose : C.outline }}
            >
              {overCount}/{MAX_LEN}
            </span>
            <button
              onClick={handleSubmitComment}
              disabled={submitting || !newComment.trim()}
              className="px-4 py-1.5 rounded-full text-xs font-bold transition-all active:scale-95 disabled:opacity-40"
              style={{
                background: newComment.trim()
                  ? "linear-gradient(135deg,#22d3ee,#3b82f6)"
                  : C.container,
                color: newComment.trim() ? C.onPrimary : C.outline,
              }}
            >
              {submitting ? t("comments.publishing") : t("comments.reply")}
            </button>
          </div>
        </div>
      </div>

      {/* ── Liste des commentaires ─────────────────────────────────────── */}
      {loading ? (
        <div className="flex justify-center py-4">
          <div
            className="w-5 h-5 rounded-full border-2 animate-spin"
            style={{ borderColor: `${C.cyan}33`, borderTopColor: C.cyan }}
          />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-center py-3" style={{ color: C.outline }}>
          {t("comments.empty")}
        </p>
      ) : (
        <div
          className="max-h-[28rem] overflow-y-auto pr-1"
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: `${C.high} transparent`,
          }}
        >
          {sortedComments.map((comment) => {
            const isAuthor = currentUser?.id === comment.author_id;
            const threadOpen =
              comment.showReplies && comment.replies.length > 0;
            return (
              <div
                key={comment.id}
                id={`comment-${comment.id}`}
                className="relative pt-3 pb-2"
                style={{ borderBottom: `1px solid ${C.outlineVar}40` }}
              >
                {/* Trait de fil vertical sous l'avatar quand le thread est ouvert */}
                {threadOpen && (
                  <span
                    className="absolute top-11 w-px"
                    style={{
                      left: 17,
                      bottom: 8,
                      backgroundColor: C.outlineVar,
                    }}
                  />
                )}

                <div className="flex gap-2.5">
                  <AuthorAvatar
                    username={comment.author_username}
                    profilePic={comment.author_profile_pic}
                    size={36}
                    onClick={() => goProfile(comment.author_id)}
                  />
                  <div className="flex-1 min-w-0">
                    {/* En-tête : nom @handle · temps + menu ⋯ */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        <button
                          onClick={() => goProfile(comment.author_id)}
                          className="text-xs font-bold truncate hover:underline"
                          style={{ color: C.onSurface }}
                        >
                          {comment.author_username}
                        </button>
                        {comment.author_is_verified && (
                          <BadgeCheck
                            className="w-3.5 h-3.5 flex-shrink-0"
                            style={{ color: C.cyan }}
                          />
                        )}
                        <span
                          className="text-[11px] truncate"
                          style={{ color: C.outline }}
                        >
                          @{comment.author_username} ·{" "}
                          {compactTime(comment.created_at, lang)}
                        </span>
                      </div>

                      {/* Menu ⋯ */}
                      <div className="relative flex-shrink-0">
                        <button
                          onClick={() =>
                            setMenuId(menuId === comment.id ? null : comment.id)
                          }
                          className="p-1 -mr-1 rounded-full transition-colors hover:bg-white/5"
                          style={{ color: C.outline }}
                          aria-label={t("comments.report")}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {menuId === comment.id && (
                          <>
                            <div
                              className="fixed inset-0 z-10"
                              onClick={() => setMenuId(null)}
                            />
                            <div
                              className="absolute right-0 top-7 z-20 w-44 rounded-2xl overflow-hidden shadow-xl"
                              style={{
                                backgroundColor: C.container,
                                border: `1px solid ${C.outlineVar}`,
                              }}
                            >
                              {isAuthor && (
                                <button
                                  onClick={() =>
                                    handleDeleteComment(comment.id)
                                  }
                                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium transition-colors hover:bg-white/5"
                                  style={{ color: C.rose }}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  {t("comments.delete")}
                                </button>
                              )}
                              {!isAuthor && (
                                <button
                                  onClick={() => handleReport(comment.id)}
                                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium transition-colors hover:bg-white/5"
                                  style={{ color: C.onSurface }}
                                >
                                  <Flag className="w-3.5 h-3.5" />
                                  {t("comments.report")}
                                </button>
                              )}
                              <button
                                onClick={() => handleCopyLink(comment.id)}
                                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium transition-colors hover:bg-white/5"
                                style={{ color: C.onSurface }}
                              >
                                <Link2 className="w-3.5 h-3.5" />
                                {t("comments.copy_link")}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Contenu */}
                    <p
                      className="text-sm leading-relaxed whitespace-pre-wrap break-words mt-0.5"
                      style={{ color: C.onVariant }}
                    >
                      {comment.content}
                    </p>

                    {/* Barre d'actions étalée sur la largeur, façon X :
                        réponse · afficher réponses · j'aime · partager */}
                    <div
                      className="flex items-center justify-between mt-2 max-w-[19rem]"
                      style={{ color: C.outline }}
                    >
                      <button
                        onClick={() =>
                          setReplyingTo(
                            replyingTo === comment.id ? null : comment.id,
                          )
                        }
                        className="group flex items-center gap-1.5 text-[11px] transition-colors"
                        style={{
                          color:
                            replyingTo === comment.id ? C.cyan : C.outline,
                        }}
                      >
                        <span className="p-1.5 -m-1.5 rounded-full transition-colors group-hover:bg-cyan-400/10">
                          <MessageCircle className="w-4 h-4" />
                        </span>
                        <span className="group-hover:text-cyan-400 tabular-nums">
                          {comment.repliesCount > 0 ? comment.repliesCount : ""}
                        </span>
                      </button>

                      {comment.repliesCount > 0 ? (
                        <button
                          onClick={() => toggleReplies(comment.id)}
                          className="flex items-center gap-1 text-[11px] font-semibold transition-colors hover:text-cyan-400"
                          style={{ color: C.cyan }}
                        >
                          {comment.showReplies ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                          {comment.showReplies
                            ? t("comments.hide")
                            : t("comments.show_replies", {
                                count: comment.repliesCount,
                              })}
                        </button>
                      ) : (
                        <span />
                      )}

                      <button
                        onClick={() => handleLikeComment(comment.id)}
                        className="group flex items-center gap-1.5 text-[11px] transition-colors"
                        style={{ color: comment.isLiked ? C.rose : C.outline }}
                      >
                        <span
                          className="p-1.5 -m-1.5 rounded-full transition-colors"
                          style={{
                            background: "transparent",
                          }}
                        >
                          <Heart
                            className="w-4 h-4"
                            fill={comment.isLiked ? C.rose : "none"}
                          />
                        </span>
                        <span
                          className="tabular-nums"
                          style={{ color: comment.isLiked ? C.rose : C.outline }}
                        >
                          {comment.likesCount > 0 ? comment.likesCount : ""}
                        </span>
                      </button>

                      <button
                        onClick={() =>
                          handleShare(comment.id, comment.author_username)
                        }
                        className="group flex items-center transition-colors"
                        style={{ color: C.outline }}
                      >
                        <span className="p-1.5 -m-1.5 rounded-full transition-colors group-hover:bg-cyan-400/10 group-hover:text-cyan-400">
                          <Share2 className="w-4 h-4" />
                        </span>
                      </button>
                    </div>

                    {/* Formulaire de réponse + bannière « En réponse à @user » */}
                    {replyingTo === comment.id && (
                      <div className="mt-2">
                        <div
                          className="flex items-center justify-between px-3 py-1 mb-1.5 rounded-full text-[11px]"
                          style={{
                            backgroundColor: `${C.cyan}14`,
                            color: C.cyan,
                          }}
                        >
                          <span className="truncate">
                            {t("comments.replying_to", {
                              user: comment.author_username,
                            })}
                          </span>
                          <button
                            onClick={() => {
                              setReplyingTo(null);
                              setReplyText("");
                            }}
                            style={{ color: C.cyan }}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="flex gap-2 items-start">
                          <Avatar user={currentUser} size={28} />
                          <div
                            className="flex-1 flex flex-col gap-1.5 pt-1"
                            style={{
                              borderBottom: `1px solid ${C.outlineVar}55`,
                              paddingBottom: 6,
                            }}
                          >
                            <AutoTextarea
                              small
                              value={replyText}
                              onChange={setReplyText}
                              placeholder={t("comments.reply_to_placeholder", {
                                user: comment.author_username,
                              })}
                              onEnter={() => handleReply(comment.id)}
                            />
                            <div className="flex justify-end">
                              <button
                                onClick={() => handleReply(comment.id)}
                                disabled={!replyText.trim()}
                                className="flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold transition-all active:scale-95 disabled:opacity-40"
                                style={{
                                  background: replyText.trim()
                                    ? "linear-gradient(135deg,#22d3ee,#3b82f6)"
                                    : C.container,
                                  color: replyText.trim()
                                    ? C.onPrimary
                                    : C.outline,
                                }}
                              >
                                <Send className="w-3 h-3" />
                                {t("comments.reply")}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Réponses imbriquées (thread) */}
                    {threadOpen && (
                      <div className="mt-2 space-y-2.5">
                        {comment.replies.map((reply) => (
                          <div key={reply.id} className="flex gap-2">
                            <AuthorAvatar
                              username={reply.author_username}
                              profilePic={reply.author_profile_pic}
                              size={28}
                              onClick={() => goProfile(reply.author_id)}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                  onClick={() => goProfile(reply.author_id)}
                                  className="text-[11px] font-bold truncate hover:underline"
                                  style={{ color: C.onSurface }}
                                >
                                  {reply.author_username}
                                </button>
                                {reply.author_is_verified && (
                                  <BadgeCheck
                                    className="w-3 h-3 flex-shrink-0"
                                    style={{ color: C.cyan }}
                                  />
                                )}
                                <span
                                  className="text-[10px]"
                                  style={{ color: C.outline }}
                                >
                                  @{reply.author_username} ·{" "}
                                  {compactTime(reply.created_at, lang)}
                                </span>
                              </div>
                              <p
                                className="text-[13px] leading-relaxed whitespace-pre-wrap break-words mt-0.5"
                                style={{ color: C.onVariant }}
                              >
                                {reply.content}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
