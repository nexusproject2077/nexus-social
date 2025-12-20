import { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, MessageCircle, Share2, Trash2 } from "lucide-react";
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
      setLikesCount(prev => response.data.liked ? prev + 1 : prev - 1);
    } catch (error) {
      console.error("Erreur lors du like:", error);
      toast.error("Erreur lors du like");
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Êtes-vous sûr de vouloir supprimer ce post ?")) {
      return;
    }

    try {
      await axios.delete(`${API}/posts/${post.id}`);
      toast.success("Post supprimé avec succès");
      if (onDelete) {
        onDelete(post.id);
      }
    } catch (error) {
      console.error("Erreur lors de la suppression:", error);
      toast.error("Erreur lors de la suppression");
    }
  };

  // ✅ Callback quand un commentaire est ajouté
  const handleCommentAdded = () => {
    setCommentsCount(prev => prev + 1);
  };

  // ✅ Callback quand un commentaire est supprimé
  const handleCommentDeleted = () => {
    setCommentsCount(prev => Math.max(0, prev - 1));
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

  const isOwnPost = currentUser?.id === post.author_id;

  return (
    <Card className="bg-slate-900 border-slate-800 text-white mb-4">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center space-x-3">
          <Link to={`/profile/${post.author_id}`}>
            <Avatar className="h-10 w-10">
              {post.author_profile_pic ? (
                <AvatarImage src={post.author_profile_pic} alt={post.author_username} />
              ) : (
                <AvatarFallback className="bg-gradient-to-r from-cyan-500 to-blue-500">
                  {getInitials(post.author_username)}
                </AvatarFallback>
              )}
            </Avatar>
          </Link>
          <div>
            <Link 
              to={`/profile/${post.author_id}`}
              className="font-semibold hover:underline"
            >
              {post.author_username}
            </Link>
            <p className="text-xs text-slate-400">
              {formatDate(post.created_at)}
            </p>
          </div>
        </div>
        {isOwnPost && (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            className="text-slate-400 hover:text-red-500"
            title="Supprimer le post"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Contenu du post */}
        <p className="text-slate-100 whitespace-pre-wrap">{post.content}</p>

        {/* ✅ Image avec aspect ratio adaptatif */}
        {post.media_url && post.media_type === "image" && (
          <div className="rounded-lg overflow-hidden bg-slate-800">
            <img
              src={post.media_url}
              alt="Post media"
              className="w-full h-auto object-contain max-h-[600px]"
              loading="lazy"
            />
          </div>
        )}

        {/* Vidéo */}
        {post.media_url && post.media_type === "video" && (
          <div className="rounded-lg overflow-hidden">
            <video
              src={post.media_url}
              controls
              className="w-full max-h-[600px]"
            />
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-col space-y-3">
        {/* Stats */}
        <div className="flex items-center justify-between w-full text-sm text-slate-400">
          <span>{likesCount} j'aime</span>
          <span>{commentsCount} commentaire{commentsCount !== 1 ? 's' : ''}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-around w-full border-t border-slate-800 pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLike}
            className={`flex items-center space-x-2 ${
              isLiked ? "text-red-500" : "text-slate-400"
            } hover:text-red-500`}
          >
            <Heart className={`h-5 w-5 ${isLiked ? "fill-current" : ""}`} />
            <span>J'aime</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowComments(!showComments)}
            className="flex items-center space-x-2 text-slate-400 hover:text-blue-500"
          >
            <MessageCircle className="h-5 w-5" />
            <span>Commenter</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="flex items-center space-x-2 text-slate-400 hover:text-green-500"
          >
            <Share2 className="h-5 w-5" />
            <span>Partager</span>
          </Button>
        </div>

        {/* Section commentaires */}
        {showComments && (
          <CommentsSection 
            postId={post.id} 
            currentUser={currentUser}
            onCommentAdded={handleCommentAdded}
            onCommentDeleted={handleCommentDeleted}
          />
        )}
      </CardFooter>
    </Card>
  );
}
