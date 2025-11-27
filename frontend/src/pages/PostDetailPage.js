import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import PostCard from "@/components/PostCard";
import CommentCard from "@/components/CommentCard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { toast } from "sonner";

export default function PostDetailPage({ user }) {
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
      toast.error("Erreur lors du chargement de la publication");
    } finally {
      setLoading(false);
    }
  };

  const fetchComments = async () => {
    try {
      const response = await axios.get(`${API}/posts/${postId}/comments`);
      setComments(response.data);
    } catch (error) {
      toast.error("Erreur lors du chargement des commentaires");
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
      toast.success("Commentaire publié");
    } catch (error) {
      toast.error("Erreur lors de la publication du commentaire");
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
          <p>Publication introuvable</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout user={user}>
      <div className="max-w-2xl mx-auto">
        <div className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800 p-4">
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Publication</h1>
        </div>

        <div className="p-4">
          <PostCard
            post={post}
            currentUser={user}
            onUpdate={handlePostUpdate}
            showFullContent
          />

          <div className="mt-6 mb-4">
            <h2 className="text-xl font-bold mb-4">Commentaires</h2>
            <form onSubmit={handlePostComment} className="mb-6">
              <Textarea
                data-testid="comment-input"
                value={commentContent}
                onChange={(e) => setCommentContent(e.target.value)}
                placeholder="Écrivez un commentaire..."
                className="bg-slate-900 border-slate-700 text-white mb-3"
                rows={3}
              />
              <Button
                data-testid="post-comment-button"
                type="submit"
                disabled={!commentContent.trim()}
                className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
              >
                <Send className="w-4 h-4 mr-2" />
                Publier le commentaire
              </Button>
            </form>
          </div>

          {comments.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>Aucun commentaire</p>
            </div>
          ) : (
            <div className="space-y-4 pb-6">
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
