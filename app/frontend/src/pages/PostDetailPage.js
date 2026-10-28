import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import PostCard from "@/components/PostCard";
import CommentCard from "@/components/CommentCard";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export default function PostDetailPage({ user }) {
  const { t } = useTranslation();
  const { postId } = useParams();
  const [post, setPost] = useState(null);
  const [comments, setComments] = useState([]);
  const [commentContent, setCommentContent] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPost();
    fetchComments();
  }, [postId]);

  const fetchPost = async () => {
    try {
      const response = await axios.get(`${API}/posts/${postId}`);
      setPost(response.data);
    } catch (error) {
      toast.error(t("postdetail.err_load_post"));
    } finally {
      setLoading(false);
    }
  };

  const fetchComments = async () => {
    try {
      const response = await axios.get(`${API}/posts/${postId}/comments`);
      setComments(response.data);
    } catch (error) {
      toast.error(t("postdetail.err_load_comments"));
    }
  };

  const handlePostComment = async (e) => {
    e.preventDefault();
    if (!commentContent.trim()) return;

    try {
      const response = await axios.post(`${API}/posts/${postId}/comments`, {
        content: commentContent,
      });
      setComments([response.data, ...comments]);
      setCommentContent("");
      // Update post comments count
      setPost({ ...post, comments_count: post.comments_count + 1 });
      toast.success(t("postdetail.comment_posted"));
    } catch (error) {
      toast.error(t("postdetail.err_post_comment"));
    }
  };

  const handlePostUpdate = (updatedPost) => {
    setPost(updatedPost);
  };

  if (loading) {
    return (
      <Layout user={user}>
        <div className="flex justify-center items-center h-screen">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
        </div>
      </Layout>
    );
  }

  if (!post) {
    return (
      <Layout user={user}>
        <div className="text-center py-12 text-slate-400">
          <p>{t("postdetail.not_found")}</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout user={user}>
      <div className="max-w-2xl mx-auto">
        <div className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800 p-4">
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{t("postdetail.title")}</h1>
        </div>

        <div className="p-4">
          <PostCard
            post={post}
            currentUser={user}
            onUpdate={handlePostUpdate}
            showFullContent
          />

          {/* Composer de réponse EN LIGNE (style X) : avatar · champ transparent
              · capsule « Répondre » qui s'illumine dès qu'on écrit. */}
          <form onSubmit={handlePostComment} className="flex items-start gap-3 py-3 mt-2 border-b border-slate-800">
            {user?.profile_pic ? (
              <img src={user.profile_pic} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white"
                style={{ background: "linear-gradient(135deg,#3b82f6,#22d3ee)" }}>
                {(user?.username || "?").slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <textarea
                data-testid="comment-input"
                value={commentContent}
                onChange={(e) => {
                  setCommentContent(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${e.target.scrollHeight}px`;
                }}
                placeholder={t("postdetail.reply_placeholder")}
                rows={1}
                className="w-full bg-transparent border-none outline-none resize-none text-white placeholder:text-slate-500 text-[15px] leading-6 py-1.5"
                style={{ minHeight: 36 }}
              />
              <div className="flex justify-end mt-1">
                <button
                  data-testid="post-comment-button"
                  type="submit"
                  disabled={!commentContent.trim()}
                  className="px-4 py-1.5 rounded-full text-sm font-bold transition-all active:scale-95 disabled:cursor-not-allowed"
                  style={{
                    background: commentContent.trim() ? "var(--nexus-accent, #22d3ee)" : "#1e293b",
                    color: commentContent.trim() ? "#04121a" : "#64748b",
                  }}
                >
                  {t("postdetail.reply")}
                </button>
              </div>
            </div>
          </form>

          {comments.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-slate-500">{t("postdetail.be_first")}</p>
            </div>
          ) : (
            <div className="pb-6">
              {comments.map((comment) => (
                <CommentCard key={comment.id} comment={comment} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
