import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import PullToRefresh from "@/components/PullToRefresh";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { isFirebaseConfigured, uploadVideoResumable } from "@/lib/firebase";
import { SURFACE, TEXT, ACCENT } from "@/lib/theme";
import StoryComposer from "@/components/StoryComposer";
import { attachSilent, clearNowPlaying } from "@/lib/silentAudio";

// Le son d'un clip peut être routé par la Web Audio API pour ne PAS réclamer la
// session « Now Playing » iOS (indicateur son dans la barre d'état). On ne le
// fait que si l'URL autorise le CORS (Cloudinary / data / blob), sinon le
// crossOrigin casserait le chargement de la vidéo → on reste alors en natif.
const CLIP_CORS_SAFE = (url = "") =>
  url.startsWith("data:") || url.startsWith("blob:") ||
  /(^|\/\/)([^/]*\.)?cloudinary\.com\//.test(url) || url.includes("/video/upload/") ||
  // Proxy média Nexus (/api/media/...) : servi avec en-têtes CORS → routage
  // Web Audio possible (pas d'indicateur son dans la Dynamic Island).
  url.includes("/api/media/");

// Tokens dérivés de la source unique (@/lib/theme) : cohérence avec Messages /
// Stories / Profil.
const C = {
  surface:   SURFACE.base,
  high:      SURFACE.high,
  cyan:      ACCENT,
  onPrimary: TEXT.onAccent,
  outline:   TEXT.muted,
  onSurface: TEXT.primary,
};

const fmtNum = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + "k" : n);
const fmtRel = (d) => { try { return formatDistanceToNow(new Date(d), { addSuffix: true, locale: fr }); } catch { return ""; } };

// Un commentaire de clip : like, réponses, et suppression par son auteur.
function CommentItem({ comment, currentUser, onDeleted }) {
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
    } catch { toast.error("Erreur"); }
  };

  const deleteReply = async (rid) => {
    try {
      await axios.delete(`${API}/comments/${comment.id}/replies/${rid}`);
      setReplies((prev) => prev.filter((x) => x.id !== rid));
      setRepCount((n) => Math.max(0, n - 1));
    } catch { toast.error("Erreur"); }
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
          <span className="font-bold">@{comment.author_username}</span>{" "}
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
              Supprimer
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
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Like du commentaire */}
      <button onClick={toggleLike} className="flex flex-col items-center gap-0.5 flex-shrink-0">
        <span className="material-symbols-outlined text-base" style={{ color: liked ? "#f87171" : C.outline, fontVariationSettings: liked ? "'FILL' 1" : "'FILL' 0" }}>
          favorite
        </span>
        {likes > 0 && <span className="text-[10px]" style={{ color: C.outline }}>{fmtNum(likes)}</span>}
      </button>
    </div>
  );
}

function ClipCard({ post, currentUser, isActive, index, registerVideo, onDelete }) {
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
      tapTimer.current = setTimeout(() => { tapTimer.current = null; togglePlay(); }, 260);
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
    // URL partageable du clip : /nexus-clips/:clipId ouvre directement la vidéo.
    const url = `${window.location.origin}/nexus-clips/${post.id}`;
    try {
      if (navigator.share) await navigator.share({ title: "Nexus Clips", url });
      else { await navigator.clipboard.writeText(url); toast.success("Lien copié"); }
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
      toast.error("Erreur lors de l'enregistrement");
    }
  };

  const handleLike = async (e) => {
    e.stopPropagation();
    try {
      const res = await axios.post(`${API}/posts/${post.id}/like`);
      setIsLiked(res.data.liked);
      setLikes(p => res.data.liked ? p + 1 : p - 1);
    } catch { toast.error("Erreur"); }
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
    } catch { toast.error("Erreur"); }
  };

  const handleDeleteComment = async (commentId) => {
    try {
      await axios.delete(`${API}/posts/${post.id}/comments/${commentId}`);
      setCommentsList((prev) => prev.filter((c) => c.id !== commentId));
      setComments((p) => Math.max(0, p - 1));
    } catch { toast.error("Erreur"); }
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
        // Jamais de crop du contenu large : vidéos paysage/16:9 en `contain`
        // (letterbox, entièrement visibles) ; vidéos verticales en `cover` (plein
        // cadre, façon TikTok). Sur PC le conteneur est déjà en colonne 9:16.
        className={`w-full h-full ${isLandscape ? "object-contain" : "object-cover"}`}
        loop
        muted={muted}
        playsInline
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

      {/* Barre de progression MANIPULABLE + durée visible (au-dessus de la barre
          de navigation). Glisser pour avancer/reculer ; touch-none évite que le
          geste déclenche le défilement vertical des clips. Masquée en plein écran
          (l'overlay 16:9 a sa propre barre). */}
      {!isFs && (
        <div className="absolute left-0 right-0 px-4 z-20" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 4.25rem)" }}>
          <div className="flex items-center gap-2.5">
            <div
              ref={barRef}
              onPointerDown={onScrubDown}
              onPointerMove={onScrubMove}
              onPointerUp={onScrubUp}
              onPointerCancel={onScrubUp}
              onClick={(e) => e.stopPropagation()}
              className="relative flex-1 h-6 flex items-center cursor-pointer touch-none"
            >
              <div className="w-full rounded-full" style={{ height: scrubbing ? 6 : 4, background: "rgba(255,255,255,0.28)", transition: "height 0.1s" }}>
                <div className="h-full rounded-full" style={{ width: `${progress}%`, background: C.cyan }} />
              </div>
              <div
                className="absolute rounded-full bg-white shadow"
                style={{ left: `${progress}%`, top: "50%", transform: "translate(-50%,-50%)", width: scrubbing ? 14 : 10, height: scrubbing ? 14 : 10, transition: "width 0.1s, height 0.1s" }}
              />
            </div>
            <span className="text-white text-[11px] font-semibold tabular-nums flex-shrink-0" style={{ textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>
              {fmtTime(currentTime)} / {fmtTime(duration)}
            </span>
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
            <button onClick={toggleFullscreen} className="flex items-center justify-center w-9 h-9 rounded-full" style={{ background: "rgba(255,255,255,0.15)" }} title="Quitter le plein écran">
              <span className="material-symbols-outlined text-white text-xl">fullscreen_exit</span>
            </button>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.25)" }}>
            <div className="h-full" style={{ width: `${progress}%`, background: C.cyan }} />
          </div>
        </div>
      )}

      {/* Right action bar */}
      <div className="absolute right-3 bottom-28 flex flex-col gap-4 items-center">
        {/* Avatar */}
        <button onClick={() => navigate(`/profile/${post.author_id}`)} className="relative">
          {post.author_profile_pic ? (
            <img src={post.author_profile_pic} alt="" className="w-12 h-12 rounded-full object-cover border-2" style={{ borderColor: C.cyan }} />
          ) : (
            <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg" style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
              {post.author_username?.[0]?.toUpperCase()}
            </div>
          )}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full flex items-center justify-center text-white" style={{ background: C.cyan }}>
            <span className="material-symbols-outlined text-xs" style={{ fontVariationSettings: "'FILL' 1" }}>add</span>
          </div>
        </button>

        {/* Like */}
        <button onClick={handleLike} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
            <span className="material-symbols-outlined text-2xl" style={{ color: isLiked ? "#f87171" : "#fff", fontVariationSettings: isLiked ? "'FILL' 1" : "'FILL' 0" }}>
              favorite
            </span>
          </div>
          <span className="text-white text-xs font-bold">{fmt(likes)}</span>
        </button>

        {/* Comment */}
        <button onClick={(e) => { e.stopPropagation(); openComments(); }} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
            <span className="material-symbols-outlined text-2xl text-white">chat_bubble</span>
          </div>
          <span className="text-white text-xs font-bold">{fmt(comments)}</span>
        </button>

        {/* Save (enregistrer) */}
        <button onClick={toggleSave} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
            <span className="material-symbols-outlined text-2xl" style={{ color: saved ? C.cyan : "#fff", fontVariationSettings: saved ? "'FILL' 1" : "'FILL' 0" }}>bookmark</span>
          </div>
          <span className="text-white text-xs font-bold">Enreg.</span>
        </button>

        {/* Share (partager) */}
        <button onClick={handleShare} className="flex flex-col items-center gap-1">
          <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
            <span className="material-symbols-outlined text-2xl text-white">share</span>
          </div>
          <span className="text-white text-xs font-bold">Partager</span>
        </button>

        {/* Plein écran — uniquement pour les vidéos publiées en 16:9 (paysage) */}
        {isLandscape && (
          <button onClick={toggleFullscreen} className="flex flex-col items-center gap-1" data-testid="clip-fullscreen">
            <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
              <span className="material-symbols-outlined text-2xl text-white">{isFs ? "fullscreen_exit" : "fullscreen"}</span>
            </div>
            <span className="text-white text-xs font-bold">Plein écran</span>
          </button>
        )}

        {/* Mute */}
        {post.media_type === "video" && (
          <button onClick={(e) => { e.stopPropagation(); setMuted(p => !p); }} className="flex flex-col items-center gap-1">
            <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
              <span className="material-symbols-outlined text-2xl text-white">{muted ? "volume_off" : "volume_up"}</span>
            </div>
          </button>
        )}

        {/* Supprimer (auteur uniquement) */}
        {currentUser?.id === post.author_id && (
          <button
            onClick={(e) => { e.stopPropagation(); onDelete?.(post.id); }}
            data-testid="delete-clip"
            title="Supprimer ce clip"
            className="flex flex-col items-center gap-1"
          >
            <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
              <span className="material-symbols-outlined text-2xl" style={{ color: "#f87171" }}>delete</span>
            </div>
          </button>
        )}
      </div>

      {/* Bottom info (relevé pour laisser la place à la barre de progression) */}
      <div className="absolute left-4 right-20" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 6.5rem)" }}>
        <button onClick={() => navigate(`/profile/${post.author_id}`)} className="font-bold text-white text-sm mb-1 hover:text-cyan-300 transition-colors inline-flex items-center gap-1">
          @{post.author_username}
          {post.author_is_premium && (
            <span className="material-symbols-outlined text-sm" style={{ color: C.cyan, fontVariationSettings: "'FILL' 1" }} title="Membre Nexus Premium">workspace_premium</span>
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
          className="absolute bottom-0 left-0 right-0 rounded-t-3xl p-4"
          style={{ background: "rgba(11,19,38,0.95)", backdropFilter: "blur(20px)", borderTop: "1px solid rgba(255,255,255,0.08)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: C.outline }} />
          <h3 className="text-white font-bold text-sm mb-3">{comments} commentaire{comments !== 1 ? "s" : ""}</h3>

          {/* Liste des commentaires */}
          <div className="max-h-[40vh] overflow-y-auto space-y-3 mb-3" style={{ scrollbarWidth: "none" }}>
            {loadingComments ? (
              <p className="text-xs text-center py-4" style={{ color: C.outline }}>Chargement…</p>
            ) : commentsList.length === 0 ? (
              <p className="text-xs text-center py-4" style={{ color: C.outline }}>Aucun commentaire. Soyez le premier !</p>
            ) : (
              commentsList.map((c) => (
                <CommentItem
                  key={c.id}
                  comment={c}
                  currentUser={currentUser}
                  onDeleted={handleDeleteComment}
                />
              ))
            )}
          </div>

          <div className="flex gap-3 items-center">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Ajouter un commentaire…"
              className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-slate-500 py-2 px-3 rounded-xl"
              style={{ backgroundColor: C.high, color: C.onSurface, border: "1px solid rgba(255,255,255,0.08)" }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSendComment(); }}
            />
            <button onClick={handleSendComment} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
              <span className="material-symbols-outlined text-sm">send</span>
            </button>
          </div>
        </div>
      )}
      </div>{/* /stage */}
    </div>
  );
}

export default function ClipsPage({ user, setUser }) {
  const [clips, setClips]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showComposer, setShowComposer] = useState(false); // caméra plein écran (création clip)
  const [view, setView] = useState("immersive"); // "immersive" | "grid"
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
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
      const videos = (res.data || []).filter((p) => p.media_type === "video" && p.media_url);
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
      if (reset) toast.error("Erreur lors du chargement des clips");
    } finally {
      setLoading(false); setLoadingMore(false);
    }
  };

  const loadMore = () => { if (!loadingMore && hasMore) fetchClips(false); };

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleDeleteClip = async (clipId) => {
    if (!window.confirm("Supprimer définitivement ce clip ?")) return;
    try {
      await axios.delete(`${API}/posts/${clipId}`);
      setClips((prev) => {
        const next = prev.filter((c) => c.id !== clipId);
        setActiveIndex((idx) => Math.max(0, Math.min(idx, next.length - 1)));
        return next;
      });
      toast.success("Clip supprimé");
    } catch (err) {
      console.error("Erreur suppression clip:", err);
      toast.error("Erreur lors de la suppression");
    }
  };

  const uploadClip = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de re-sélectionner le même fichier
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Veuillez choisir un fichier vidéo");
      return;
    }
    // Sans Firebase, on garde l'ancien chemin (base64 via le backend) qui
    // impose des vidéos courtes/légères. Avec Firebase, on autorise le long.
    const BACKEND_MAX_MB = 50;
    if (!isFirebaseConfigured && file.size > BACKEND_MAX_MB * 1024 * 1024) {
      toast.error(`Vidéo trop lourde (max ${BACKEND_MAX_MB} Mo)`);
      return;
    }

    const caption = window.prompt("Légende de votre clip (optionnel)") || "";
    const euBlocked = window.confirm(
      "Restreindre ce clip dans l'Union européenne ?\n\nOK = masqué aux visiteurs de l'UE • Annuler = visible partout"
    );
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
          duration,
        });
      } else {
        const form = new FormData();
        form.append("file", file);
        form.append("caption", caption);
        form.append("eu_blocked", euBlocked ? "true" : "false");
        await axios.post(`${API}/clips`, form, {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (evt) => {
            if (evt.total) setUploadProgress(Math.round((evt.loaded * 100) / evt.total));
          },
        });
      }
      toast.success("Clip publié !");
      setActiveIndex(0);
      skipRef.current = 0;
      await fetchClips(true);
    } catch (err) {
      console.error("Erreur upload clip:", err);
      toast.error(err.response?.data?.detail || "Erreur lors de la publication du clip");
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
        title="Créer un clip (caméra) — appui long : importer"
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
      title="Rechercher des clips"
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
          <p className="text-sm font-bold uppercase tracking-widest" style={{ color: C.outline }}>Aucun clip disponible</p>
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
        enabled={view === "immersive"}
      />
      {view === "immersive" ? (
        /* Full-screen vertical scroll snapping */
        <div
          ref={containerRef}
          className="h-[100dvh] overflow-y-scroll select-none"
          style={{
            scrollSnapType: "y mandatory",
            scrollBehavior: "smooth",
            WebkitOverflowScrolling: "touch",
            marginTop: 0,
            scrollbarWidth: "none",
            WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none",
          }}
        >
          <style>{`
            [data-index] { scroll-snap-align: start; scroll-snap-stop: always; }
          `}</style>
          {clips.map((clip, idx) => (
            <div key={clip.id} data-index={idx} className="w-full" style={{ height: "100dvh" }}>
              <ClipCard post={clip} currentUser={user} isActive={idx === activeIndex && !showComposer}
                index={idx} registerVideo={registerVideo} onDelete={handleDeleteClip} />
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
