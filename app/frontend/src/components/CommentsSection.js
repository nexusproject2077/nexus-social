import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trash2, Send, Heart, MessageCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";

export default function CommentsSection({ postId, currentUser, onCommentAdded, onCommentDeleted }) {
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchComments();
  }, [postId]);

  const fetchComments = async () => {
    try {
      const response = await axios.get(`${API}/posts/${postId}/comments`);
      // Initialise les états des likes pour chaque commentaire
      const commentsWithLikeState = response.data.map(comment => ({
        ...comment,
        isLiked: comment.is_liked || false,
        likesCount: comment.likes_count || 0,
        repliesCount: comment.replies_count || 0,
        showReplies: false,
        replies: [],
      }));
      setComments(commentsWithLikeState);
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
      const newCommentData = {
        ...response.data,
        isLiked: false,
        likesCount: 0,
        repliesCount: 0,
        showReplies: false,
        replies: [],
      };
      setComments([newCommentData, ...comments]);
      setNewComment("");
      toast.success("Commentaire ajouté");
      // ✅ Notifie le parent
      if (onCommentAdded) {
        onCommentAdded();
      }
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
      // ✅ Notifie le parent
      if (onCommentDeleted) {
        onCommentDeleted();
      }
    } catch (error) {
      console.error("Erreur lors de la suppression:", error);
      toast.error(error.response?.data?.detail || "Erreur lors de la suppression");
    }
  };

  const handleLikeComment = async (commentId) => {
    try {
      const response = await axios.post(`${API}/comments/${commentId}/like`);
      setComments(comments.map(c => 
        c.id === commentId 
          ? { ...c, isLiked: response.data.liked, likesCount: c.likesCount + (response.data.liked ? 1 : -1) }
          : c
      ));
    } catch (error) {
      console.error("Erreur lors du like:", error);
      toast.error("Erreur lors du like du commentaire");
    }
  };

  const handleReply = async (commentId) => {
    if (!replyText.trim()) {
      toast.error("La réponse ne peut pas être vide");
      return;
    }

    try {
      const response = await axios.post(`${API}/comments/${commentId}/replies`, {
        content: replyText,
      });
      
      // Ajoute la réponse au commentaire parent
      setComments(comments.map(c => 
        c.id === commentId 
          ? { 
              ...c, 
              replies: [response.data, ...c.replies],
              repliesCount: c.repliesCount + 1,
            }
          : c
      ));
      
      setReplyText("");
      setReplyingTo(null);
      toast.success("Réponse ajoutée");
    } catch (error) {
      console.error("Erreur lors de la réponse:", error);
      toast.error("Erreur lors de l'ajout de la réponse");
    }
  };

  const toggleReplies = async (commentId) => {
    const comment = comments.find(c => c.id === commentId);
    
    if (!comment.showReplies && comment.replies.length === 0) {
      // Charger les réponses
      try {
        const response = await axios.get(`${API}/comments/${commentId}/replies`);
        setComments(comments.map(c => 
          c.id === commentId 
            ? { ...c, replies: response.data, showReplies: true }
            : c
        ));
      } catch (error) {
        console.error("Erreur lors du chargement des réponses:", error);
      }
    } else {
      // Toggle l'affichage
      setComments(comments.map(c => 
        c.id === commentId 
          ? { ...c, showReplies: !c.showReplies }
          : c
      ));
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
        <div className="space-y-3 max-h-[500px] overflow-y-auto">
          {comments.map((comment) => (
            <div key={comment.id} className="space-y-2">
              {/* Commentaire principal */}
              <div className="flex gap-2">
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
                  <p className="text-sm text-slate-200 whitespace-pre-wrap mb-2">
                    {comment.content}
                  </p>
                  
                  {/* Actions du commentaire */}
                  <div className="flex items-center gap-4 text-xs">
                    <button
                      onClick={() => handleLikeComment(comment.id)}
                      className={`flex items-center gap-1 ${
                        comment.isLiked ? "text-red-500" : "text-slate-400"
                      } hover:text-red-500 transition-colors`}
                    >
                      <Heart className={`h-3 w-3 ${comment.isLiked ? "fill-current" : ""}`} />
                      <span>{comment.likesCount > 0 ? comment.likesCount : ''}</span>
                    </button>
                    
                    <button
                      onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                      className="flex items-center gap-1 text-slate-400 hover:text-blue-500 transition-colors"
                    >
                      <MessageCircle className="h-3 w-3" />
                      <span>Répondre</span>
                    </button>
                    
                    {comment.repliesCount > 0 && (
                      <button
                        onClick={() => toggleReplies(comment.id)}
                        className="text-slate-400 hover:text-cyan-500 transition-colors"
                      >
                        {comment.showReplies ? "Masquer" : "Voir"} {comment.repliesCount} réponse{comment.repliesCount > 1 ? 's' : ''}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Formulaire de réponse */}
              {replyingTo === comment.id && (
                <div className="ml-10 flex gap-2">
                  <Avatar className="h-6 w-6 flex-shrink-0">
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
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder={`Répondre à ${comment.author_username}...`}
                      className="bg-slate-800 border-slate-700 text-white resize-none min-h-[32px] text-sm"
                      rows={1}
                    />
                    <Button
                      size="icon"
                      onClick={() => handleReply(comment.id)}
                      disabled={!replyText.trim()}
                      className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 h-8 w-8"
                    >
                      <Send className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}

              {/* Réponses */}
              {comment.showReplies && comment.replies.length > 0 && (
                <div className="ml-10 space-y-2">
                  {comment.replies.map((reply) => (
                    <div key={reply.id} className="flex gap-2">
                      <Avatar className="h-6 w-6 flex-shrink-0">
                        {reply.author_profile_pic ? (
                          <AvatarImage src={reply.author_profile_pic} alt={reply.author_username} />
                        ) : (
                          <AvatarFallback className="bg-gradient-to-r from-purple-500 to-pink-500 text-xs">
                            {getInitials(reply.author_username)}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <div className="flex-1 bg-slate-800/30 rounded-lg p-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-xs">{reply.author_username}</span>
                          <span className="text-xs text-slate-400">{formatDate(reply.created_at)}</span>
                        </div>
                        <p className="text-xs text-slate-200">{reply.content}</p>
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
