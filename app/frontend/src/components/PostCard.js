import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { toast } from "sonner";
import CommentsSection from "./CommentsSection";
import TipModal from "./TipModal";

const C = {
  surface:    "#0b1326",
  container:  "#171f33",
  high:       "#222a3d",
  cyan:       (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee",
  onPrimary:  "#00363e",
  outline:    "#859397",
  onSurface:  "#dae2fd",
  onVariant:  "#bbc9cd",
};

/**
 * Vidéo du fil d'accueil : lecture automatique (muette) dès qu'elle est visible
 * à l'écran, mise en pause quand elle en sort (façon X / Instagram). Un bouton
 * son permet de réactiver l'audio ; les contrôles natifs restent disponibles.
 */
function FeedVideo({ src }) {
  const ref = useRef(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: [0, 0.6, 1] }
    );
    io.observe(video);
    return () => io.disconnect();
  }, []);

  return (
    <div className="relative rounded-xl overflow-hidden border" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
      <video
        ref={ref}
        src={src}
        className="w-full max-h-[560px] bg-black"
        muted={muted}
        loop
        playsInline
        controls
        preload="metadata"
      />
      {/* Bouton son (l'autoplay impose le mode muet au départ) */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setMuted((m) => !m); }}
        className="absolute bottom-3 right-3 w-9 h-9 rounded-full flex items-center justify-center"
        style={{ background: "rgba(0,0,0,0.55)" }}
        title={muted ? "Activer le son" : "Couper le son"}
      >
        <span className="material-symbols-outlined text-white text-lg">{muted ? "volume_off" : "volume_up"}</span>
      </button>
    </div>
  );
}

export default function PostCard({ post, currentUser, onUpdate, onDelete }) {
  const navigate = useNavigate();
  const [isLiked, setIsLiked]         = useState(post.is_liked || false);
  const [likesCount, setLikesCount]   = useState(post.likes_count || 0);
  const [sharesCount, setSharesCount] = useState(post.shares_count || 0);
  const [commentsCount, setCommentsCount] = useState(post.comments_count || 0);
  const [isSaved, setIsSaved]         = useState(post.is_saved || false);
  const [showComments, setShowComments]   = useState(false);
  const [showTip, setShowTip]             = useState(false);
  const [reposted, setReposted]       = useState(
    post.is_reposted || (!!post.repost_of && post.author_id === currentUser?.id)
  );
  const [repostLoading, setRepostLoading] = useState(false);

  // Republication : on agit toujours sur la publication D'ORIGINE.
  const isRepost = !!post.repost_of;
  const originalId = post.repost_of || post.id;
  // Auteur affiché : l'auteur d'origine pour un repost, sinon l'auteur du post.
  const displayAuthorId = isRepost ? post.original_author_id : post.author_id;
  const displayAuthorName = isRepost ? post.original_author_username : post.author_username;
  const displayAuthorPic = isRepost ? post.original_author_profile_pic : post.author_profile_pic;
  const displayAuthorVerified = isRepost ? post.original_author_is_verified : post.author_is_verified;
  const [poll, setPoll]               = useState(post.poll || null);
  const [pollVote, setPollVote]       = useState(post.poll_user_vote || null);
  const [pollLoading, setPollLoading] = useState(false);

  const handleLike = async () => {
    try {
      const res = await axios.post(`${API}/posts/${post.id}/like`);
      setIsLiked(res.data.liked);
      setLikesCount((p) => (res.data.liked ? p + 1 : p - 1));
    } catch {
      toast.error("Erreur lors du like");
    }
  };

  const handleSave = async () => {
    // Optimiste : on bascule tout de suite, on annule si l'API échoue.
    const next = !isSaved;
    setIsSaved(next);
    try {
      const res = await axios.post(`${API}/posts/${post.id}/save`);
      setIsSaved(res.data.saved);
      toast.success(res.data.saved ? "Enregistré" : "Retiré des enregistrements");
    } catch {
      setIsSaved(!next);
      toast.error("Erreur lors de l'enregistrement");
    }
  };

  const handleShare = async () => {
    // Un repost partage la publication d'ORIGINE (URL canonique).
    const url = `${window.location.origin}/post/${originalId}`;
    const shareData = {
      title: `${displayAuthorName} sur Nexus`,
      text: post.content ? post.content.slice(0, 120) : "Découvre cette publication sur Nexus",
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Lien copié dans le presse-papiers");
      }
    } catch (err) {
      // L'utilisateur a annulé le partage natif → on ne fait rien.
      if (err && err.name !== "AbortError") {
        try { await navigator.clipboard.writeText(url); toast.success("Lien copié"); }
        catch { toast.error("Impossible de partager"); }
      }
    }
  };

  const [pinned, setPinned] = useState(post.is_pinned || false);
  const handlePin = async () => {
    try {
      const res = await axios.post(`${API}/posts/${post.id}/pin`);
      setPinned(res.data.pinned);
      toast.success(res.data.pinned ? "Publication épinglée en haut du profil" : "Publication désépinglée");
      onUpdate?.({ ...post, is_pinned: res.data.pinned });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Action impossible");
    }
  };

  // Clic sur la carte (hors éléments interactifs) → page détail = fil de
  // commentaires complet (lecture / réponse / identification), façon X.
  // Un repost ouvre le fil de la publication d'ORIGINE (les commentaires y vivent).
  const openThread = () => navigate(`/post/${originalId}`);

  // Double-tap « like » sur la photo (façon Instagram) : cœur animé + like.
  const lastTapRef = useRef(0);
  const [heartBurst, setHeartBurst] = useState(false);
  const doubleTapLike = () => {
    if (!isLiked) handleLike();          // ne fait que liker (jamais unliker) au double-tap
    setHeartBurst(true);
    setTimeout(() => setHeartBurst(false), 700);
  };
  const onMediaTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) { doubleTapLike(); lastTapRef.current = 0; }
    else lastTapRef.current = now;
  };

  const handleRepost = async () => {
    if (!currentUser) { toast.error("Vous devez être connecté"); return; }
    if (repostLoading) return;
    if (displayAuthorId === currentUser.id) { toast.error("Vous ne pouvez pas reposter votre propre publication"); return; }

    try {
      setRepostLoading(true);
      if (reposted) {
        // Annuler la republication : le compteur se met à jour.
        const res = await axios.delete(`${API}/posts/${originalId}/repost`);
        setReposted(false);
        setSharesCount((p) => (typeof res.data?.shares_count === "number" ? res.data.shares_count : Math.max(0, p - 1)));
        toast.success("Republication annulée");
        // Si on regardait notre propre repost, il disparaît de la liste.
        if (isRepost && post.author_id === currentUser.id) onDelete?.(post.id);
      } else {
        await axios.post(`${API}/posts/${originalId}/repost`);
        setReposted(true);
        setSharesCount((p) => p + 1);
        toast.success("Publication repostée !");
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors du repost");
    } finally {
      setRepostLoading(false);
    }
  };

  const handleDelete = async () => {
    // Pour un repost, « supprimer » = annuler la republication (met à jour le
    // compteur de partages de l'original et retire le repost du profil).
    const label = isRepost ? "Annuler cette republication ?" : "Êtes-vous sûr de vouloir supprimer ce post ?";
    if (!window.confirm(label)) return;
    try {
      if (isRepost) {
        await axios.delete(`${API}/posts/${originalId}/repost`);
        toast.success("Republication annulée");
      } else {
        await axios.delete(`${API}/posts/${post.id}`);
        toast.success("Post supprimé avec succès");
      }
      onDelete?.(post.id);
    } catch {
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleVote = async (optionId) => {
    if (pollLoading || pollVote === optionId) return;
    try {
      setPollLoading(true);
      const res = await axios.post(`${API}/posts/${post.id}/vote`, { option_id: optionId });
      setPoll(res.data.poll);
      setPollVote(res.data.poll_user_vote);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors du vote");
    } finally {
      setPollLoading(false);
    }
  };

  const handleCommentAdded   = () => setCommentsCount((p) => p + 1);
  const handleCommentDeleted = () => setCommentsCount((p) => Math.max(0, p - 1));

  const getInitials = (u) => (u ? u.substring(0, 2).toUpperCase() : "??");

  // Rend le contenu avec les hashtags et @mentions cliquables (-> recherche)
  const renderContent = (text) => {
    if (!text) return null;
    return text.split(/(\s+)/).map((part, i) => {
      // Lien cliquable : couleur distincte, SANS soulignement.
      if (/^https?:\/\/\S+$/i.test(part)) {
        return (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: "#60a5fa", textDecoration: "none" }}
          >
            {part}
          </a>
        );
      }
      if (/^#[\p{L}0-9_]+$/u.test(part)) {
        return (
          <Link
            key={i}
            to={`/search?q=${encodeURIComponent(part)}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:underline"
            style={{ color: C.cyan }}
          >
            {part}
          </Link>
        );
      }
      if (/^@[\p{L}0-9_]+$/u.test(part)) {
        return (
          <Link
            key={i}
            to={`/search?q=${encodeURIComponent(part.slice(1))}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:underline"
            style={{ color: C.cyan }}
          >
            {part}
          </Link>
        );
      }
      return part;
    });
  };

  const formatDate = (d) => {
    try { return formatDistanceToNow(new Date(d), { addSuffix: true, locale: fr }); }
    catch { return "À l'instant"; }
  };

  const isOwnPost = currentUser?.id === post.author_id;

  return (
    <article
      className="rounded-2xl border overflow-hidden"
      style={{ backgroundColor: C.container, borderColor: "rgba(255,255,255,0.05)" }}
    >
      {/* Repost banner */}
      {post.repost_of && (
        <div className="flex items-center gap-2 px-4 py-2 border-b text-xs font-bold" style={{ backgroundColor: C.high, borderColor: "rgba(255,255,255,0.05)", color: C.outline }}>
          <span className="material-symbols-outlined text-base" style={{ color: C.cyan }}>repeat</span>
          <span><Link to={`/profile/${post.author_id}`} style={{ color: C.cyan }} className="hover:text-cyan-400">@{post.author_username}</Link> a republié</span>
        </div>
      )}

      <div className="p-4 lg:p-5 space-y-4">
        {/* Header */}
        <div className="flex justify-between items-start">
          <Link to={`/profile/${displayAuthorId}`} className="flex gap-3 items-center">
            {displayAuthorPic ? (
              <img src={displayAuthorPic} alt={displayAuthorName} className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
                {getInitials(displayAuthorName)}
              </div>
            )}
            <div className="min-w-0">
              {/* Nom + @username côte à côte (façon X) */}
              <p className="font-bold text-sm transition-colors hover:text-cyan-400 flex items-center gap-1 flex-wrap" style={{ color: C.onSurface }}>
                <span className="truncate">{displayAuthorName}</span>
                {post.author_is_premium && (
                  <span
                    className="material-symbols-outlined text-sm"
                    style={{ color: C.cyan, fontVariationSettings: "'FILL' 1" }}
                    title="Membre Nexus Premium"
                  >
                    workspace_premium
                  </span>
                )}
                <span className="font-normal truncate" style={{ color: C.outline }}>@{displayAuthorName}</span>
              </p>
              <p className="text-xs flex items-center gap-1" style={{ color: C.outline }}>
                {post.is_pinned && (
                  <span className="inline-flex items-center gap-0.5" style={{ color: C.cyan }} title="Publication épinglée">
                    <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>push_pin</span>
                    Épinglé ·
                  </span>
                )}
                {formatDate(post.created_at)}
              </p>
            </div>
          </Link>
          {isOwnPost && (
            <div className="flex items-center gap-1">
              {/* Épingler (créateur Premium). Non affiché pour les reposts. */}
              {!isRepost && (
                <button
                  onClick={handlePin}
                  className="transition-colors hover:text-cyan-400"
                  style={{ color: pinned ? C.cyan : C.outline }}
                  title={pinned ? "Désépingler" : "Épingler en haut du profil (Premium)"}
                >
                  <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: pinned ? "'FILL' 1" : "'FILL' 0" }}>push_pin</span>
                </button>
              )}
              <button onClick={handleDelete} className="transition-colors hover:text-red-400" style={{ color: C.outline }} title="Supprimer">
                <span className="material-symbols-outlined text-xl">delete</span>
              </button>
            </div>
          )}
        </div>

        {/* Content — un clic ouvre le fil complet (façon X). Les liens/mentions
            à l'intérieur stoppent la propagation, donc restent cliquables. */}
        {post.content && (
          <p
            onClick={openThread}
            className="leading-relaxed text-sm lg:text-base whitespace-pre-wrap cursor-pointer"
            style={{ color: C.onVariant }}
          >
            {renderContent(post.content)}
          </p>
        )}

        {/* Poll / Sondage */}
        {poll && Array.isArray(poll.options) && poll.options.length > 0 && (
          <div className="space-y-2">
            {poll.options.map((opt) => {
              const total = poll.total_votes || 0;
              const pct = total > 0 ? Math.round((opt.votes / total) * 100) : 0;
              const voted = !!pollVote;
              const selected = pollVote === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => handleVote(opt.id)}
                  disabled={pollLoading}
                  data-testid={`poll-option-${opt.id}`}
                  className="relative w-full text-left rounded-xl overflow-hidden border px-3 py-2.5 text-sm transition-all"
                  style={{
                    borderColor: selected ? C.cyan : "rgba(255,255,255,0.08)",
                    backgroundColor: C.high,
                    opacity: pollLoading ? 0.7 : 1,
                    cursor: pollLoading ? "default" : "pointer",
                  }}
                >
                  {/* Barre de progression (résultats après vote) */}
                  <div
                    className="absolute inset-y-0 left-0"
                    style={{
                      width: voted ? `${pct}%` : "0%",
                      background: selected ? "rgba(34,211,238,0.25)" : "rgba(255,255,255,0.06)",
                      transition: "width 0.4s ease",
                    }}
                  />
                  <div className="relative flex items-center justify-between gap-2" style={{ color: C.onSurface }}>
                    <span className="flex items-center gap-1.5 font-medium">
                      {selected && (
                        <span className="material-symbols-outlined text-base" style={{ color: C.cyan }}>
                          check_circle
                        </span>
                      )}
                      {opt.text}
                    </span>
                    {voted && (
                      <span className="text-xs font-bold flex-shrink-0" style={{ color: C.onVariant }}>
                        {pct}%
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            <p className="text-xs" style={{ color: C.outline }}>
              {poll.total_votes || 0} vote{(poll.total_votes || 0) !== 1 ? "s" : ""}
              {!pollVote && " · Appuyez pour voter"}
            </p>
          </div>
        )}

        {/* Lien affilié (bouton Shop) */}
        {post.affiliate_link && /^https?:\/\//.test(post.affiliate_link) && (
          <a
            href={post.affiliate_link}
            target="_blank"
            rel="noopener noreferrer nofollow sponsored"
            data-testid="affiliate-shop"
            onClick={(e) => {
              e.stopPropagation();
              axios.post(`${API}/posts/${post.id}/affiliate-click`).catch(() => {});
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}
          >
            <span className="material-symbols-outlined text-lg">shopping_bag</span>
            Shop
          </a>
        )}

        {/* Media */}
        {post.media_url && post.media_type === "image" && (
          <div
            className="relative rounded-xl overflow-hidden border select-none"
            style={{ borderColor: "rgba(255,255,255,0.06)" }}
            onClick={onMediaTap}
            onDoubleClick={doubleTapLike}
          >
            <img src={post.media_url} alt="Post media" className="w-full h-auto object-contain max-h-[560px]" loading="lazy" draggable={false} />
            {/* Cœur animé au double-tap */}
            {heartBurst && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: 110,
                    color: "#fff",
                    fontVariationSettings: "'FILL' 1",
                    textShadow: "0 2px 16px rgba(0,0,0,0.45)",
                    animation: "heartPop 0.7s ease-out",
                  }}
                >
                  favorite
                </span>
              </div>
            )}
          </div>
        )}
        {post.media_url && post.media_type === "video" && (
          <FeedVideo src={post.media_url} />
        )}

        {/* Action bar — réparti (pas serré) : J'aime · Commentaire · Repost · Partage · Enregistrer */}
        <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          {/* Like */}
          <button
            onClick={handleLike}
            title="J'aime"
            className="flex items-center gap-1.5 text-xs font-medium transition-all hover:scale-105"
            style={{ color: isLiked ? "#f87171" : C.outline }}
          >
            <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: isLiked ? "'FILL' 1" : "'FILL' 0" }}>
              favorite
            </span>
            {likesCount > 0 && <span>{likesCount}</span>}
          </button>

          {/* Comment — ouvre le composeur / fil de commentaires */}
          <button
            onClick={() => setShowComments(!showComments)}
            title="Commenter"
            className="flex items-center gap-1.5 text-xs font-medium transition-all hover:scale-105"
            style={{ color: showComments ? C.cyan : C.outline }}
          >
            <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: showComments ? "'FILL' 1" : "'FILL' 0" }}>
              chat_bubble
            </span>
            {commentsCount > 0 && <span>{commentsCount}</span>}
          </button>

          {/* Repost */}
          {!isOwnPost ? (
            <button
              onClick={handleRepost}
              disabled={repostLoading}
              title={reposted ? "Annuler la republication" : "Reposter"}
              className="flex items-center gap-1.5 text-xs font-medium transition-all hover:scale-105"
              style={{ color: reposted ? C.cyan : C.outline, opacity: repostLoading ? 0.6 : 1 }}
            >
              {repostLoading ? (
                <span className="material-symbols-outlined text-lg animate-spin" style={{ animationDuration: "0.7s" }}>refresh</span>
              ) : (
                <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: reposted ? "'FILL' 1" : "'FILL' 0" }}>repeat</span>
              )}
              {sharesCount > 0 && <span>{sharesCount}</span>}
            </button>
          ) : (
            sharesCount > 0 && (
              <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: C.outline }} title="Republications">
                <span className="material-symbols-outlined text-lg">repeat</span>
                {sharesCount}
              </span>
            )
          )}

          {/* Share */}
          <button
            onClick={handleShare}
            title="Partager"
            className="flex items-center gap-1.5 text-xs font-medium transition-all hover:scale-105"
            style={{ color: C.outline }}
          >
            <span className="material-symbols-outlined text-lg">ios_share</span>
          </button>

          {/* Save / Enregistrer */}
          <button
            onClick={handleSave}
            title={isSaved ? "Retirer des enregistrements" : "Enregistrer"}
            className="flex items-center gap-1.5 text-xs font-medium transition-all hover:scale-105"
            style={{ color: isSaved ? C.cyan : C.outline }}
          >
            <span className="material-symbols-outlined text-lg" style={{ fontVariationSettings: isSaved ? "'FILL' 1" : "'FILL' 0" }}>
              bookmark
            </span>
          </button>

          {/* Pourboire (Tip) — contenu ORIGINAL d'un créateur ayant activé Stripe. */}
          {!isOwnPost && !post.repost_of && post.author_can_receive_tips && (
            <button
              onClick={() => setShowTip(true)}
              title={`Envoyer un pourboire à @${displayAuthorName}`}
              className="flex items-center gap-1.5 text-xs font-medium transition-all hover:scale-105 ml-auto"
              style={{ color: C.cyan }}
            >
              <span className="material-symbols-outlined text-lg">volunteer_activism</span>
            </button>
          )}
        </div>

        {/* Comments */}
        {showComments && (
          <CommentsSection
            postId={post.id}
            currentUser={currentUser}
            onCommentAdded={handleCommentAdded}
            onCommentDeleted={handleCommentDeleted}
          />
        )}
      </div>

      {showTip && (
        <TipModal userId={displayAuthorId} username={displayAuthorName} onClose={() => setShowTip(false)} />
      )}
    </article>
  );
}
