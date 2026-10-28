import { useNavigate } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Crown, BadgeCheck } from "lucide-react";

// Date relative courte façon X (« 3 h », « 2 j », sinon la date).
function timeAgo(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 604800) return `${Math.floor(s / 86400)} j`;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

export default function CommentCard({ comment }) {
  const navigate = useNavigate();
  const premium = !!comment.author_is_premium;
  const goProfile = () => navigate(`/profile/${comment.author_id}`);

  return (
    <div data-testid={`comment-${comment.id}`} className="flex gap-3 py-3 border-b border-slate-800/70">
      <Avatar className="w-9 h-9 flex-shrink-0 cursor-pointer" onClick={goProfile}>
        <AvatarImage src={comment.author_profile_pic} />
        <AvatarFallback className="bg-slate-700 text-sm">
          {(comment.author_username || "?")[0].toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap leading-tight">
          <span className="font-semibold text-sm text-white cursor-pointer hover:underline" onClick={goProfile}>
            {comment.author_username}
          </span>
          {comment.author_is_verified && <BadgeCheck className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />}
          {premium && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#f9d976,#c8962c)", color: "#3a2a05" }}>
              <Crown className="w-2.5 h-2.5" />
              <span className="text-[9px] font-black tracking-wide">PREMIUM</span>
            </span>
          )}
          <span className="text-xs text-slate-500">· {timeAgo(comment.created_at)}</span>
        </div>
        <p className="text-[15px] text-slate-100 mt-0.5 whitespace-pre-wrap break-words">{comment.content}</p>
      </div>
    </div>
  );
}
