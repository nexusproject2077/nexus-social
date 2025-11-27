import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function CommentCard({ comment }) {
  const navigate = useNavigate();

  return (
    <div
      data-testid={`comment-${comment.id}`}
      className="bg-slate-900 rounded-lg p-4 border border-slate-800"
    >
      <div
        className="flex items-center gap-3 mb-2 cursor-pointer"
        onClick={() => navigate(`/profile/${comment.author_id}`)}
      >
        <Avatar className="w-8 h-8">
          <AvatarImage src={comment.author_profile_pic} />
          <AvatarFallback className="bg-slate-700 text-sm">
            {comment.author_username[0].toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="font-semibold text-sm">{comment.author_username}</p>
          <p className="text-xs text-slate-400">
            {new Date(comment.created_at).toLocaleString('fr-FR')}
          </p>
        </div>
      </div>
      <p className="text-white text-sm">{comment.content}</p>
    </div>
  );
}
