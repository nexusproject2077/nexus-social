import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Heart, MessageCircle, Share2, MoreVertical, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function PostCard({ post, currentUser, onUpdate, onDelete, showFullContent }) {
  const navigate = useNavigate();
  const [isLiking, setIsLiking] = useState(false);

  const handleLike = async (e) => {
    e.stopPropagation();
    if (isLiking) return;
    setIsLiking(true);

    try {
      const response = await axios.post(`${API}/posts/${post.id}/like`);
      const newLikesCount = post.likes_count + (response.data.liked ? 1 : -1);
      onUpdate({
        ...post,
        is_liked: response.data.liked,
        likes_count: newLikesCount,
      });
    } catch (error) {
      toast.error("Erreur lors de l'action");
    } finally {
      setIsLiking(false);
    }
  };

  const handleShare = async (e) => {
    e.stopPropagation();
    try {
      await axios.post(`${API}/posts/${post.id}/share`);
      toast.success("Publication partagée");
    } catch (error) {
      toast.error("Erreur lors du partage");
    }
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!window.confirm("Voulez-vous vraiment supprimer cette publication?")) return;

    try {
      await axios.delete(`${API}/posts/${post.id}`);
      if (onDelete) onDelete(post.id);
      toast.success("Publication supprimée");
    } catch (error) {
      toast.error("Erreur lors de la suppression");
    }
  };

  const handlePostClick = () => {
    navigate(`/post/${post.id}`);
  };

  const handleProfileClick = (e) => {
    e.stopPropagation();
    navigate(`/profile/${post.author_id}`);
  };

  return (
    <div
      data-testid={`post-${post.id}`}
      onClick={showFullContent ? undefined : handlePostClick}
      className={`bg-slate-900 rounded-lg p-4 border border-slate-800 ${
        !showFullContent ? 'cursor-pointer hover:bg-slate-900/80' : ''
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 cursor-pointer" onClick={handleProfileClick}>
          <Avatar>
            <AvatarImage src={post.author_profile_pic} />
            <AvatarFallback className="bg-slate-700">
              {post.author_username[0].toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-semibold">{post.author_username}</p>
            <p className="text-xs text-slate-400">
              {new Date(post.created_at).toLocaleString('fr-FR')}
            </p>
          </div>
        </div>

        {currentUser.id === post.author_id && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={(e) => e.stopPropagation()}
                data-testid={`post-menu-${post.id}`}
              >
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-slate-900 border-slate-700">
              <DropdownMenuItem
                data-testid={`delete-post-${post.id}`}
                onClick={handleDelete}
                className="text-red-400 cursor-pointer"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <p className="text-white mb-3 whitespace-pre-wrap">{post.content}</p>

      {post.media_url && (
        <div className="mb-3">
          {post.media_type === 'image' ? (
            <img
              src={post.media_url}
              alt="Post media"
              className="post-image w-full rounded-lg max-h-96 object-cover"
            />
          ) : post.media_type === 'video' ? (
            <video
              src={post.media_url}
              controls
              className="post-video w-full rounded-lg"
            />
          ) : null}
        </div>
      )}

      <div className="flex items-center gap-6 text-slate-400">
        <Button
          data-testid={`like-button-${post.id}`}
          variant="ghost"
          size="sm"
          onClick={handleLike}
          className={`gap-2 ${
            post.is_liked ? 'text-red-500' : 'hover:text-red-500'
          }`}
        >
          <Heart className="w-5 h-5" fill={post.is_liked ? 'currentColor' : 'none'} />
          <span>{post.likes_count}</span>
        </Button>

        <Button
          data-testid={`comment-button-${post.id}`}
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/post/${post.id}`);
          }}
          className="gap-2 hover:text-blue-500"
        >
          <MessageCircle className="w-5 h-5" />
          <span>{post.comments_count}</span>
        </Button>

        <Button
          data-testid={`share-button-${post.id}`}
          variant="ghost"
          size="sm"
          onClick={handleShare}
          className="gap-2 hover:text-green-500"
        >
          <Share2 className="w-5 h-5" />
          <span>{post.shares_count}</span>
        </Button>
      </div>
    </div>
  );
}
