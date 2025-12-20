import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trash2, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";

export default function CommentsSection({ postId, currentUser }) {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchComments();
  }, [postId]);

  const fetchComments = async () => {
    try {
      const response = await axios.get(`${API}/posts/${postId}/comments`);
      setComments(response.data);
    } catch (error) {
      console.error("Erreur lors du chargement des commentaires:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitComment = async (e) => {
    e.preventDefault();
    if (!newComment.trim()) {
      toast.error("Le commentaire ne peut pas être vide");
      return;
    }

    setSubmitting(true);
    try {
      const response = await axios.post(`${API}/posts/${postId}/comments`, {
        content: newComment,
      });
      setComments([response.data, ...comments]);
      setNewComment("");
      toast.success("Commentaire ajouté");
    } catch (error) {
      console.error("Erreur lors de l'ajout du commentaire:", error);
      toast.error("Erreur lors de l'ajout du commentaire");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm("Supprimer ce commentaire ?")) {
      return;
    }

    try {
      await axios.delete(`${API}/posts/${postId}/comments/${commentId}`);
      setComments(comments.filter((c) => c.id !== commentId));
      toast.success("Commentaire supprimé");
    } catch (error) {
      console.error("Erreur lors de la suppression:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  const getInitials = (username) => {
    return username ? username.substring(0, 2).toUpperCase() : "??";
  };

  const formatDate = (dateString) => {
    try {
      return formatDistanceToNow(new Date(dateString), {
        addSuffix: true,
        locale: fr,
      });
    } catch (error) {
      return "Il y a quelques instants";
    }
  };

  return (
    <div className="w-full pt-3 border-t border-slate-800 space-y-4">
      {/* Formulaire d'ajout de commentaire */}
      <form onSubmit={handleSubmitComment} className="flex gap-2">
        <Avatar className="h-8 w-8 flex-shrink-0">
          {currentUser?.profile_pic ? (
            <AvatarImage src={currentUser.profile_pic} alt={currentUser.username} />
          ) : (
            <AvatarFallback className="bg-gradient-to-r from-cyan-500 to-blue-500 text-xs">
              {getInitials(currentUser?.username)}
            </AvatarFallback>
          )}
        </Avatar>
        <div className="flex-1 flex gap-2">
          <Textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Ajouter un commentaire..."
            className="bg-slate-800 border-slate-700 text-white resize-none min-h-[40px] max-h-[120px]"
            rows={1}
          />
          <Button
            type="submit"
            disabled={submitting || !newComment.trim()}
            size="icon"
            className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 flex-shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>

      {/* Liste des commentaires */}
      {loading ? (
        <div className="flex justify-center py-4">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500"></div>
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-4">
          Aucun commentaire pour le moment
        </p>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-2">
              <Avatar className="h-8 w-8 flex-shrink-0">
                {comment.author_profile_pic ? (
                  <AvatarImage
                    src={comment.author_profile_pic}
                    alt={comment.author_username}
                  />
                ) : (
                  <AvatarFallback className="bg-gradient-to-r from-cyan-500 to-blue-500 text-xs">
                    {getInitials(comment.author_username)}
                  </AvatarFallback>
                )}
              </Avatar>
              <div className="flex-1 bg-slate-800/50 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">
                    {comment.author_username}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">
                      {formatDate(comment.created_at)}
                    </span>
                    {currentUser?.id === comment.author_id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteComment(comment.id)}
                        className="h-6 w-6 text-slate-400 hover:text-red-500"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-slate-200 whitespace-pre-wrap">
                  {comment.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
