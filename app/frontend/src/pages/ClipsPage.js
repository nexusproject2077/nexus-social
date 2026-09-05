import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import PullToRefresh from "@/components/PullToRefresh";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { isFirebaseConfigured, uploadVideoResumable } from "@/lib/firebase";
import { buildMutedMatcher } from "@/lib/mutedWords";
import { SURFACE, TEXT, ACCENT } from "@/lib/theme";
import StoryComposer from "@/components/StoryComposer";
import { attachSilent, clearNowPlaying } from "@/lib/silentAudio";
import useDraggableSheet from "@/hooks/useDraggableSheet";
import useKeyboardInset from "@/hooks/useKeyboardInset";
import ClipPublishScreen from "@/components/ClipPublishScreen";

// Le son d'un clip peut être routé par la Web Audio API pour ne PAS réclamer la
// session « Now Playing » iOS (indicateur son dans la barre d'état). On ne le
// fait que si l'URL autorise le CORS (Cloudinary / data / blob), sinon le
// crossOrigin casserait le chargement de la vidéo → on reste alors en natif.
const CLIP_CORS_SAFE = (url = "") =>
  url.startsWith("data:") || url.startsWith("blob:") ||
  /(^|\/\/)([^/]*\.)?cloudinary\.com\//.test(url) || url.includes("/video/upload/");

// Tokens dérivés de la source unique (@/lib/theme) : cohérence avec Messages /
// Stories / Profil.
const C = {
  surface:   SURFACE.base,
  high:      SURFACE.high,
  cyan:      ACCENT,
  onPrimary: TEXT.onAccent,
  outline:   TEXT.muted,
  outlineVar: "#3c494c",
  onSurface: TEXT.primary,
  rose:      "#f472b6", // « rose doux » Nexus pour les J'aime (pas le rouge TikTok)
};

const fmtNum = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : n);
const fmtRel = (d) => { try { return formatDistanceToNow(new Date(d), { addSuffix: true, locale: fr }); } catch { return ""; } };

// Un commentaire de clip : like, réponses, et suppression par son auteur.
function CommentItem({ comment, currentUser, clipAuthorId, onDeleted }) {
  const { t } = useTranslation();
  const isCreator = clipAuthorId && comment.author_id === clipAuthorId;
  const [liked, setLiked]   = useState(comment.is_liked || false);
  const [likes, setLikes]   = useState(comment.likes_count || 0);
  const [repCount, setRepCount] = useState(comment.replies_count || 0);
  const [showReplies, setShowReplies] = useState(false);
  const [replies, setReplies] = useState([]);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");

  const toggleLike = async () => {
    // Optimiste : on inverse tout de suite, on corrige avec la réponse serveur.
    setLiked((v) => !v);
    setLikes((n) => (liked ? n - 1 : n + 1));
    try {
      const r = await axios.post(`${API}/comments/${comment.id}/like`);
      setLiked(r.data.liked);
    } catch {
      setLiked((v) => !v);
      setLikes((n) => (liked ? n + 1 : n - 1));
    }
  };

  const loadReplies = async () => {
    const next = !showReplies;
    setShowReplies(next);
    if (next && replies.length === 0 && repCount > 0) {
      try {
        const r = await axios.get(`${API}/comments/${comment.id}/replies`);
        setReplies(r.data || []);
      } catch { /* ignore */ }
    }
  };

  const sendReply = async () => {
    if (!replyText.trim()) return;
    try {
      const r = await axios.post(`${API}/comments/${comment.id}/replies`, { content: replyText });
      if (r.data && r.data.id) setReplies((prev) => [...prev, r.data]);
      setRepCount((n) => n + 1);
      setReplyText("");
      setShowReplies(true);
    } catch { toast.error(t("clips.err_generic")); }
  };

  const deleteReply = async (rid) => {
    try {
      await axios.delete(`${API}/comments/${comment.id}/replies/${rid}`);
      setReplies((prev) => prev.filter((x) => x.id !== rid));
      setRepCount((n) => Math.max(0, n - 1));
    } catch { toast.error(t("clips.err_generic")); }
  };

  const Avatar = ({ pic, name, size = "w-7 h-7" }) => (
    pic ? (
      <img src={pic} alt={name} className={`${size} rounded-full object-cover flex-shrink-0`} />
    ) : (
      <div className={`${size} rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0`} style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
        {(name || "?")[0].toUpperCase()}
      </div>
    )
  );

  return (
    <div className="flex gap-2.5 items-start">
      <Avatar pic={comment.author_profile_pic} name={comment.author_username} />
      <div className="flex-1 min-w-0">
        <p className="text-xs" style={{ color: C.onSurface }}>
          <span className="font-bold">@{comment.author_username}</span>
          {isCreator && (
            <span
              className="inline-flex items-center align-middle ml-1.5 px-1.5 py-px rounded-full text-[9px] font-black uppercase tracking-wide"
              style={{ background: `${C.cyan}22`, color: C.cyan }}
            >
              {t("creator.badge")}
            </span>
          )}{" "}
          <span>{comment.content}</span>
        </p>
        <div className="flex items-center gap-4 mt-1">
          <span className="text-[10px]" style={{ color: C.outline }}>{fmtRel(comment.created_at)}</span>
          <button onClick={() => setReplyOpen((v) => !v)} className="text-[10px] font-semibold" style={{ color: C.outline }}>
            Répondre
          </button>
          {repCount > 0 && (
            <button onClick={loadReplies} className="text-[10px] font-semibold" style={{ color: C.cyan }}>
              {showReplies ? "Masquer" : `${repCount} réponse${repCount > 1 ? "s" : ""}`}
            </button>
          )}
          {currentUser?.id === comment.author_id && (
            <button onClick={() => onDeleted?.(comment.id)} className="text-[10px] font-semibold" style={{ color: "#f87171" }}>
              {t("clips.delete")}
            </button>
          )}
        </div>

        {replyOpen && (
          <div className="flex gap-2 items-center mt-2">
            <input
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={`Répondre à @${comment.author_username}…`}
              className="flex-1 bg-transparent outline-none text-xs py-1.5 px-2.5 rounded-lg"
              style={{ backgroundColor: C.high, color: C.onSurface, border: "1px solid rgba(255,255,255,0.08)" }}
              onKeyDown={(e) => { if (e.key === "Enter") sendReply(); }}
            />
            <button onClick={sendReply} className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
              <span className="material-symbols-outlined text-xs">send</span>
            </button>
          </div>
        )}

        {showReplies && replies.map((rp) => (
          <div key={rp.id} className="flex gap-2 items-start mt-2 pl-1">
            <Avatar pic={rp.author_profile_pic} name={rp.author_username} size="w-6 h-6" />
            <div className="flex-1 min-w-0">
              <p className="text-xs" style={{ color: C.onSurface }}>
                <span className="font-bold">@{rp.author_username}</span>{" "}
                <span>{rp.content}</span>
              </p>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-[10px]" style={{ color: C.outline }}>{fmtRel(rp.created_at)}</span>
                {currentUser?.id === rp.author_id && (
                  <button onClick={() => deleteReply(rp.id)} className="text-[10px] font-semibold" style={{ color: "#f87171" }}>
                    {t("clips.delete")}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Like du commentaire */}
      <button onClick={toggleLike} className="flex flex-col items-center gap-0.5 flex-shrink-0">
        <span className="material-symbols-outlined text-base" style={{ color: liked ? C.rose : C.outline, fontVariationSettings: liked ? "'FILL' 1" : "'FILL' 0" }}>
          favorite
        </span>
        {likes > 0 && <span className="text-[10px]" style={{ color: C.outline }}>{fmtNum(likes)}</span>}
      </button>
    </div>
  );
}

function ClipCard({ post, currentUser, isActive, index, registerVideo, onDelete, onCommentsOpenChange }) {
  const { t } = useTranslation();
  const navigate  = useNavigate();
  const videoRef  = useRef(null);
  const sceneRef  = useRef(null);
  const [isLiked, setIsLiked]       = useState(post.is_liked || false);
  const [likes, setLikes]           = useState(post.likes_count || 0);
  const [comments, setComments]     = useState(post.comments_count || 0);
  // Son ACTIVÉ par défaut. Si le navigateur bloque l'autoplay avec son (politique
  // mobile), on retombe automatiquement en muet pour au moins lancer la lecture,
  // puis un tap réactive le son. La préférence de l'utilisateur est mémorisée.
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem("nexus_clips_muted") === "1"; } catch { return false; }
  });
  const [paused, setPaused]         = useState(false);
  const [saved, setSaved]           = useState(post.is_saved || false);
  const [reposted, setReposted]     = useState(post.is_reposted || false);
  const [repostBusy, setRepostBusy] = useState(false);
  // Suivi de l'auteur (bouton « + » façon TikTok) : masqué si c'est mon clip ou
  // si je suis déjà abonné. `followDone` déclenche l'animation de disparition.
  const isOwnClip = currentUser?.id === post.author_id;
  const [following, setFollowing]   = useState(post.author_is_following || false);
  const [followDone, setFollowDone] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [showOptions, setShowOptions] = useState(false); // menu « … » du clip
  const [progress, setProgress]     = useState(0);
  const [duration, setDuration]     = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [scrubbing, setScrubbing]   = useState(false);
  const barRef = useRef(null);
  const [heart, setHeart]           = useState(false);   // cœur animé (double-tap)
  const [showComment, setShowComment] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentsList, setCommentsList] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  // Poignée manipulable : glisser vers le haut = plein écran (~92 %), vers le
  // bas = réduire / fermer ; relâcher = calage (fermé / demi ~45 % / plein).
  const commentSheet = useDraggableSheet({
    open: showComment,
    onClose: () => setShowComment(false),
    snaps: [0.45, 0.92],
    initial: 0.45,
  });
  // Le clavier iOS/Android fait remonter le sheet au-dessus de lui.
  const kbInset = useKeyboardInset();
  // Remonte l'état d'ouverture des commentaires à la page (coupe le
  // pull-to-refresh + masque la barre du bas). Nettoyage au démontage du clip.
  useEffect(() => {
    onCommentsOpenChange?.(showComment);
  }, [showComment, onCommentsOpenChange]);
  useEffect(() => () => onCommentsOpenChange?.(false), [onCommentsOpenChange]);
  const tapTimer = useRef(null);
  // Vitesse 2x (appui long) + plein écran 16:9 + seek ±5s.
  const [speeding, setSpeeding]     = useState(false);   // lecture 2x en cours
  const [isLandscape, setIsLandscape] = useState(false); // vidéo publiée en 16:9 ?
  const [isFs, setIsFs]             = useState(false);    // plein écran actif
  const [seekFlash, setSeekFlash]   = useState(null);     // "+5" | "-5" (feedback)
  const longPressTimer = useRef(null);
  const longPressFired = useRef(false);

  // --- Signal de temps de visionnage (algorithme « Pour toi ») -------------
  // On mesure le temps réellement regardé (onglet visible + lecture) et si le
  // clip a été (quasi) terminé, puis on l'envoie au backend en quittant le clip.
  const watchMsRef   = useRef(0);
  const completedRef = useRef(false);
  const reportedRef  = useRef(false);

  const reportWatch = () => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    const v = videoRef.current;
    const durMs = v && v.duration && isFinite(v.duration) ? Math.round(v.duration * 1000) : 0;
    const watch = Math.round(watchMsRef.current);
    if (watch < 300) return; // trop court → bruit, on n'envoie pas
    const completed = completedRef.current || (durMs > 0 && watch >= durMs * 0.9);
    axios.post(`${API}/clips/${post.id}/watch`, { watched_ms: watch, duration_ms: durMs, completed }).catch(() => {});
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // Réinitialise les compteurs à chaque (dés)activation du clip.
    watchMsRef.current = 0;
    completedRef.current = false;
    reportedRef.current = false;
    if (!isActive) return;
    let raf = 0, last = 0;
    const tick = (t) => {
      if (last && !v.paused && !v.ended && document.visibilityState === "visible") {
        watchMsRef.current += (t - last);
      }
      last = t;
      if (v.duration && isFinite(v.duration) && v.currentTime / v.duration >= 0.9) {
        completedRef.current = true;
      }
      raf = requestAnimationFrame(tick);
    };
    const onEnded = () => { completedRef.current = true; };
    raf = requestAnimationFrame(tick);
    v.addEventListener("ended", onEnded);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      v.removeEventListener("ended", onEnded);
      reportWatch(); // on quitte ce clip → on remonte le signal
    };
  }, [isActive]);

  // Enregistre l'élément vidéo auprès du parent (contrôle clavier : espace).
  useEffect(() => {
    registerVideo?.(index, videoRef.current);
    return () => registerVideo?.(index, null);
  }, [index, registerVideo]);

  // Route le son du clip par la Web Audio API (si CORS-safe) → pas d'indicateur
  // son dans la Dynamic Island / barre d'état. Le mute continue de fonctionner
  // (une vidéo `muted` reste silencieuse même routée). Repli natif sinon.
  useEffect(() => {
    if (!CLIP_CORS_SAFE(post.media_url)) return;
    return attachSilent(videoRef.current);
  }, [post.media_url]);

  // À la disparition définitive du clip (on quitte l'onglet Clips), on efface la
  // session résiduelle pour que l'indicateur son parte des autres pages.
  useEffect(() => () => clearNowPlaying(), []);

  const openComments = async () => {
    const next = !showComment;
    setShowComment(next);
    if (next) {
      try {
        setLoadingComments(true);
        const r = await axios.get(`${API}/posts/${post.id}/comments`);
        setCommentsList(r.data || []);
      } catch { /* ignore */ }
      finally { setLoadingComments(false); }
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isActive) {
      video.muted = muted;
      // On tente la lecture AVEC le son ; si le navigateur la refuse (autoplay
      // policy), on repasse en muet et on relance — au moins la vidéo démarre.
      video.play().catch(() => {
        if (!video.muted) {
          video.muted = true;
          setMuted(true);
          video.play().catch(() => {});
        }
      });
      setPaused(false);
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }, [isActive]);

  // Mémorise la préférence son/muet et l'applique à la vidéo courante.
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = muted;
    try { localStorage.setItem("nexus_clips_muted", muted ? "1" : "0"); } catch { /* ignore */ }
  }, [muted]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) { video.play().catch(() => {}); setPaused(false); }
    else { video.pause(); setPaused(true); }
  };

  const likeHeart = async () => {
    if (isLiked) return; // double-tap = « like », ne dé-like pas
    setIsLiked(true); setLikes((p) => p + 1);
    try {
      const res = await axios.post(`${API}/posts/${post.id}/like`);
      setIsLiked(res.data.liked); setLikes((p) => (res.data.liked ? p : p - 1));
    } catch { setIsLiked(false); setLikes((p) => p - 1); }
  };

  const triggerHeart = () => { setHeart(true); setTimeout(() => setHeart(false), 800); };

  // Barre de progression manipulable : on convertit la position X du doigt/souris
  // en temps de lecture. Fonctionne au clic simple comme au glissement.
  const seekToClientX = (clientX) => {
    const el = barRef.current;
    const v = videoRef.current;
    if (!el || !v || !v.duration) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = frac * v.duration;
    setProgress(frac * 100);
    setCurrentTime(v.currentTime);
  };
  const onScrubDown = (e) => { e.stopPropagation(); setScrubbing(true); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } seekToClientX(e.clientX); };
  const onScrubMove = (e) => { if (scrubbing) { e.stopPropagation(); seekToClientX(e.clientX); } };
  const onScrubUp   = (e) => { if (scrubbing) { e.stopPropagation(); setScrubbing(false); } };

  const fmtTime = (s) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // Avance / recule de 5 s (double-tap en plein écran 16:9, façon YouTube).
  const seekBy = (delta) => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + delta));
    setSeekFlash(delta > 0 ? "+5" : "-5");
    setTimeout(() => setSeekFlash(null), 500);
  };

  // Tap simple = play/pause (retardé pour ne pas déclencher au double-tap).
  // Double-tap = like + cœur animé (façon TikTok) — SAUF en plein écran 16:9 où
  // il sert à avancer (droite) / reculer (gauche) de 5 s.
  const handleTap = (e) => {
    // Un appui long (vitesse 2x) vient de se terminer → on ignore ce clic.
    if (longPressFired.current) { longPressFired.current = false; return; }
    const seekMode = isFs && isLandscape;
    if (tapTimer.current) {
      clearTimeout(tapTimer.current); tapTimer.current = null;
      if (seekMode) {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX ?? rect.left + rect.width / 2) - rect.left;
        seekBy(x > rect.width / 2 ? 5 : -5);
      } else {
        likeHeart(); triggerHeart();
      }
    } else {
      tapTimer.current = setTimeout(() => {
        tapTimer.current = null;
        const v = videoRef.current;
        // Plus de bouton volume (design épuré) : un simple tap sur un clip muet
        // (mis en sourdine par la politique d'autoplay) RÉACTIVE le son. Sinon,
        // tap = lecture/pause. La préférence est mémorisée pour les clips suivants.
        if (v && v.muted) {
          v.muted = false;
          setMuted(false);
          try { localStorage.setItem("nexus_clips_muted", "0"); } catch { /* ignore */ }
        } else {
          togglePlay();
        }
      }, 260);
    }
  };

  // Appui long (mobile) sur la vidéo → lecture 2x ; relâchement → 1x.
  const startSpeed = () => {
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      const v = videoRef.current;
      if (v) { v.playbackRate = 2; setSpeeding(true); longPressFired.current = true; }
    }, 350);
  };
  const endSpeed = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    const v = videoRef.current;
    if (v && v.playbackRate !== 1) v.playbackRate = 1;
    if (speeding) setSpeeding(false);
  };

  // Plein écran 16:9 : bascule l'API Fullscreen + tente de forcer le paysage.
  const toggleFullscreen = async (e) => {
    e?.stopPropagation();
    const el = sceneRef.current;
    const video = videoRef.current;
    if (!el) return;
    // iOS (Safari/Chrome) n'expose PAS le plein écran d'élément : seul
    // <video>.webkitEnterFullscreen() fonctionne. Sans ce repli, le bouton
    // « plein écran » ne faisait strictement rien sur iPhone.
    const canElementFs = !!(el.requestFullscreen || el.webkitRequestFullscreen);
    try {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (canElementFs) {
          await (el.requestFullscreen?.() || el.webkitRequestFullscreen?.());
          // Best-effort : verrouille l'orientation paysage (mobiles compatibles).
          try { await window.screen?.orientation?.lock?.("landscape"); } catch { /* refusé sur PC */ }
        } else if (video?.webkitEnterFullscreen) {
          // iPhone : plein écran natif de la vidéo (contrôles système inclus).
          video.webkitEnterFullscreen();
        }
      } else {
        try { window.screen?.orientation?.unlock?.(); } catch { /* ignore */ }
        await (document.exitFullscreen?.() || document.webkitExitFullscreen?.());
      }
    } catch { /* Fullscreen refusé (contexte non autorisé) */ }
  };

  // Suit l'état réel du plein écran (bouton Échap, geste système…).
  useEffect(() => {
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
    };
  }, []);

  const handleShare = async (e) => {
    e.stopPropagation();
    // Lien MIROIR servi par le backend (/clip/:id) → aperçu Open Graph riche
    // (miniature + titre + vidéo) sur WhatsApp/Discord/X + CTA « Ouvrir dans Nexus ».
    const url = `${API.replace(/\/api\/?$/, "")}/clip/${post.id}`;
    try {
      if (navigator.share) await navigator.share({ title: "Nexus Clips", url });
      else { await navigator.clipboard.writeText(url); toast.success(t("clips.link_copied")); }
    } catch { /* annulé */ }
  };

  const toggleSave = async (e) => {
    e.stopPropagation();
    const next = !saved;
    setSaved(next); // optimiste
    try {
      const res = await axios.post(`${API}/posts/${post.id}/save`);
      setSaved(res.data.saved);
      toast.success(res.data.saved ? "Clip enregistré" : "Retiré des enregistrements");
    } catch {
      setSaved(!next);
      toast.error(t("clips.err_save"));
    }
  };

  const handleLike = async (e) => {
    e.stopPropagation();
    try {
      const res = await axios.post(`${API}/posts/${post.id}/like`);
      setIsLiked(res.data.liked);
      setLikes(p => res.data.liked ? p + 1 : p - 1);
    } catch { toast.error(t("clips.err_generic")); }
  };

  // Suivre l'auteur depuis le fil : sur confirmation serveur, le « + » disparaît
  // avec une animation (zoom-out + fondu). Gère compte public (following) et
  // privé (pending → demande envoyée).
  const handleFollow = async (e) => {
    e.stopPropagation();
    if (followBusy || following || isOwnClip) return;
    setFollowBusy(true);
    try {
      const res = await axios.post(`${API}/users/${post.author_id}/follow`);
      const status = res.data?.status;
      if (status === "following" || status === "pending") {
        setFollowDone(true);                 // lance l'animation de disparition
        setTimeout(() => setFollowing(true), 380);
        toast.success(status === "pending" ? "Demande d'abonnement envoyée" : `Abonné à @${post.author_username}`);
      }
    } catch {
      toast.error(t("clips.err_subscribe"));
    } finally {
      setFollowBusy(false);
    }
  };

  // Republier le clip (viralité). Réutilise l'API repost des publications.
  const handleRepost = async (e) => {
    e.stopPropagation();
    if (repostBusy) return;
    if (isOwnClip) { toast.error(t("clips.err_repost_own")); return; }
    setRepostBusy(true);
    try {
      if (reposted) {
        await axios.delete(`${API}/posts/${post.id}/repost`);
        setReposted(false);
        toast.success(t("clips.repost_undone"));
      } else {
        await axios.post(`${API}/posts/${post.id}/repost`);
        setReposted(true);
        toast.success(t("clips.reposted"));
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors du repost");
    } finally {
      setRepostBusy(false);
    }
  };

  // Menu « … » : supprimer (auteur) ou signaler (autres).
  const handleReport = async () => {
    setShowOptions(false);
    try {
      await axios.post(`${API}/reports`, {
        reported_content_id: post.id,
        content_type: "clip",
        reason: "inappropriate",
      });
      toast.success(t("clips.report_sent"));
    } catch { toast.error(t("clips.err_report")); }
  };

  const handleSendComment = async () => {
    if (!commentText.trim()) return;
    try {
      const res = await axios.post(`${API}/posts/${post.id}/comments`, { content: commentText });
      setComments(p => p + 1);
      // Ajoute le commentaire en tête de liste immédiatement.
      if (res.data && res.data.id) setCommentsList((prev) => [res.data, ...prev]);
      else setCommentsList((prev) => [{ id: `tmp-${Date.now()}`, author_username: currentUser?.username, content: commentText, created_at: new Date().toISOString() }, ...prev]);
      setCommentText("");
    } catch { toast.error(t("clips.err_generic")); }
  };

  const handleDeleteComment = async (commentId) => {
    try {
      await axios.delete(`${API}/posts/${post.id}/comments/${commentId}`);
      setCommentsList((prev) => prev.filter((c) => c.id !== commentId));
      setComments((p) => Math.max(0, p - 1));
    } catch { toast.error(t("clips.err_generic")); }
  };

  const fmt = (n) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : n;
  const fmtDate = (d) => { try { return formatDistanceToNow(new Date(d), { addSuffix: true, locale: fr }); } catch { return ""; } };

  return (
    <div className="relative w-full h-full flex-shrink-0 overflow-hidden flex items-center justify-center" style={{ background: "#000" }}>
      {/* Scène : plein écran sur mobile ; colonne 9:16 centrée (letterbox, barres
          noires sur les côtés) sur PC. En plein écran 16:9, on occupe tout l'écran. */}
      <div
        ref={sceneRef}
        className={`relative overflow-hidden ${isFs ? "h-screen w-screen bg-black flex items-center justify-center" : "h-full w-full lg:w-auto lg:aspect-[9/16]"}`}
      >
      {/* Video (Nexus Clips = vidéos uniquement).
          En plein écran 16:9 on passe en object-contain pour respecter le format. */}
      <video
        ref={videoRef}
        src={post.media_url}
        // crossOrigin requis pour router le son par Web Audio (uniquement quand
        // l'URL est CORS-safe, sinon on casserait le chargement de la vidéo).
        crossOrigin={CLIP_CORS_SAFE(post.media_url) ? "anonymous" : undefined}
        // Pas de bascule AirPlay/lecture à distance (évite l'indication système).
        disableRemotePlayback
        // 100 % IMMERSIF façon TikTok : la vidéo remplit tout l'écran (object-cover),
        // plus de bandes noires. Les vidéos paysage restent visibles en entier via
        // le bouton plein écran 16:9.
        className="w-full h-full object-cover"
        loop
        muted={muted}
        playsInline
        // MOBILE : ne PAS pré-charger les clips non actifs. Sans ça, tous les
        // clips de la liste immersive chargeaient leur vidéo (proxy base64) en
        // même temps à l'ouverture → gros gel. Le clip actif se charge à la
        // lecture (déclenchée par isActive) ; le cache backend accélère la suite.
        preload="none"
        onClick={handleTap}
        onPointerDown={startSpeed}
        onPointerUp={endSpeed}
        onPointerLeave={endSpeed}
        onPointerCancel={endSpeed}
        onContextMenu={(e) => e.preventDefault()}
        onLoadedMetadata={(e) => {
          const v = e.target;
          if (v.videoWidth && v.videoHeight) setIsLandscape(v.videoWidth / v.videoHeight >= 1.4);
          if (v.duration && isFinite(v.duration)) setDuration(v.duration);
        }}
        onTimeUpdate={(e) => {
          const v = e.target;
          if (scrubbing) return; // pendant le glissement, on ne suit pas la lecture
          if (v.duration) setProgress((v.currentTime / v.duration) * 100);
          setCurrentTime(v.currentTime);
        }}
      />

      {/* Indicateur vitesse 2x (appui long) */}
      {speeding && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none flex items-center gap-1 px-3 py-1 rounded-full" style={{ background: "rgba(0,0,0,0.6)" }}>
          <span className="material-symbols-outlined text-white text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>fast_forward</span>
          <span className="text-white text-sm font-bold">2x</span>
        </div>
      )}

      {/* Feedback ±5 s (double-tap en plein écran 16:9) */}
      {seekFlash && (
        <div className={`absolute top-1/2 -translate-y-1/2 ${seekFlash === "+5" ? "right-10" : "left-10"} pointer-events-none flex flex-col items-center`}>
          <span className="material-symbols-outlined text-white text-4xl" style={{ fontVariationSettings: "'FILL' 1" }}>
            {seekFlash === "+5" ? "forward_5" : "replay_5"}
          </span>
          <span className="text-white text-sm font-bold">{seekFlash} s</span>
        </div>
      )}

      {/* Gradient overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 40%, rgba(0,0,0,0.2) 100%)" }} />

      {/* Cœur animé (double-tap) */}
      {heart && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="material-symbols-outlined" style={{ color: "#f87171", fontSize: 120, fontVariationSettings: "'FILL' 1", animation: "ping 0.7s cubic-bezier(0,0,0.2,1)", filter: "drop-shadow(0 4px 20px rgba(0,0,0,0.5))" }}>favorite</span>
        </div>
      )}

      {/* Pause indicator */}
      {paused && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
            <span className="material-symbols-outlined text-white text-4xl">pause</span>
          </div>
        </div>
      )}

      {/* Barre de progression ÉPURÉE : une ligne blanche ultra-fine (1px) collée
          juste au-dessus de la barre de navigation. Pas de chrono, pas de curseur
          rond. Reste manipulable (glisser pour avancer) via une zone tactile plus
          haute que la ligne. Masquée en plein écran (l'overlay 16:9 a sa barre). */}
      {!isFs && (
        <div
          ref={barRef}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 right-0 z-20 flex items-end touch-none cursor-pointer"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4rem)", height: 18 }}
        >
          <div className="w-full" style={{ height: scrubbing ? 3 : 1.5, background: "rgba(255,255,255,0.25)", transition: "height 0.12s" }}>
            <div className="h-full" style={{ width: `${progress}%`, background: "#fff" }} />
          </div>
        </div>
      )}

      {/* Overlay d'infos en plein écran 16:9 (progression + likes + commentaires),
          comme la capture. Masqué en mode vertical normal. */}
      {isFs && isLandscape && (
        <div className="absolute bottom-0 left-0 right-0 px-5 pb-4 pt-10" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75), transparent)" }}>
          <div className="flex items-center gap-4 mb-2 text-white">
            <span className="flex items-center gap-1 text-sm font-bold">
              <span className="material-symbols-outlined text-lg" style={{ color: "#f87171", fontVariationSettings: "'FILL' 1" }}>favorite</span>
              {fmt(likes)}
            </span>
            <span className="flex items-center gap-1 text-sm font-bold">
              <span className="material-symbols-outlined text-lg">chat_bubble</span>
              {fmt(comments)}
            </span>
            <span className="ml-auto text-xs opacity-80">Double-tap : ±5 s · Appui long : 2x</span>
            <button onClick={toggleFullscreen} className="flex items-center justify-center w-9 h-9 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} title={t("clips.exit_fullscreen")}>
              <span className="material-symbols-outlined text-white text-xl">fullscreen_exit</span>
            </button>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.25)" }}>
            <div className="h-full" style={{ width: `${progress}%`, background: C.cyan }} />
          </div>
        </div>
      )}

      {/* Right action bar — épurée façon TikTok/Reels : icônes fines SANS bulle
          (ombre portée pour la lisibilité), compteurs centrés sous les icônes,
          plus de libellés « Enreg. » / « Partager » ni d'icône de volume. */}
      <div className="absolute right-3 bottom-28 flex flex-col gap-5 items-center">
        {/* Avatar (réduit ~30 %, vraie photo de profil) */}
        <button onClick={() => navigate(`/profile/${post.author_id}`)} className="relative mb-1">
          {post.author_profile_pic ? (
            <img src={post.author_profile_pic} alt="" className="w-9 h-9 rounded-full object-cover border-2" style={{ borderColor: "#fff" }} />
          ) : (
            <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm border-2" style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary, borderColor: "#fff" }}>
              {post.author_username?.[0]?.toUpperCase()}
            </div>
          )}
          {/* Bouton « + » de suivi : fonctionnel, disparaît en douceur une fois
              l'abonnement confirmé par le serveur. Masqué sur son propre clip. */}
          {!isOwnClip && !following && (
            <span
              role="button"
              aria-label={t("clips.subscribe_to", { name: post.author_username })}
              data-testid="clip-follow"
              onClick={handleFollow}
              className="absolute -bottom-1.5 left-1/2 w-4 h-4 rounded-full flex items-center justify-center"
              style={{
                background: C.cyan,
                color: C.onPrimary,
                boxShadow: "0 1px 5px rgba(0,0,0,0.45)",
                transform: followDone ? "translateX(-50%) scale(0)" : "translateX(-50%) scale(1)",
                opacity: followDone ? 0 : 1,
                transition: "transform 0.36s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease",
                cursor: "pointer",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 12, fontVariationSettings: "'FILL' 1, 'wght' 600" }}>add</span>
            </span>
          )}
        </button>

        {/* Like */}
        <button onClick={handleLike} className="flex flex-col items-center gap-0.5">
          <span className="material-symbols-outlined text-[30px]" style={{ color: isLiked ? "#f87171" : "#fff", fontVariationSettings: `'FILL' ${isLiked ? 1 : 0}, 'wght' 300`, filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.55))" }}>favorite</span>
          <span className="text-white text-xs font-semibold" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>{fmt(likes)}</span>
        </button>

        {/* Comment */}
        <button onClick={(e) => { e.stopPropagation(); openComments(); }} className="flex flex-col items-center gap-0.5">
          <span className="material-symbols-outlined text-[30px] text-white" style={{ fontVariationSettings: "'wght' 300", filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.55))" }}>chat_bubble</span>
          <span className="text-white text-xs font-semibold" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>{fmt(comments)}</span>
        </button>

        {/* Republier (viralité) — icône fine, cohérente avec le reste de la colonne */}
        <button onClick={handleRepost} disabled={repostBusy} title={reposted ? t("clips.cancel_repost") : t("clips.repost")} className="flex flex-col items-center" data-testid="repost-clip">
          <span className="material-symbols-outlined text-[30px]" style={{ color: reposted ? C.cyan : "#fff", fontVariationSettings: `'FILL' ${reposted ? 1 : 0}, 'wght' 300`, filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.55))", opacity: repostBusy ? 0.6 : 1 }}>repeat</span>
        </button>

        {/* Save (sans libellé) */}
        <button onClick={toggleSave} className="flex flex-col items-center">
          <span className="material-symbols-outlined text-[30px]" style={{ color: saved ? C.cyan : "#fff", fontVariationSettings: `'FILL' ${saved ? 1 : 0}, 'wght' 300`, filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.55))" }}>bookmark</span>
        </button>

        {/* Share (sans libellé) */}
        <button onClick={handleShare} className="flex flex-col items-center">
          <span className="material-symbols-outlined text-[30px] text-white" style={{ fontVariationSettings: "'wght' 300", filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.55))" }}>share</span>
        </button>

        {/* Plein écran — paysage uniquement, icône seule */}
        {isLandscape && (
          <button onClick={toggleFullscreen} className="flex flex-col items-center" data-testid="clip-fullscreen">
            <span className="material-symbols-outlined text-[28px] text-white" style={{ fontVariationSettings: "'wght' 300", filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.55))" }}>{isFs ? "fullscreen_exit" : "fullscreen"}</span>
          </button>
        )}

        {/* Options « … » — discret, blanc. Ouvre un menu (supprimer / signaler). */}
        <button
          onClick={(e) => { e.stopPropagation(); setShowOptions(true); }}
          data-testid="clip-options"
          title={t("clips.options")}
          aria-label={t("clips.options_aria")}
          className="flex flex-col items-center"
        >
          <span className="material-symbols-outlined text-[28px] text-white" style={{ fontVariationSettings: "'wght' 300", filter: "drop-shadow(0 1px 4px rgba(0,0,0,0.55))" }}>more_horiz</span>
        </button>
      </div>

      {/* Bottom info (relevé pour laisser la place à la barre de progression) */}
      <div className="absolute left-4 right-20" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 6.5rem)" }}>
        <button onClick={() => navigate(`/profile/${post.author_id}`)} className="font-bold text-white text-sm mb-1 hover:text-cyan-300 transition-colors inline-flex items-center gap-1">
          @{post.author_username}
          {post.author_is_premium && (
            <span className="material-symbols-outlined text-sm" style={{ color: C.cyan, fontVariationSettings: "'FILL' 1" }} title={t("clips.premium_member")}>workspace_premium</span>
          )}
        </button>
        <p className="text-white/80 text-sm leading-snug line-clamp-2">{post.content}</p>
        <p className="text-white/40 text-xs mt-1 flex items-center gap-1.5">
          <span>{fmtDate(post.created_at)}</span>
          <span>·</span>
          <span className="flex items-center gap-0.5">
            <span className="material-symbols-outlined text-xs">play_arrow</span>
            {fmt(post.views || 0)} vues
          </span>
        </p>
      </div>

      {/* Comment panel */}
      {showComment && (
        <div
          className="absolute left-0 right-0 rounded-t-3xl px-4 z-[2] flex flex-col"
          style={{
            bottom: kbInset, // remonte au-dessus du clavier (visualViewport)
            background: "rgba(11,19,38,0.96)",
            backdropFilter: "blur(20px)",
            borderTop: `1px solid ${C.cyan}33`,
            boxShadow: `0 -1px 0 ${C.cyan}22`,
            ...commentSheet.sheetStyle,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Poignée manipulable (glisser haut = agrandir, bas = réduire/fermer) */}
          <div
            {...commentSheet.handleProps}
            className="flex-shrink-0 -mx-4 pt-3 pb-2 flex flex-col items-center"
          >
            <div className="w-10 h-1.5 rounded-full" style={{ background: `${C.cyan}88` }} />
          </div>

          {/* Entête : « X commentaires » + fermer */}
          <div className="flex items-center justify-between mb-3 flex-shrink-0">
            <h3 className="font-bold text-sm" style={{ color: C.onSurface }}>
              {comments} commentaire{comments !== 1 ? "s" : ""}
            </h3>
            <button
              onClick={() => setShowComment(false)}
              className="w-7 h-7 -mr-1 rounded-full flex items-center justify-center active:scale-90 transition-transform"
              style={{ color: C.outline }}
              aria-label={t("cancel")}
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>

          {/* Liste des commentaires — le défilement reste confiné à la liste
              (ne « chaîne » pas vers le clip derrière). */}
          <div
            className="flex-1 overflow-y-auto space-y-3 mb-3"
            style={{ scrollbarWidth: "none", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
            onTouchMove={(e) => e.stopPropagation()}
          >
            {loadingComments ? (
              <p className="text-xs text-center py-4" style={{ color: C.outline }}>{t("clips.loading")}</p>
            ) : commentsList.length === 0 ? (
              <p className="text-xs text-center py-4" style={{ color: C.outline }}>{t("clips.no_comments")}</p>
            ) : (
              commentsList.map((c) => (
                <CommentItem
                  key={c.id}
                  comment={c}
                  currentUser={currentUser}
                  clipAuthorId={post.author_id}
                  onDeleted={handleDeleteComment}
                />
              ))
            )}
          </div>

          {/* Composer collé en bas (safe-area iPhone/Android sans clavier) */}
          <div
            className="flex gap-3 items-center flex-shrink-0"
            style={{ paddingBottom: kbInset ? 8 : "max(env(safe-area-inset-bottom), 12px)" }}
          >
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={t("clips.add_comment")}
              className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-slate-500 py-2 px-4 rounded-full"
              style={{ backgroundColor: C.high, color: C.onSurface, border: `1px solid ${C.outlineVar}` }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSendComment(); }}
            />
            <button onClick={handleSendComment} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
              <span className="material-symbols-outlined text-sm">send</span>
            </button>
          </div>
        </div>
      )}

      {/* Menu d'options « … » — feuille du bas épurée. */}
      {showOptions && (
        <div
          className="absolute inset-0 z-40 flex items-end"
          style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
          onClick={(e) => { e.stopPropagation(); setShowOptions(false); }}
        >
          <div
            className="w-full rounded-t-3xl p-2 pb-3"
            style={{ background: "rgba(17,25,44,0.98)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,255,255,0.08)", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)", animation: "clipSheetUp 0.28s cubic-bezier(0.22,1,0.36,1)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full mx-auto my-2.5" style={{ background: "rgba(255,255,255,0.22)" }} />
            <button
              onClick={(e) => { e.stopPropagation(); setShowOptions(false); handleShare(e); }}
              className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-white text-[15px] font-medium active:bg-white/5"
            >
              <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'wght' 300" }}>share</span>
              {t("clips.share_clip")}
            </button>
            {isOwnClip ? (
              <button
                onClick={(e) => { e.stopPropagation(); setShowOptions(false); onDelete?.(post.id); }}
                data-testid="delete-clip"
                className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-[15px] font-medium active:bg-white/5"
                style={{ color: "#f87171" }}
              >
                <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'wght' 300" }}>delete</span>
                {t("clips.delete_clip")}
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); handleReport(); }}
                data-testid="report-clip"
                className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-[15px] font-medium active:bg-white/5"
                style={{ color: "#f87171" }}
              >
                <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'wght' 300" }}>flag</span>
                {t("clips.report_clip")}
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setShowOptions(false); }}
              className="w-full text-center px-4 py-3.5 mt-1 rounded-2xl text-white/60 text-[15px] font-medium active:bg-white/5"
            >
              {t("clips.cancel")}
            </button>
          </div>
        </div>
      )}
      </div>{/* /stage */}
    </div>
  );
}

export default function ClipsPage({ user, setUser }) {
  const { t } = useTranslation();
  const [clips, setClips]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showComposer, setShowComposer] = useState(false); // caméra plein écran (création clip)
  // Écran de publication façon TikTok : on choisit le fichier, on prépare
  // l'aperçu, PUIS on publie (légende + audience) — pas d'upload immédiat.
  const [pendingClip, setPendingClip] = useState(null);     // { file, previewUrl }
  const [view, setView] = useState("immersive"); // "immersive" | "grid"
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Vrai quand la feuille de commentaires d'un clip est ouverte : on coupe le
  // pull-to-refresh (sinon glisser la poignée rafraîchit la page) et on masque
  // la barre de navigation du bas (sinon elle cache le champ « commenter »).
  const [commentsOpen, setCommentsOpen] = useState(false);
  useEffect(() => {
    document.body.classList.toggle("nexus-hide-bottomnav", commentsOpen);
    return () => document.body.classList.remove("nexus-hide-bottomnav");
  }, [commentsOpen]);
  const containerRef = useRef(null);
  const observerRef  = useRef(null);
  const fileInputRef = useRef(null);
  const viewedRef    = useRef(new Set());
  const videosRef    = useRef({});   // registre des <video> par index (contrôle clavier)
  const skipRef      = useRef(0);
  const openedShareRef = useRef(false);
  const PAGE = 10;

  const navigate = useNavigate();
  const location = useLocation();
  const { clipId } = useParams();  // /nexus-clips/:clipId → clip partagé à ouvrir

  // Le parent enregistre chaque vidéo pour piloter la lecture au clavier.
  const registerVideo = useCallback((idx, el) => {
    if (el) videosRef.current[idx] = el; else delete videosRef.current[idx];
  }, []);

  // Défilement programmé vers un clip (clavier / navigation).
  const goTo = useCallback((idx) => {
    const clamped = Math.max(0, idx);
    const el = containerRef.current?.querySelector(`[data-index="${clamped}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    fetchClips(true);
  }, []);

  // Ouvre le clip partagé (/nexus-clips/:clipId) : place la vidéo en tête si elle
  // n'est pas déjà chargée, puis défile dessus. Ne s'exécute qu'une fois.
  useEffect(() => {
    if (!clipId || loading || openedShareRef.current) return;
    openedShareRef.current = true;
    const idx = clips.findIndex((c) => c.id === clipId);
    if (idx >= 0) { setTimeout(() => goTo(idx), 150); return; }
    axios.get(`${API}/posts/${clipId}`).then((res) => {
      const c = res.data;
      if (c && c.media_type === "video" && c.media_url) {
        setClips((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
        setActiveIndex(0);
      }
    }).catch(() => {});
  }, [clipId, loading, clips, goTo]);

  // Garde la barre d'adresse synchronisée avec le clip affiché (URL partageable).
  useEffect(() => {
    if (loading || view !== "immersive") return;
    const c = clips[activeIndex];
    if (c && location.pathname.startsWith("/nexus-clips")) {
      navigate(`/nexus-clips/${c.id}`, { replace: true });
    }
  }, [activeIndex, clips, loading, view]);

  // Raccourcis clavier : Espace = pause/play, Entrée/↓ = suivant, ↑ = précédent.
  useEffect(() => {
    // Barre d'espace : appui court = play/pause ; appui LONG = lecture 2x (relâché → 1x).
    let spaceTimer = null;
    let spaceSpeeding = false;
    const onKeyDown = (e) => {
      if (view !== "immersive") return;
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return; // ne pas gêner la saisie
      if (e.key === " ") {
        e.preventDefault();
        if (e.repeat) return; // ignore l'auto-répétition du clavier
        const v = videosRef.current[activeIndex];
        if (!v) return;
        spaceTimer = setTimeout(() => {
          v.playbackRate = 2; spaceSpeeding = true; spaceTimer = null;
        }, 350);
      } else if (e.key === "Enter" || e.key === "ArrowDown") {
        e.preventDefault(); goTo(activeIndex + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault(); goTo(activeIndex - 1);
      }
    };
    const onKeyUp = (e) => {
      if (e.key !== " ") return;
      const v = videosRef.current[activeIndex];
      if (spaceTimer) {
        // Relâché avant le seuil → c'était un appui court = play/pause.
        clearTimeout(spaceTimer); spaceTimer = null;
        if (v) { v.paused ? v.play().catch(() => {}) : v.pause(); }
      } else if (spaceSpeeding) {
        // Fin de l'appui long → retour à la vitesse normale.
        if (v) v.playbackRate = 1;
        spaceSpeeding = false;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (spaceTimer) clearTimeout(spaceTimer);
    };
  }, [activeIndex, view, goTo]);

  // Scroll infini : charge la page suivante en approchant de la fin.
  useEffect(() => {
    if (!loadingMore && hasMore && clips.length > 0 && activeIndex >= clips.length - 3) {
      loadMore();
    }
  }, [activeIndex, clips.length]);

  // Compte une vue quand un clip devient actif (une fois par clip et par visite)
  useEffect(() => {
    const clip = clips[activeIndex];
    if (!clip || viewedRef.current.has(clip.id)) return;
    viewedRef.current.add(clip.id);
    axios.post(`${API}/clips/${clip.id}/view`).catch(() => {});
  }, [activeIndex, clips]);

  useEffect(() => {
    if (view !== "immersive" || !containerRef.current || clips.length === 0) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = parseInt(entry.target.dataset.index, 10);
            setActiveIndex(idx);
          }
        });
      },
      { threshold: 0.6 }
    );
    const items = containerRef.current.querySelectorAll("[data-index]");
    items.forEach((el) => observerRef.current.observe(el));
    return () => observerRef.current?.disconnect();
  }, [clips, view]);

  const fetchClips = async (reset = false) => {
    const skip = reset ? 0 : skipRef.current;
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const res = await axios.get(`${API}/clips`, { params: { skip, limit: PAGE } });
      // Mots masqués : on retire les clips dont la légende correspond.
      const muteMatch = buildMutedMatcher(user?.muted_words || []);
      const videos = (res.data || []).filter((p) => p.media_type === "video" && p.media_url && !muteMatch(p.content));
      if (reset) {
        setClips(videos);
        skipRef.current = videos.length;
      } else {
        // Dédoublonne au cas où.
        setClips((prev) => {
          const ids = new Set(prev.map((c) => c.id));
          const merged = [...prev, ...videos.filter((v) => !ids.has(v.id))];
          skipRef.current = merged.length;
          return merged;
        });
      }
      setHasMore(videos.length >= PAGE);
    } catch (err) {
      console.error("Erreur clips:", err);
      if (reset) toast.error(t("clips.err_load"));
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  };

  const loadMore = () => { if (!loadingMore && hasMore) fetchClips(false); };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleDeleteClip = async (clipId) => {
    if (!window.confirm(t("clips.confirm_delete"))) return;
    try {
      await axios.delete(`${API}/posts/${clipId}`);
      setClips((prev) => {
        const next = prev.filter((c) => c.id !== clipId);
        setActiveIndex((idx) => Math.max(0, Math.min(idx, next.length - 1)));
        return next;
      });
      toast.success(t("clips.deleted"));
    } catch (err) {
      console.error("Erreur suppression clip:", err);
      toast.error(t("clips.err_delete"));
    }
  };

  // Étape 1 — choix du fichier : on VALIDE puis on ouvre l'écran de publication
  // (aperçu + légende + audience). On N'UPLOADE PAS ici (façon TikTok).
  const uploadClip = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de re-sélectionner le même fichier
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error(t("clips.err_choose_video"));
      return;
    }
    // Sans Firebase, on garde l'ancien chemin (base64 via le backend) qui
    // impose des vidéos courtes/légères. Avec Firebase, on autorise le long.
    const BACKEND_MAX_MB = 50;
    if (!isFirebaseConfigured && file.size > BACKEND_MAX_MB * 1024 * 1024) {
      toast.error(t("clips.file_too_large", { max: BACKEND_MAX_MB }));
      return;
    }
    setPendingClip({ file, previewUrl: URL.createObjectURL(file) });
  };

  // Ferme l'écran de publication et libère l'aperçu.
  const closePublish = () => {
    setPendingClip((p) => {
      if (p?.previewUrl) { try { URL.revokeObjectURL(p.previewUrl); } catch { /* ignore */ } }
      return null;
    });
  };

  // Étape 2 — publication : réutilise EXACTEMENT le pipeline existant (Firebase
  // resumable ou multipart backend), avec légende + audience + restriction UE.
  const publishClip = async (d) => {
    const file = pendingClip?.file;
    if (!file) return;
    const {
      caption = "", visibility = "public", euBlocked = false,
      location = "", link = "", cover = null,
      allowComments = true, allowRemix = false, mature = false,
      aiGenerated = false, isDraft = false,
    } = d || {};
    setUploading(true);
    setUploadProgress(0);
    try {
      if (isFirebaseConfigured) {
        // Upload direct navigateur → Firebase (reprise auto), puis on
        // n'envoie que l'URL au backend : longues vidéos autorisées.
        const url = await uploadVideoResumable(file, user?.id, setUploadProgress);
        let duration = null;
        try {
          duration = await new Promise((resolve, reject) => {
            const probe = document.createElement("video");
            const obj = URL.createObjectURL(file);
            probe.preload = "metadata";
            probe.onloadedmetadata = () => { URL.revokeObjectURL(obj); resolve(probe.duration || null); };
            probe.onerror = () => { URL.revokeObjectURL(obj); reject(new Error("probe")); };
            probe.src = obj;
          });
        } catch { /* durée facultative */ }
        await axios.post(`${API}/clips/external`, {
          media_url: url,
          caption,
          eu_blocked: euBlocked,
          visibility,
          location, link, cover_url: cover,
          allow_comments: allowComments, allow_remix: allowRemix,
          mature, ai_generated: aiGenerated, is_draft: isDraft,
          duration,
        });
      } else {
        const form = new FormData();
        form.append("file", file);
        form.append("caption", caption);
        form.append("eu_blocked", euBlocked ? "true" : "false");
        form.append("visibility", visibility);
        form.append("location", location);
        form.append("link", link);
        if (cover) form.append("cover_url", cover);
        form.append("allow_comments", allowComments ? "true" : "false");
        form.append("allow_remix", allowRemix ? "true" : "false");
        form.append("mature", mature ? "true" : "false");
        form.append("ai_generated", aiGenerated ? "true" : "false");
        form.append("is_draft", isDraft ? "true" : "false");
        await axios.post(`${API}/clips`, form, {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (evt) => {
            if (evt.total) setUploadProgress(Math.round((evt.loaded * 100) / evt.total));
          },
        });
      }
      toast.success(isDraft ? t("clips.draft_saved") : t("clips.published"));
      closePublish();
      setActiveIndex(0);
      skipRef.current = 0;
      await fetchClips(true);
    } catch (err) {
      console.error("Erreur upload clip:", err);
      toast.error(err.response?.data?.detail || t("clips.err_publish"));
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  // Bouton flottant d'upload (réutilisé dans l'état vide et l'état principal)
  // « + » = ouvre la caméra plein écran (composer). Appui LONG = import fichier.
  const openImport = () => fileInputRef.current?.click();
  const uploadControls = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={uploadClip}
        data-testid="clip-file-input"
      />
      <button
        onClick={() => setShowComposer(true)}
        onContextMenu={(e) => { e.preventDefault(); openImport(); }}
        disabled={uploading}
        data-testid="upload-clip"
        title={t("clips.create_clip")}
        className="fixed z-50 top-[calc(4rem_+_env(safe-area-inset-top))] right-4 lg:top-4 w-12 h-12 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all"
        style={{
          background: "linear-gradient(135deg,#22d3ee,#3b82f6)",
          color: C.onPrimary,
          opacity: uploading ? 0.6 : 1,
        }}
      >
        {uploading ? (
          <span className="text-[11px] font-black">{uploadProgress}%</span>
        ) : (
          <span className="material-symbols-outlined text-2xl">add</span>
        )}
      </button>
      {showComposer && (
        <StoryComposer
          target="clip"
          user={user}
          onClose={() => setShowComposer(false)}
          onPublished={() => { setShowComposer(false); fetchClips(true); }}
        />
      )}
      {pendingClip && (
        <ClipPublishScreen
          previewUrl={pendingClip.previewUrl}
          uploading={uploading}
          progress={uploadProgress}
          onClose={closePublish}
          onPublish={publishClip}
        />
      )}
    </>
  );

  // Bascule entre la vue immersive (défilement vertical) et la vue grille
  const viewToggle = (
    <button
      onClick={() => setView((v) => (v === "immersive" ? "grid" : "immersive"))}
      data-testid="toggle-clips-view"
      title={view === "immersive" ? "Vue grille" : "Vue immersive"}
      className="fixed z-50 top-[calc(1rem_+_env(safe-area-inset-top))] left-4 w-12 h-12 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all"
      style={{ background: "rgba(0,0,0,0.5)", color: "#fff", backdropFilter: "blur(8px)" }}
    >
      <span className="material-symbols-outlined text-2xl">
        {view === "immersive" ? "grid_view" : "smart_display"}
      </span>
    </button>
  );

  // Bouton de recherche Clips (en haut à droite) → page de recherche dédiée.
  const searchButton = (
    <button
      onClick={() => navigate("/nexus-clips/recherche")}
      data-testid="clips-search"
      title={t("clips.search_clips")}
      className="fixed z-50 top-[calc(1rem_+_env(safe-area-inset-top))] right-4 w-12 h-12 rounded-full flex items-center justify-center shadow-lg active:scale-95 transition-all"
      style={{ background: "rgba(0,0,0,0.5)", color: "#fff", backdropFilter: "blur(8px)" }}
    >
      <span className="material-symbols-outlined text-2xl">search</span>
    </button>
  );

  if (loading) {
    return (
      <Layout user={user} setUser={setUser} compact hideMobileHeader>
        <div className="flex items-center justify-center h-screen">
          <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: `${C.cyan}33`, borderTopColor: C.cyan }} />
        </div>
      </Layout>
    );
  }

  if (clips.length === 0) {
    return (
      <Layout user={user} setUser={setUser} compact hideMobileHeader>
        <div className="flex flex-col items-center justify-center h-screen gap-4">
          <span className="material-symbols-outlined text-6xl" style={{ color: C.outline, opacity: 0.4 }}>play_circle</span>
          <p className="text-sm font-bold uppercase tracking-widest" style={{ color: C.outline }}>{t("clips.no_clips")}</p>
          <p className="text-xs text-center max-w-xs" style={{ color: C.outline }}>
            Publiez une vidéo pour qu'elle apparaisse ici
          </p>
          <button
            onClick={() => setShowComposer(true)}
            disabled={uploading}
            data-testid="upload-clip-empty"
            className="mt-2 px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 active:scale-95 transition-all"
            style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary, opacity: uploading ? 0.6 : 1 }}
          >
            <span className="material-symbols-outlined text-lg">videocam</span>
            {uploading ? `Publication… ${uploadProgress}%` : "Publier un clip"}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={uploadClip}
          data-testid="clip-file-input"
        />
      </Layout>
    );
  }

  return (
    <Layout user={user} setUser={setUser} compact hideMobileHeader>
      {/* Tirer vers le bas (sur le 1er clip) pour rafraîchir le fil. */}
      <PullToRefresh
        onRefresh={() => fetchClips(true)}
        getScrollTop={() => containerRef.current?.scrollTop || 0}
        enabled={view === "immersive" && !commentsOpen}
      />
      {view === "immersive" ? (
        /* Full-screen vertical scroll snapping */
        <div
          ref={containerRef}
          className="h-[100dvh] overflow-y-scroll select-none"
          style={{
            // Commentaires ouverts → on fige le défilement/snap du fil de clips
            // pour que SEULE la liste de commentaires défile.
            scrollSnapType: commentsOpen ? "none" : "y mandatory",
            overflowY: commentsOpen ? "hidden" : "scroll",
            touchAction: commentsOpen ? "none" : undefined,
            scrollBehavior: "smooth",
            WebkitOverflowScrolling: "touch",
            marginTop: 0,
            scrollbarWidth: "none",
            WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none",
          }}
        >
          <style>{`
            [data-index] { scroll-snap-align: start; scroll-snap-stop: always; }
            @keyframes clipSheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
          `}</style>
          {clips.map((clip, idx) => (
            <div key={clip.id} data-index={idx} className="w-full" style={{ height: "100dvh" }}>
              <ClipCard post={clip} currentUser={user} isActive={idx === activeIndex && !showComposer}
                index={idx} registerVideo={registerVideo} onDelete={handleDeleteClip}
                onCommentsOpenChange={setCommentsOpen} />
            </div>
          ))}
          {loadingMore && (
            <div className="flex justify-center py-8"><div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: `${C.cyan}33`, borderTopColor: C.cyan }} /></div>
          )}
        </div>
      ) : (
        /* Grille des clips (style Reels) */
        <div className="h-screen overflow-y-auto px-2 pt-16 pb-24 lg:pt-6 select-none" style={{ background: "#000", WebkitUserSelect: "none", userSelect: "none" }}>
          <div className="grid grid-cols-3 gap-1.5 max-w-4xl mx-auto">
            {clips.map((clip, idx) => (
              <button
                key={clip.id}
                onClick={() => { setActiveIndex(idx); setView("immersive"); }}
                data-testid={`clip-grid-${clip.id}`}
                className="relative rounded-lg overflow-hidden active:scale-95 transition-transform"
                style={{ aspectRatio: "9 / 16", background: "#111" }}
              >
                <video
                  src={clip.media_url}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                  preload="metadata"
                />
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: "linear-gradient(to top, rgba(0,0,0,0.75), transparent 55%)" }}
                />
                {clip.content && (
                  <div className="absolute top-1.5 left-2 right-2 text-white text-[10px] line-clamp-1 opacity-80 text-left">
                    {clip.content}
                  </div>
                )}
                <div className="absolute bottom-1.5 left-2 right-2 flex items-center gap-2 text-white text-[11px]">
                  <span className="flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1", color: "#f87171" }}>favorite</span>
                    <span className="font-bold">{clip.likes_count || 0}</span>
                  </span>
                  <span className="flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-sm">play_arrow</span>
                    <span className="font-bold">{clip.views || 0}</span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bascule grille / immersif + recherche */}
      {viewToggle}
      {searchButton}

      {/* Nexus Clips branding overlay (top-left) */}
      <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none lg:top-4">
        <span
          className="text-white font-black text-sm tracking-widest uppercase"
          style={{ fontFamily: "Space Grotesk, sans-serif", textShadow: `0 0 20px ${C.cyan}` }}
        >
          NEXUS CLIPS
        </span>
      </div>

      {/* Bouton flottant : publier un clip */}
      {uploadControls}
    </Layout>
  );
}
