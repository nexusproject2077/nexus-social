import { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, MessageCircle, Share2, MoreVertical } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";

export default function PostCard({ post, onUpdate, onDelete }) {
  const [isLiked, setIsLiked] = useState(post.is_liked || false);
  const [likesCount, setLikesCount] = useState(post.likes_count || 0);
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

  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");
  const isOwnPost = currentUser.id === post.author_id;

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
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Contenu du post */}
        <p className="text-slate-100 whitespace-pre-wrap">{post.content}</p>

        {/* Image ou vidéo */}
        {post.media_url && post.media_type === "image" && (
          <div className="rounded-lg overflow-hidden">
            <img
              src={post.media_url}
              alt="Post media"
              className="w-full object-cover max-h-96"
            />
          </div>
        )}

        {post.media_url && post.media_type === "video" && (
          <div className="rounded-lg overflow-hidden">
            <video
              src={post.media_url}
              controls
              className="w-full max-h-96"
            />
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-col space-y-3">
        {/* Stats */}
        <div className="flex items-center justify-between w-full text-sm text-slate-400">
          <span>{likesCount} j'aime</span>
          <span>{post.comments_count || 0} commentaires</span>
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

        {/* Section commentaires (à implémenter plus tard) */}
        {showComments && (
          <div className="w-full pt-3 border-t border-slate-800">
            <p className="text-sm text-slate-400">Commentaires à venir...</p>
          </div>
        )}
      </CardFooter>
    </Card>
  );
}
