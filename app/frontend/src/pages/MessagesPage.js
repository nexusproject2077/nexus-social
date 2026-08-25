import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { toast } from "sonner";
import { Check, CheckCheck } from "lucide-react";
import { compressImage, dataUrlBytes } from "@/lib/compressImage";
import { linkify, extractFirstUrl } from "@/lib/linkify";
import LinkPreview from "@/components/LinkPreview";
import InstantsEntry from "@/components/instants/InstantsEntry";
import NexusAIChat from "@/components/NexusAIChat";
import { SURFACE, TEXT, OUTLINE, ACCENT, glass as sharedGlass } from "@/lib/theme";
import { attachSilent, clearNowPlaying } from "@/lib/silentAudio";
import DrawCanvasModal from "@/components/DrawCanvasModal";
import ScheduleMessageModal from "@/components/ScheduleMessageModal";

// Un message vocal ne doit pas non plus réclamer la session « Now Playing »
// iOS : on route son son par Web Audio quand l'URL est CORS-safe (Cloudinary /
// data / blob), sinon crossOrigin casserait le chargement → on reste en natif.
const VOICE_CORS_SAFE = (url = "") =>
  url.startsWith("data:") || url.startsWith("blob:") ||
  /(^|\/\/)([^/]*\.)?cloudinary\.com\//.test(url) || url.includes("/upload/");

// Tokens de la page dérivés de la source unique (@/lib/theme) : mêmes valeurs
// que Clips / Stories / Profil pour une identité visuelle cohérente.
const C = {
  bg:         SURFACE.deep,
  surface:    SURFACE.base,
  low:        SURFACE.low,
  container:  SURFACE.container,
  high:       SURFACE.high,
  bright:     SURFACE.bright,
  cyan:       ACCENT,
  onPrimary:  TEXT.onAccent,
  outline:    TEXT.muted,
  outlineVar: OUTLINE,
  onSurface:  TEXT.primary,
  onVariant:  TEXT.variant,
};

const glass = sharedGlass;

function UserAvatar({ username, pic, size = 10 }) {
  const s = `${size * 4}px`;
  return pic ? (
    <img src={pic} alt={username} className="rounded-full object-cover flex-shrink-0" style={{ width: s, height: s }} />
  ) : (
    <div className="rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
      style={{ width: s, height: s, background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
      {username?.[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

const QUICK_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

// Durées des messages éphémères (doivent correspondre au backend).
const EPHEMERAL_OPTIONS = [
  { ttl: 0,     label: "Désactivé" },
  { ttl: 300,   label: "5 minutes" },
  { ttl: 3600,  label: "1 heure" },
  { ttl: 86400, label: "24 heures" },
];
const ephemeralLabel = (ttl) => (EPHEMERAL_OPTIONS.find((o) => o.ttl === Number(ttl)) || EPHEMERAL_OPTIONS[0]).label;

// Signatures base64 des formats image courants (début du blob encodé).
const B64_IMAGE_SIGNATURES = [
  { p: "/9j/", mime: "jpeg" },        // JPEG
  { p: "iVBORw0KGgo", mime: "png" },  // PNG
  { p: "R0lGOD", mime: "gif" },       // GIF
  { p: "UklGR", mime: "webp" },       // WebP (RIFF)
];

// Nettoie une data URL : retire espaces / retours à la ligne dans la partie
// base64. Ces caractères invisibles (souvent issus d'un copier-coller) rendent
// l'URL invalide → l'image ne s'affiche pas (net::ERR_INVALID_URL).
const cleanImageSrc = (src) => {
  if (typeof src !== "string" || !src) return src;
  if (!src.startsWith("data:")) return src;
  const comma = src.indexOf(",");
  if (comma === -1) return src;
  return src.slice(0, comma + 1) + src.slice(comma + 1).replace(/\s/g, "");
};

// Renvoie une source d'image affichable si le contenu EST une image
// (data URL complète, ou base64 brut collé sans préfixe), sinon null.
const imageSrcFromContent = (s) => {
  if (typeof s !== "string") return null;
  if (s.startsWith("data:image")) return cleanImageSrc(s);
  const head = s.slice(0, 16);
  for (const { p, mime } of B64_IMAGE_SIGNATURES) {
    if (head.startsWith(p)) return `data:image/${mime};base64,${s.replace(/\s/g, "")}`;
  }
  return null;
};

// True si le contenu est en réalité une image (à ne pas afficher comme texte).
const isDataImage = (s) => imageSrcFromContent(s) !== null;

// Étiquette de date pour un séparateur (Aujourd'hui / Hier / date longue).
const isSameDay = (a, b) => {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
};
const formatDayLabel = (d) => {
  if (!d) return "";
  const date = new Date(d);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, today)) return "Aujourd'hui";
  if (isSameDay(date, yesterday)) return "Hier";
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
};

// Image de message avec repli propre si la source est corrompue/illisible.
function MsgImage({ src, onOpen, onLoaded }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="rounded-xl mb-1 flex items-center gap-2 px-3 py-2 text-xs"
        style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}>
        <span className="material-symbols-outlined text-sm">broken_image</span>
        Image indisponible
      </div>
    );
  }
  return (
    <img
      src={src}
      alt="image"
      className="rounded-xl max-w-full mb-1 cursor-zoom-in block"
      style={{ maxHeight: 280 }}
      onClick={() => onOpen(src)}
      onLoad={() => onLoaded?.()}
      onError={() => setFailed(true)}
    />
  );
}

// Vidéo de message : lecteur natif compact, repli propre si source illisible.
function MsgVideo({ src, onLoaded }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="rounded-xl mb-1 flex items-center gap-2 px-3 py-2 text-xs"
        style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}>
        <span className="material-symbols-outlined text-sm">videocam_off</span>
        Vidéo indisponible
      </div>
    );
  }
  return (
    <video
      src={src}
      className="rounded-xl max-w-full mb-1 block"
      style={{ maxHeight: 320 }}
      controls
      playsInline
      preload="metadata"
      onLoadedData={() => onLoaded?.()}
      onError={() => setFailed(true)}
    />
  );
}

// True si le message est un vocal (media_type audio, ou data URL audio).
// Scanne aussi `media_urls` (groupes), où le vocal arrive dans le tableau.
const audioSrcFrom = (msg) => {
  if (!msg) return null;
  if (msg.media_type === "audio" && msg.media_url) return msg.media_url;
  if (typeof msg.media_url === "string" && msg.media_url.startsWith("data:audio")) return msg.media_url;
  if (Array.isArray(msg.media_urls)) {
    const a = msg.media_urls.find((u) => typeof u === "string" && u.startsWith("data:audio"));
    if (a) return a;
  }
  return null;
};

// True si la source est une vidéo en data URL.
const isVideoDataUrl = (s) => typeof s === "string" && s.startsWith("data:video");

// Renvoie la source vidéo d'un message (DM via media_url/media_type, ou groupe
// via media_urls), sinon null.
const videoSrcFrom = (msg) => {
  if (!msg) return null;
  if (msg.media_type === "video" && msg.media_url) return msg.media_url;
  if (isVideoDataUrl(msg.media_url)) return msg.media_url;
  if (Array.isArray(msg.media_urls)) {
    const v = msg.media_urls.find(isVideoDataUrl);
    if (v) return v;
  }
  return null;
};

// Lecteur de message vocal (contrôles natifs, compact).
// Lecteur vocal optimisé (façon Insta/WhatsApp) : play/pause, forme d'onde
// cliquable pour se déplacer, durée fiable (contourne le bug duration=Infinity
// des enregistrements MediaRecorder), pas de <audio controls> natif moche.
function VoiceMessage({ src, own }) {
  const audioRef = useRef(null);
  const corsSafe = VOICE_CORS_SAFE(src);
  const [playing, setPlaying] = useState(false);

  // Route le son par Web Audio (si CORS-safe) → pas d'indicateur son iOS.
  useEffect(() => {
    if (!corsSafe) return;
    return attachSilent(audioRef.current);
  }, [src, corsSafe]);
  const [dur, setDur] = useState(0);
  const [cur, setCur] = useState(0);
  const accent = own ? "#93c5fd" : "#22d3ee";

  const fmt = (s) => (isFinite(s) && s >= 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : "0:00");

  const onMeta = (e) => {
    const a = e.target;
    if (a.duration === Infinity || Number.isNaN(a.duration)) {
      // Hack connu : forcer le calcul de la durée réelle des blobs MediaRecorder.
      a.currentTime = 1e101;
      a.ontimeupdate = () => { a.ontimeupdate = null; setDur(a.duration); a.currentTime = 0; };
    } else setDur(a.duration || 0);
  };

  const toggle = () => {
    const a = audioRef.current; if (!a) return;
    if (playing) a.pause(); else a.play().catch(() => {});
  };

  // Barre de progression cliquable (seek).
  const seek = (e) => {
    const a = audioRef.current; if (!a || !dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    a.currentTime = ratio * dur;
  };

  const pct = dur ? (cur / dur) * 100 : 0;
  // Forme d'onde décorative déterministe (barres pseudo-aléatoires stables).
  const bars = Array.from({ length: 28 }, (_, i) => 30 + Math.abs(Math.sin(i * 1.3)) * 70);

  return (
    <div className="flex items-center gap-2.5 mb-1 py-1" style={{ minWidth: 210 }}>
      <audio ref={audioRef} src={src} preload="metadata"
        crossOrigin={corsSafe ? "anonymous" : undefined}
        disableRemotePlayback
        onLoadedMetadata={onMeta}
        onTimeUpdate={(e) => setCur(e.target.currentTime || 0)}
        onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); clearNowPlaying(); }}
        onEnded={() => { setPlaying(false); setCur(0); clearNowPlaying(); }} />
      <button type="button" onClick={toggle}
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-transform active:scale-90"
        style={{ background: accent, color: "#00363e" }}>
        <span className="material-symbols-outlined text-lg">{playing ? "pause" : "play_arrow"}</span>
      </button>
      <div className="flex-1 min-w-[120px]">
        <div className="relative flex items-center gap-[2px] h-6 cursor-pointer" onClick={seek}>
          {bars.map((h, i) => {
            const active = (i / bars.length) * 100 <= pct;
            return <span key={i} className="flex-1 rounded-full" style={{ height: `${h}%`, background: active ? accent : "rgba(255,255,255,0.22)" }} />;
          })}
        </div>
        <div className="text-[10px] mt-0.5 tabular-nums" style={{ color: own ? "#cbd5e1" : "#94a3b8" }}>
          {fmt(playing || cur > 0 ? cur : dur)}
        </div>
      </div>
    </div>
  );
}

// Pictogrammes maison (style Nexus : trait fin, hérite de la couleur courante).
function Ico({ name, size = 20 }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "info":     return (<svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></svg>);
    case "mute":     return (<svg {...p}><path d="M6 8a6 6 0 0 1 9.4-5" /><path d="M18 8v5l2 3H4l2-3V8" /><path d="M10 20a2 2 0 0 0 4 0" /><path d="M3 3l18 18" /></svg>);
    case "unmute":   return (<svg {...p}><path d="M18 8A6 6 0 0 0 6 8v5l-2 3h16l-2-3z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>);
    case "nickname": return (<svg {...p}><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10z" /><circle cx="7.5" cy="7.5" r="1.1" /></svg>);
    case "privacy":  return (<svg {...p}><path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z" /><path d="M9.4 12l1.8 1.8 3.4-3.7" /></svg>);
    case "group":    return (<svg {...p}><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.2a3 3 0 0 1 0 5.6" /><path d="M18.5 20a5.5 5.5 0 0 0-3-5" /></svg>);
    case "block":    return (<svg {...p}><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>);
    case "report":   return (<svg {...p}><path d="M5 21V4" /><path d="M5 5h11l-1.6 3.2L16 11.5H5" /></svg>);
    case "trash":    return (<svg {...p}><path d="M4 7h16" /><path d="M9 7V5h6v2" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></svg>);
    case "members":  return (<svg {...p}><circle cx="12" cy="8" r="3.2" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>);
    case "leave":    return (<svg {...p}><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M11 12H3" /><path d="M6 8l-3 4 3 4" /></svg>);
    case "edit":     return (<svg {...p}><path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M13.5 6.5l3 3" /></svg>);
    case "profile":  return (<svg {...p}><circle cx="12" cy="8.5" r="3.4" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>);
    case "search":   return (<svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>);
    case "options":  return (<svg {...p}><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></svg>);
    case "palette":  return (<svg {...p}><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 2-2 0-1.6 1.2-2 2.5-2H18a3 3 0 0 0 3-3c0-5-4-9-9-9z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7.5" r="1" /><circle cx="14.5" cy="7.5" r="1" /></svg>);
    case "timer":    return (<svg {...p}><circle cx="12" cy="13" r="8" strokeDasharray="3 2.4" /><path d="M12 13V9" /><path d="M9 3h6" /></svg>);
    default:         return null;
  }
}

export default function MessagesPage({ user }) {
  const { t } = useTranslation();
  const params = useParams();
  const navigate = useNavigate();

  const selectedUserId  = params.userId;
  const selectedGroupId = params.groupId;
  const isGroup = Boolean(selectedGroupId);

  // Hydratation instantanée depuis le cache local (UI immédiate, façon Insta/X) :
  // on affiche la dernière liste connue puis on la rafraîchit en arrière-plan.
  const [conversations,   setConversations]   = useState(() => {
    try { return JSON.parse(localStorage.getItem("nexus_convs_cache") || "[]"); } catch { return []; }
  });
  const [groups,          setGroups]           = useState(() => {
    try { return JSON.parse(localStorage.getItem("nexus_groups_cache") || "[]"); } catch { return []; }
  });
  const [messages,        setMessages]         = useState([]);
  const [showAI,          setShowAI]           = useState(false);  // overlay Nexus AI
  const [messageContent,  setMessageContent]   = useState("");
  const [selectedUser,    setSelectedUser]     = useState(null);
  const [selectedGroup,   setSelectedGroup]    = useState(null);
  const [replyingTo,      setReplyingTo]       = useState(null);
  const [hoveredMessage,  setHoveredMessage]   = useState(null);
  const [showEmojiPicker, setShowEmojiPicker]  = useState(null);
  const [loading,         setLoading]          = useState(false);
  const [lightbox,        setLightbox]         = useState(null); // src de l'image agrandie
  const [showConvSearch,  setShowConvSearch]   = useState(false); // barre de recherche dans la conv
  const [convSearch,      setConvSearch]       = useState("");

  // Notes éphémères (façon Instagram) affichées en haut de la liste des DMs.
  const [notes,           setNotes]            = useState([]);
  const [showNoteComposer, setShowNoteComposer] = useState(false);
  const [noteText,        setNoteText]         = useState("");
  const NOTE_MAX = 80;

  // Search / new message
  const [searchQuery,      setSearchQuery]      = useState("");
  const [searchResults,    setSearchResults]    = useState([]);
  const [showNewMsg,       setShowNewMsg]       = useState(false);
  const newMsgSearchRef = useRef(null);

  // Ouvre la recherche « nouveau message » et met le focus sur le champ.
  const openNewMessage = () => {
    setShowNewMsg(true);
    setTimeout(() => newMsgSearchRef.current?.focus(), 50);
  };

  // New group modal
  const [showNewGroup,     setShowNewGroup]     = useState(false);
  const [groupName,        setGroupName]        = useState("");
  const [selectedMembers,  setSelectedMembers]  = useState([]);
  const [groupSearch,      setGroupSearch]      = useState("");
  const [groupSearchRes,   setGroupSearchRes]   = useState([]);

  // « Nouveau message » (modal unique façon Insta : recherche + multi-sélection)
  const [showNewMessageModal, setShowNewMessageModal] = useState(false);
  const [nmSearch,   setNmSearch]   = useState("");
  const [nmResults,  setNmResults]  = useState([]);
  const [nmSelected, setNmSelected] = useState([]);

  // Panneau « Détails » de la conversation (sidebar PC / bottom sheet mobile)
  const [showDetails, setShowDetails] = useState(false);
  const [detailsMore, setDetailsMore] = useState(false); // options avancées (⋯)

  // Messages éphémères (par conversation)
  const [ephemeralTtl, setEphemeralTtl] = useState(0);
  const [showEphemeralChooser, setShowEphemeralChooser] = useState(false);

  // Administration de groupe
  const [groupMembers,   setGroupMembers]   = useState([]);
  const [groupIsAdmin,   setGroupIsAdmin]   = useState(false);
  const [groupCreatorId, setGroupCreatorId] = useState(null);
  const [editingName,    setEditingName]    = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [showAddMember,  setShowAddMember]  = useState(false);
  const [addMemberSearch,  setAddMemberSearch]  = useState("");
  const [addMemberResults, setAddMemberResults] = useState([]);

  // Mise en sourdine (local, par appareil)
  const [mutedIds, setMutedIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem("nexus_muted") || "[]"); } catch { return []; }
  });
  const isMuted = (id) => mutedIds.includes(id);
  const toggleMute = (id) => {
    setMutedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { localStorage.setItem("nexus_muted", JSON.stringify(next)); } catch {}
      toast.success(prev.includes(id) ? "Réactivé" : "Mis en sourdine");
      return next;
    });
  };

  const messagesEndRef = useRef(null);
  const messagesScrollRef = useRef(null);

  // Colle la conversation en bas (dernier message). `force` = toujours ; sinon
  // seulement si on est déjà proche du bas (ne pas remonter l'utilisateur qui lit).
  const scrollToBottom = (force = false) => {
    const c = messagesScrollRef.current;
    if (!c) return;
    const nearBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 220;
    if (force || nearBottom) {
      // 1) Réglage direct (rapide). 2) Ancre de fin via scrollIntoView : plus
      // fiable quand la hauteur n'est pas encore stabilisée (images, viewport
      // dynamique iOS/Android) — scrollTop=scrollHeight peut être calculé trop
      // tôt et rester en haut ; l'ancre, elle, cible l'élément réel du bas.
      c.scrollTop = c.scrollHeight;
      messagesEndRef.current?.scrollIntoView({ block: "end", inline: "nearest" });
    }
  };
  const longPressTimer = useRef(null);

  // ── Pull-to-refresh (tirer vers le bas pour recharger, comme sur mobile) ──────
  const [pullDist, setPullDist] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullStartY = useRef(null);
  const PULL_THRESHOLD = 64;

  // Recharge la conversation courante (même effet que le bouton de recharge).
  const refreshCurrent = async () => {
    setRefreshing(true);
    try {
      if (selectedUserId) { await fetchMessages(selectedUserId); await markAsRead(selectedUserId); }
      else if (selectedGroupId) { await fetchGroupMessages(selectedGroupId); }
      await fetchConversations();
    } finally {
      setTimeout(() => setRefreshing(false), 300);
    }
  };

  const onPullStart = (e) => {
    const c = messagesScrollRef.current;
    // On ne démarre le geste que si la liste est déjà tout en haut.
    pullStartY.current = c && c.scrollTop <= 0 ? e.touches[0].clientY : null;
  };
  const onPullMove = (e) => {
    if (pullStartY.current == null || refreshing) return;
    const c = messagesScrollRef.current;
    if (!c || c.scrollTop > 0) { pullStartY.current = null; setPullDist(0); return; }
    const d = e.touches[0].clientY - pullStartY.current;
    // Résistance : on divise pour un ressenti « élastique ».
    if (d > 0) setPullDist(Math.min(90, d * 0.5));
  };
  const onPullEnd = () => {
    if (pullDist >= PULL_THRESHOLD) refreshCurrent();
    pullStartY.current = null;
    setPullDist(0);
  };

  // ── Pull-to-refresh de la LISTE des conversations (page d'accueil messages) ───
  const convScrollRef = useRef(null);
  const [convPull, setConvPull] = useState(0);
  const [convRefreshing, setConvRefreshing] = useState(false);
  const convPullStartY = useRef(null);

  // Recharge la page d'accueil des messages (même effet que le bouton recharger).
  const refreshHome = async () => {
    setConvRefreshing(true);
    try {
      await Promise.all([fetchConversations(), fetchGroups(), fetchNotes()]);
      window.dispatchEvent(new Event("nexus:badges"));
    } finally {
      setTimeout(() => setConvRefreshing(false), 300);
    }
  };

  const onConvPullStart = (e) => {
    const c = convScrollRef.current;
    convPullStartY.current = c && c.scrollTop <= 0 ? e.touches[0].clientY : null;
  };
  const onConvPullMove = (e) => {
    if (convPullStartY.current == null || convRefreshing) return;
    const c = convScrollRef.current;
    if (!c || c.scrollTop > 0) { convPullStartY.current = null; setConvPull(0); return; }
    const d = e.touches[0].clientY - convPullStartY.current;
    if (d > 0) setConvPull(Math.min(90, d * 0.5));
  };
  const onConvPullEnd = () => {
    if (convPull >= PULL_THRESHOLD) refreshHome();
    convPullStartY.current = null;
    setConvPull(0);
  };

  // Image en attente d'envoi (data URL compressée) + sélecteur de fichier.
  const [pendingImage, setPendingImage] = useState(null);
  const [showDraw, setShowDraw] = useState(false);      // canevas de dessin (DM)
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [scheduledMsgs, setScheduledMsgs] = useState([]);   // messages planifiés pour ce DM
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [manageSched, setManageSched] = useState(false);    // feuille de gestion des planifiés
  const [rescheduleId, setRescheduleId] = useState(null);   // id en cours de replanification
  const sendLpTimer = useRef(null);
  const sendLpFired = useRef(false);
  const [compressing, setCompressing] = useState(false);
  const imageInputRef = useRef(null);

  // Message vocal : enregistrement micro (MediaRecorder) → data URL.
  const [recording, setRecording]     = useState(false);
  const [pendingAudio, setPendingAudio] = useState(null);
  const [recordSecs, setRecordSecs]   = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const MAX_RECORD_SECS = 120;

  // Cap vidéo : les médias sont stockés en data URL (base64, +33 %) dans un
  // document Mongo (limite 16 Mo). 8 Mo bruts → ~10,7 Mo encodés, marge sûre.
  const MAX_VIDEO_BYTES = 8_000_000;

  const handlePickMedia = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de re-sélectionner le même fichier
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) { toast.error(t("dm.err_select_media")); return; }
    try {
      setCompressing(true);
      let dataUrl;
      if (isVideo) {
        if (file.size > MAX_VIDEO_BYTES) { toast.error(t("dm.err_video_heavy")); return; }
        dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onloadend = () => resolve(r.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
      } else {
        dataUrl = await compressImage(file);
      }
      setPendingAudio(null);
      setPendingImage(dataUrl);
      const kb = Math.max(1, Math.round(dataUrlBytes(dataUrl) / 1024));
      toast.success(`${isVideo ? "Vidéo" : "Image"} prête (~${kb} Ko)`);
    } catch {
      toast.error(t("dm.err_media_process"));
    } finally {
      setCompressing(false);
    }
  };

  // ── Enregistrement vocal ─────────────────────────────────────────────────────
  const startRecording = async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: mr.mimeType || "audio/webm" });
        if (blob.size > 4_000_000) { toast.error(t("dm.err_voice_long")); return; }
        if (blob.size < 400) return; // trop court / vide
        const reader = new FileReader();
        reader.onloadend = () => setPendingAudio(reader.result);
        reader.readAsDataURL(blob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setPendingImage(null);
      setRecordSecs(0);
      setRecording(true);
    } catch { toast.error(t("dm.err_mic")); }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    setRecording(false);
  };

  const cancelRecording = () => {
    audioChunksRef.current = [];
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") { mr.onstop = null; mr.stop(); mr.stream?.getTracks?.().forEach((t) => t.stop()); }
    setRecording(false);
    setPendingAudio(null);
  };

  // Chrono d'enregistrement + coupure automatique à MAX_RECORD_SECS.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      setRecordSecs((s) => {
        if (s + 1 >= MAX_RECORD_SECS) { stopRecording(); return MAX_RECORD_SECS; }
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [recording]);

  const fmtSecs = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const hasSelection = Boolean(selectedUserId || selectedGroupId);
  const currentName  = selectedUser?.username || selectedGroup?.name || "";
  const currentPic   = selectedUser?.profile_pic || selectedGroup?.avatar_url || "";

  // ── Fetch on mount + auto-refetch au retour sur l'onglet (façon React Query) ──
  useEffect(() => {
    fetchConversations();
    fetchGroups();
    fetchNotes();
    const onFocus = () => { fetchConversations(); fetchGroups(); fetchNotes(); };
    const onVisible = () => { if (document.visibilityState === "visible") onFocus(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      fetchMessages(selectedUserId);
      markAsRead(selectedUserId);
    } else if (selectedGroupId) {
      fetchGroupMessages(selectedGroupId);
    }
  }, [selectedUserId, selectedGroupId]);

  // Changement de conversation → on ARME un scroll FORCÉ pour le prochain rendu
  // des messages (les messages arrivent APRÈS via fetchMessages, donc on ne peut
  // pas forcer ici : il n'y a encore rien à afficher).
  const forceScrollRef = useRef(true);
  useEffect(() => { forceScrollRef.current = true; }, [selectedUserId, selectedGroupId]);

  // Rendu des messages : à l'ouverture d'une conversation on FORCE le bas
  // (plusieurs passes pour rattraper la hauteur des images) ; sur un simple
  // nouveau message on ne recolle QUE si on est déjà proche du bas — on
  // n'arrache jamais l'utilisateur en train de lire d'anciens messages.
  useLayoutEffect(() => {
    const force = forceScrollRef.current;
    forceScrollRef.current = false;
    scrollToBottom(force);
    requestAnimationFrame(() => scrollToBottom(force));
    if (force) {
      const t1 = setTimeout(() => scrollToBottom(true), 150);
      const t2 = setTimeout(() => scrollToBottom(true), 500);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [messages]);

  // ── Hauteur réelle du viewport VISIBLE (fix iOS Safari) ──────────────────────
  // position: fixed s'aligne sur le *layout viewport* : il s'étend derrière la
  // barre d'URL dynamique et ignore le clavier. Résultat : la barre d'envoi
  // « flottait » avec du vide en dessous. On pilote donc la hauteur ET le décalage
  // haut du conteneur de chat avec l'API VisualViewport, qui reflète EXACTEMENT
  // la zone visible (barre d'URL + clavier compris). L'input reste ainsi collé
  // pile en bas de l'écran visible, comme sur Instagram.
  useEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const apply = () => {
      const h = vv ? vv.height : window.innerHeight;
      const top = vv ? vv.offsetTop : 0;
      root.style.setProperty("--nexus-vh", `${Math.round(h)}px`);
      root.style.setProperty("--nexus-vtop", `${Math.round(top)}px`);
      // La géométrie a changé (clavier, barre d'URL) → on recolle en bas.
      scrollToBottom(true);
    };
    apply();
    if (vv) {
      vv.addEventListener("resize", apply);
      vv.addEventListener("scroll", apply);
    }
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      if (vv) {
        vv.removeEventListener("resize", apply);
        vv.removeEventListener("scroll", apply);
      }
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
    };
  }, []);

  // Messages entrants en temps réel (émis par la couche WebSocket dans Layout)
  useEffect(() => {
    const onRealtime = (e) => {
      const data = e.detail;
      if (!data) return;
      // Suppression « pour tout le monde » émise par l'autre partie.
      if (data.type === "message_deleted") {
        const del = data.data || {};
        setMessages((prev) => prev.filter((x) => x.id !== del.id));
        fetchConversations();
        return;
      }
      // L'autre partie a lu la conversation → « Vu » sur mes messages.
      if (data.type === "messages_read") {
        const ev = data.data || {};
        if (selectedUserId && ev.reader_id === selectedUserId) {
          setMessages((prev) => prev.map((x) => x.sender_id === user.id ? { ...x, status: "read", read: true, read_at: x.read_at || ev.read_at } : x));
        }
        return;
      }
      // Réaction (ajout/retrait) émise par l'autre partie → maj en direct.
      if (data.type === "reaction_update") {
        const ev = data.data || {};
        setMessages((prev) => prev.map((x) => x.id === ev.message_id ? { ...x, reactions: ev.reactions } : x));
        return;
      }
      // L'autre partie a changé le réglage des messages éphémères.
      if (data.type === "ephemeral_changed") {
        const ev = data.data || {};
        if (selectedUserId && ev.peer_id === selectedUserId) setEphemeralTtl(ev.ttl_seconds || 0);
        return;
      }
      if (data.type !== "new_message") return;
      const m = data.data || {};
      // Message de la conversation ouverte -> on l'ajoute en direct
      if (selectedUserId && m.sender_id === selectedUserId) {
        setMessages((prev) =>
          prev.some((x) => x.id === m.id)
            ? prev
            : [...prev, {
                id: m.id,
                sender_id: m.sender_id,
                sender_username: m.sender_username,
                sender_profile_pic: m.sender_profile_pic,
                recipient_id: m.recipient_id,
                content: m.content,
                media_url: m.media_url,
                media_type: m.media_type,
                reply_to_id: m.reply_to_id,
                expires_at: m.expires_at,
                created_at: m.created_at,
              }]
        );
        markAsRead(selectedUserId);
      }
      // Rafraîchit la liste (dernier message + non lus)
      fetchConversations();
    };
    window.addEventListener("nexus:realtime", onRealtime);
    return () => window.removeEventListener("nexus:realtime", onRealtime);
  }, [selectedUserId]);

  // Filet de sécurité temps réel : resynchronise à la reconnexion WebSocket, et
  // interroge périodiquement (onglet visible) pour afficher les nouveaux
  // messages même si le temps réel décroche (mise en veille du backend Render) —
  // sans jamais rafraîchir toute la page.
  useEffect(() => {
    const mergeIfChanged = (incoming) => (prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const changed = prev.length !== incoming.length || incoming.some((m) => !ids.has(m.id));
      return changed ? incoming : prev;
    };
    const syncOpenThread = async () => {
      try {
        if (selectedGroupId) {
          const r = await axios.get(`${API}/messages/groups/${selectedGroupId}/messages`);
          setMessages(mergeIfChanged(r.data?.messages || []));
        } else if (selectedUserId) {
          const r = await axios.get(`${API}/messages/${selectedUserId}`);
          setMessages(mergeIfChanged(r.data || []));
        }
      } catch { /* silencieux */ }
    };
    const onResync = () => { fetchConversations(); fetchGroups(); fetchNotes(); syncOpenThread(); };
    window.addEventListener("nexus:resync", onResync);
    // Les nouveaux messages arrivent en TEMPS RÉEL (WebSocket). Le poll ne fait
    // donc que rafraîchir la liste LÉGÈRE des conversations — il NE re-télécharge
    // PLUS tout le fil ouvert (payload lourd base64) à chaque tick. La resynchro
    // complète du fil reste faite sur reconnexion (événement nexus:resync).
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") fetchConversations();
    }, 15000);
    return () => { window.removeEventListener("nexus:resync", onResync); clearInterval(poll); };
  }, [selectedUserId, selectedGroupId]);

  // Search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const t = setTimeout(() => searchUsers(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    if (!groupSearch.trim()) { setGroupSearchRes([]); return; }
    const t = setTimeout(() => searchGroupUsers(groupSearch), 300);
    return () => clearTimeout(t);
  }, [groupSearch]);

  useEffect(() => {
    if (!nmSearch.trim()) { setNmResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await axios.get(`${API}/users/search?q=${encodeURIComponent(nmSearch)}`);
        setNmResults((res.data || []).filter((u) => u.id !== user.id));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [nmSearch]);

  // Referme le panneau Détails quand on change de conversation.
  useEffect(() => {
    setShowDetails(false); setDetailsMore(false);
    setShowEphemeralChooser(false); setEphemeralTtl(0);
    setEditingName(false); setShowAddMember(false); setAddMemberSearch("");
  }, [selectedUserId, selectedGroupId]);

  // Charge la liste des membres quand on ouvre les détails d'un groupe.
  useEffect(() => {
    if (showDetails && selectedGroupId) fetchGroupMembers(selectedGroupId);
  }, [showDetails, selectedGroupId]);

  // Recherche de membres à ajouter (exclut les membres déjà présents).
  useEffect(() => {
    if (!addMemberSearch.trim()) { setAddMemberResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await axios.get(`${API}/users/search?q=${encodeURIComponent(addMemberSearch)}`);
        const existing = new Set(groupMembers.map((m) => m.id));
        setAddMemberResults((res.data || []).filter((u) => !existing.has(u.id)));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [addMemberSearch, groupMembers]);

  // ── API calls ───────────────────────────────────────────────────────────────
  const fetchConversations = async () => {
    try {
      const res = await axios.get(`${API}/messages/conversations`);
      const list = res.data || [];
      setConversations(list);
      try { localStorage.setItem("nexus_convs_cache", JSON.stringify(list)); } catch {}
    } catch { console.error("Erreur conversations"); } // garde le cache en cas d'échec
  };

  const fetchGroups = async () => {
    try {
      // Using the alias endpoint to avoid route conflict with /{user_id}
      const res = await axios.get(`${API}/messages/groups-list`);
      const list = res.data.groups || [];
      setGroups(list);
      try { localStorage.setItem("nexus_groups_cache", JSON.stringify(list)); } catch {}
    } catch {} // garde le cache en cas d'échec (on ne vide plus la liste)
  };

  const fetchNotes = async () => {
    try {
      const res = await axios.get(`${API}/notes`);
      setNotes(res.data.notes || []);
    } catch { setNotes([]); }
  };

  const myNote = notes.find((n) => n.is_self) || null;
  const otherNotes = notes.filter((n) => !n.is_self);

  const openNoteComposer = () => {
    setNoteText(myNote?.content || "");
    setShowNoteComposer(true);
  };

  const saveNote = async () => {
    const text = noteText.trim();
    if (!text) return;
    try {
      await axios.post(`${API}/notes`, { content: text.slice(0, NOTE_MAX) });
      setShowNoteComposer(false);
      setNoteText("");
      fetchNotes();
      toast.success(t("dm.note_published"));
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur");
    }
  };

  const deleteMyNote = async () => {
    try {
      await axios.delete(`${API}/notes`);
      setShowNoteComposer(false);
      setNoteText("");
      fetchNotes();
      toast.success(t("dm.note_deleted"));
    } catch { toast.error(t("dm.err_generic")); }
  };

  const fetchMessages = async (uid) => {
    try {
      setLoading(true);
      // En-tête INSTANTANÉ : si l'interlocuteur est déjà dans la liste des
      // conversations (username + avatar connus), on l'affiche tout de suite,
      // sans attendre la réponse de /users/{uid} → le fil s'ouvre sans écran
      // d'attente (la réponse complète remplace ensuite ces infos).
      const known = conversations.find((c) => c.user_id === uid);
      if (known) setSelectedUser({ id: uid, username: known.username, profile_pic: known.profile_pic });
      const [msgsRes, userRes] = await Promise.all([
        axios.get(`${API}/messages/${uid}`),
        axios.get(`${API}/users/${uid}`)
      ]);
      setMessages(msgsRes.data || []);
      setSelectedUser(userRes.data);
      setSelectedGroup(null);
      // Réglage des messages éphémères de cette conversation.
      try {
        const eph = await axios.get(`${API}/messages/conversations/${uid}/ephemeral`);
        setEphemeralTtl(eph.data?.ttl_seconds || 0);
      } catch { setEphemeralTtl(0); }
    } catch { toast.error(t("dm.err_load_messages")); }
    finally { setLoading(false); }
  };

  const setEphemeral = async (ttl) => {
    if (!selectedUserId) return;
    try {
      await axios.put(`${API}/messages/conversations/${selectedUserId}/ephemeral`, { ttl_seconds: ttl });
      setEphemeralTtl(ttl);
      setShowEphemeralChooser(false);
      toast.success(ttl ? `Messages éphémères : ${ephemeralLabel(ttl)}` : "Messages éphémères désactivés");
    } catch { toast.error(t("dm.err_generic")); }
  };

  // Purge locale des messages éphémères expirés (toutes les 10 s).
  useEffect(() => {
    const t = setInterval(() => {
      const now = new Date().toISOString();
      setMessages((prev) => {
        const kept = prev.filter((m) => !m.expires_at || m.expires_at > now);
        return kept.length === prev.length ? prev : kept;
      });
    }, 10000);
    return () => clearInterval(t);
  }, []);

  const fetchGroupMessages = async (gid) => {
    try {
      setLoading(true);
      const [msgsRes, grpRes] = await Promise.all([
        axios.get(`${API}/messages/groups/${gid}/messages`),
        axios.get(`${API}/messages/groups/${gid}`)
      ]);
      setMessages(msgsRes.data.messages || []);
      setSelectedGroup(grpRes.data.group);
      setSelectedUser(null);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors du chargement du groupe");
      setMessages([]); setSelectedGroup(null);
    } finally { setLoading(false); }
  };

  const markAsRead = async (uid) => {
    try {
      await axios.put(`${API}/messages/mark-as-read/${uid}`);
      fetchConversations();
      window.dispatchEvent(new Event("nexus:badges")); // rafraîchit la pastille Messages
    } catch {}
  };

  // ── Menu appui long (mobile) : épingler / sourdine / non lu / supprimer ───────
  // convMenu = { kind: "dm"|"group", id, name, pinned, muted } | null
  const [convMenu, setConvMenu] = useState(null);

  // Met à jour une préférence de conversation (DM ou groupe) côté serveur puis
  // rafraîchit la liste. `patch` = { pinned?, muted?, marked_unread? }.
  const setConvPref = async (targetId, patch) => {
    try {
      await axios.post(`${API}/messages/prefs/${targetId}`, patch);
      fetchConversations();
      fetchGroups();
      window.dispatchEvent(new Event("nexus:badges"));
    } catch { toast.error(t("dm.err_action")); }
  };

  const handleMarkUnread = async () => {
    if (!convMenu) return;
    await setConvPref(convMenu.id, { marked_unread: true });
    toast.success(t("dm.marked_unread"));
    setConvMenu(null);
  };

  const handleTogglePin = async () => {
    if (!convMenu) return;
    await setConvPref(convMenu.id, { pinned: !convMenu.pinned });
    toast.success(convMenu.pinned ? "Désépinglé" : "Épinglé");
    setConvMenu(null);
  };

  const handleToggleMutePref = async () => {
    if (!convMenu) return;
    await setConvPref(convMenu.id, { muted: !convMenu.muted });
    toast.success(convMenu.muted ? "Notifications réactivées" : "Mis en sourdine");
    setConvMenu(null);
  };

  const handleDeleteFromMenu = async () => {
    if (!convMenu) return;
    const m = convMenu;
    setConvMenu(null);
    if (m.kind === "group") {
      if (!window.confirm(`Quitter le groupe « ${m.name} » ?`)) return;
      try {
        await axios.delete(`${API}/messages/groups/${m.id}/members/${user.id}`);
        setGroups((prev) => prev.filter((g) => g.id !== m.id));
        if (selectedGroupId === m.id) navigate("/messages");
        fetchGroups();
        toast.success(t("dm.group_left"));
      } catch { toast.error(t("dm.err_leave_group")); }
    } else {
      if (!window.confirm(t("dm.confirm_delete_convo"))) return;
      try {
        await axios.delete(`${API}/messages/conversations/${m.id}`);
        if (selectedUserId === m.id) navigate("/messages");
        fetchConversations();
        toast.success(t("dm.conv_deleted"));
      } catch { toast.error(t("dm.err_delete")); }
    }
  };

  // Démarre le minuteur d'appui long ; ouvre le menu au bout de 450 ms.
  const startConvLongPress = (payload) => {
    clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch {} }
      // Efface toute sélection de texte déclenchée par l'appui long (le menu
      // remplace ce geste natif).
      try { window.getSelection()?.removeAllRanges(); } catch {}
      setConvMenu(payload);
    }, 450);
  };
  const cancelConvLongPress = () => clearTimeout(longPressTimer.current);

  // ── Appui long sur un MESSAGE → menu d'actions (réagir/répondre/copier/supprimer)
  // Remplace le survol PC sur mobile, façon Instagram, adapté à Nexus.
  const [msgMenu, setMsgMenu] = useState(null); // objet message | null
  const longPressFired = useRef(false);
  const lastTap = useRef({ id: null, t: 0 });
  const [heartBurst, setHeartBurst] = useState(null); // id du message qui « pop » un cœur

  const startMsgLongPress = (msg) => {
    clearTimeout(longPressTimer.current);
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      if (navigator.vibrate) { try { navigator.vibrate(15); } catch {} }
      try { window.getSelection()?.removeAllRanges(); } catch {}
      setMsgMenu(msg);
    }, 400);
  };
  const cancelMsgLongPress = () => clearTimeout(longPressTimer.current);

  // Double-tap → « like » cœur (rapide). Ne retire pas si déjà liké au cœur.
  const likeHeart = (msg) => {
    if (myReaction(msg.reactions) === "❤️") return;
    handleReaction(msg.id, "❤️");
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch {} }
    setHeartBurst(msg.id);
    setTimeout(() => setHeartBurst((v) => (v === msg.id ? null : v)), 700);
  };

  // ── Swipe → répondre (façon Instagram) ───────────────────────────────────────
  // Glisser un message vers la droite (reçu) / gauche (envoyé) déclenche la réponse.
  const [swipe, setSwipe] = useState({ id: null, dx: 0 });
  const swipeStart = useRef(null);
  const SWIPE_REPLY = 55;
  const onMsgTouchStart = (msg, e) => {
    startMsgLongPress(msg);
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY, own: msg.sender_id === user.id, moved: false };
  };
  const onMsgTouchMove = (msg, e) => {
    const s = swipeStart.current;
    if (!s) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { cancelMsgLongPress(); s.moved = true; }
    // Sens autorisé : reçu → droite ; envoyé → gauche. Uniquement geste horizontal.
    const dir = s.own ? -1 : 1;
    if (dx * dir > 0 && Math.abs(dx) > Math.abs(dy)) {
      setSwipe({ id: msg.id, dx: Math.max(-80, Math.min(80, dx)) });
    }
  };
  const onMsgTouchEnd = (msg) => {
    cancelMsgLongPress();
    const s = swipeStart.current;
    swipeStart.current = null;
    const reached = Math.abs(swipe.dx) > SWIPE_REPLY && swipe.id === msg.id;
    setSwipe({ id: null, dx: 0 });
    if (s && reached) {
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch {} }
      setReplyingTo(msg);
      return;
    }
    if (longPressFired.current) { longPressFired.current = false; return; } // menu ouvert
    if (s && s.moved) return; // c'était un glissement, pas un tap
    // Tap simple : détection du double-tap (❤️).
    const now = Date.now();
    if (lastTap.current.id === msg.id && now - lastTap.current.t < 300) {
      lastTap.current = { id: null, t: 0 };
      likeHeart(msg);
    } else {
      lastTap.current = { id: msg.id, t: now };
    }
  };

  const searchUsers = async (q) => {
    try {
      const res = await axios.get(`${API}/users/search?q=${encodeURIComponent(q)}`);
      setSearchResults((res.data || []).filter(u => u.id !== user.id));
    } catch {}
  };

  const searchGroupUsers = async (q) => {
    try {
      const res = await axios.get(`${API}/users/search?q=${encodeURIComponent(q)}`);
      setGroupSearchRes((res.data || []).filter(u => u.id !== user.id));
    } catch {}
  };

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    // Appui long sur « Envoyer » → planification (on ne part pas tout de suite).
    if (sendLpFired.current) { sendLpFired.current = false; return; }
    const text = messageContent.trim();
    if (!text && !pendingImage && !pendingAudio) return;
    try {
      if (isGroup && selectedGroupId) {
        // Groupes : images, vidéos et vocaux transitent via `media_urls`
        // (le backend les stocke tel quel et les renvoie dans le message).
        const media = pendingAudio || pendingImage;
        const res = await axios.post(`${API}/messages/groups/${selectedGroupId}/messages`, {
          content: text,
          media_urls: media ? [media] : [],
          reply_to_id: replyingTo?.id,
        });
        if (res.data?.message) setMessages(p => [...p, res.data.message]);
      } else if (selectedUserId) {
        const res = await axios.post(`${API}/messages`, {
          recipient_id: selectedUserId,
          content: text,
          media_url: pendingAudio || pendingImage || null,
          media_type: pendingAudio
            ? "audio"
            : (pendingImage ? (isVideoDataUrl(pendingImage) ? "video" : "image") : null),
          reply_to_id: replyingTo?.id,
        });
        if (res.data) setMessages(p => [...p, res.data]);
      }
      setMessageContent(""); setReplyingTo(null); setPendingImage(null); setPendingAudio(null);
      fetchConversations();
      if (isGroup) fetchGroups();  // remonte le groupe en haut de la liste
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors de l'envoi");
    }
  };

  // Envoie un dessin (canevas → PNG) comme image, en réutilisant le pipeline média.
  const postDrawing = async (dataUrl) => {
    if (!dataUrl) return;
    try {
      if (isGroup && selectedGroupId) {
        const res = await axios.post(`${API}/messages/groups/${selectedGroupId}/messages`, {
          content: "", media_urls: [dataUrl], reply_to_id: replyingTo?.id,
        });
        if (res.data?.message) setMessages((p) => [...p, res.data.message]);
      } else if (selectedUserId) {
        const res = await axios.post(`${API}/messages`, {
          recipient_id: selectedUserId, content: "", media_url: dataUrl, media_type: "image", reply_to_id: replyingTo?.id,
        });
        if (res.data) setMessages((p) => [...p, res.data]);
      }
      setReplyingTo(null);
      fetchConversations();
      if (isGroup) fetchGroups();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors de l'envoi");
    }
  };

  // ── Messages planifiés (Scheduled DMs) ───────────────────────────────────────
  const fetchScheduled = useCallback(async (peer) => {
    if (!peer) { setScheduledMsgs([]); return; }
    try {
      const r = await axios.get(`${API}/messages/scheduled`, { params: { peer_id: peer } });
      setScheduledMsgs(Array.isArray(r.data) ? r.data : []);
    } catch { setScheduledMsgs([]); }
  }, []);

  useEffect(() => {
    if (!isGroup && selectedUserId) fetchScheduled(selectedUserId);
    else setScheduledMsgs([]);
  }, [selectedUserId, isGroup, fetchScheduled]);

  const scheduleCurrentMessage = async (iso) => {
    const text = messageContent.trim();
    if ((!text && !pendingImage) || !selectedUserId) return;
    try {
      await axios.post(`${API}/messages/scheduled`, {
        recipient_id: selectedUserId, content: text,
        media_url: pendingImage || null, media_type: pendingImage ? "image" : null,
        scheduled_at: iso,
      });
      setMessageContent(""); setPendingImage(null);
      fetchScheduled(selectedUserId);
      toast.success(t("dm.msg_scheduled"));
    } catch (err) { toast.error(err.response?.data?.detail || "Planification impossible"); }
  };

  const sendScheduledNow = async (id) => {
    try { await axios.post(`${API}/messages/scheduled/${id}/send-now`); fetchScheduled(selectedUserId); if (selectedUserId) fetchMessages(selectedUserId); toast.success(t("dm.msg_sent")); }
    catch { toast.error(t("dm.err_send")); }
  };
  const deleteScheduled = async (id) => {
    try { await axios.delete(`${API}/messages/scheduled/${id}`); fetchScheduled(selectedUserId); }
    catch { toast.error(t("dm.err_delete")); }
  };
  const rescheduleTo = async (iso) => {
    if (!rescheduleId) return;
    try { await axios.put(`${API}/messages/scheduled/${rescheduleId}`, { scheduled_at: iso }); fetchScheduled(selectedUserId); toast.success(t("dm.time_changed")); }
    catch { toast.error(t("dm.err_modify")); }
    setRescheduleId(null);
  };

  // Le backend renvoie reactions sous forme de LISTE [{user_id, emoji}] ;
  // on regroupe par emoji pour l'affichage.
  const groupReactions = (reactions) => {
    const counts = {};
    (Array.isArray(reactions) ? reactions : []).forEach((r) => {
      if (r && r.emoji) counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    });
    return Object.entries(counts);
  };

  // Emoji de réaction posé par l'utilisateur courant sur un message (ou null).
  const myReaction = (reactions) =>
    (Array.isArray(reactions) ? reactions : []).find((r) => r.user_id === user.id)?.emoji || null;

  const handleReaction = async (messageId, emoji) => {
    try {
      // Le backend bascule : re-cliquer le même emoji le retire.
      const res = await axios.post(`${API}/messages/${messageId}/react`, { emoji });
      setMessages(p => p.map(m => m.id === messageId ? { ...m, reactions: res.data.reactions } : m));
      setShowEmojiPicker(null);
    } catch { toast.error(t("dm.err_reaction")); }
  };

  // messageId : id ; everyone : true = pour tous (hard delete), false = pour moi.
  const handleDeleteMessage = async (messageId, everyone = true) => {
    try {
      await axios.delete(`${API}/messages/${messageId}`, { data: { delete_for: everyone ? "everyone" : "me" } });
      setMessages(p => p.filter(m => m.id !== messageId));
      fetchConversations();
      toast.success(everyone ? "Message supprimé pour tout le monde" : "Message supprimé pour vous");
    } catch { toast.error(t("dm.err_delete_msg")); }
  };

  // ── Traduction d'un message (langue = paramètres de l'app) ───────────────────
  const [translations, setTranslations] = useState({}); // { [msgId]: texte traduit }
  const translateMessage = async (msg) => {
    if (translations[msg.id]) { // déjà traduit → bascule (masque la traduction)
      setTranslations((t) => { const n = { ...t }; delete n[msg.id]; return n; });
      return;
    }
    const target = (localStorage.getItem("i18nextLng") || navigator.language || "fr").split("-")[0];
    try {
      const res = await axios.post(`${API}/messages/translate`, { text: msg.content, target });
      if (res.data?.translated) setTranslations((t) => ({ ...t, [msg.id]: res.data.translated }));
      else toast.error(t("dm.err_translate"));
    } catch { toast.error(t("dm.err_translate")); }
  };

  // ── Transfert d'un message vers une autre conversation ───────────────────────
  const [forwardMsg, setForwardMsg] = useState(null); // message à transférer | null
  const forwardTo = async (target) => {
    // target = { kind: "dm", id } | { kind: "group", id }
    const m = forwardMsg;
    setForwardMsg(null);
    if (!m) return;
    try {
      if (target.kind === "group") {
        await axios.post(`${API}/messages/groups/${target.id}/messages`, { content: m.content || "" });
      } else {
        await axios.post(`${API}/messages`, {
          recipient_id: target.id,
          content: m.content || "",
          media_url: audioSrcFrom(m) ? m.media_url : (m.media_url || null),
          media_type: m.media_type || null,
        });
      }
      toast.success(t("dm.msg_forwarded"));
      fetchConversations();
    } catch { toast.error(t("dm.err_forward")); }
  };

  const handleCopy = (content) => {
    navigator.clipboard.writeText(content);
    toast.success(t("dm.copied"));
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedMembers.length === 0) {
      toast.error(t("dm.err_name_members")); return;
    }
    try {
      setLoading(true);
      const res = await axios.post(`${API}/messages/groups`, {
        name: groupName.trim(), member_ids: selectedMembers.map(m => m.id)
      });
      if (res.data?.group) {
        setShowNewGroup(false); setGroupName(""); setSelectedMembers([]); setGroupSearch("");
        await fetchGroups();
        navigate(`/messages/group/${res.data.group.id}`);
        toast.success(t("dm.group_created"));
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur création groupe");
    } finally { setLoading(false); }
  };

  // ── Administration de groupe ─────────────────────────────────────────────────
  const fetchGroupMembers = async (gid) => {
    try {
      const res = await axios.get(`${API}/messages/groups/${gid}/members`);
      setGroupMembers(res.data.members || []);
      setGroupIsAdmin(!!res.data.is_admin);
      setGroupCreatorId(res.data.creator_id || null);
    } catch { setGroupMembers([]); setGroupIsAdmin(false); }
  };

  const renameGroup = async () => {
    const name = groupNameDraft.trim();
    if (!name) return;
    try {
      const res = await axios.put(`${API}/messages/groups/${selectedGroupId}`, { name });
      if (res.data?.group) setSelectedGroup(res.data.group);
      setEditingName(false);
      fetchGroups();
      toast.success(t("dm.group_renamed"));
    } catch (err) { toast.error(err.response?.data?.detail || "Erreur"); }
  };

  const addGroupMember = async (u) => {
    try {
      await axios.post(`${API}/messages/groups/${selectedGroupId}/members`, { user_id: u.id });
      setAddMemberSearch(""); setAddMemberResults([]); setShowAddMember(false);
      fetchGroupMembers(selectedGroupId);
      fetchGroupMessages(selectedGroupId);
      toast.success(`@${u.username} ajouté`);
    } catch (err) { toast.error(err.response?.data?.detail || "Erreur"); }
  };

  const removeGroupMember = async (m) => {
    if (!window.confirm(`Retirer @${m.username} du groupe ?`)) return;
    try {
      await axios.delete(`${API}/messages/groups/${selectedGroupId}/members/${m.id}`);
      fetchGroupMembers(selectedGroupId);
      toast.success(`@${m.username} retiré`);
    } catch (err) { toast.error(err.response?.data?.detail || "Erreur"); }
  };

  const toggleGroupAdmin = async (m) => {
    try {
      if (m.is_admin) await axios.delete(`${API}/messages/groups/${selectedGroupId}/admins/${m.id}`);
      else await axios.post(`${API}/messages/groups/${selectedGroupId}/admins`, { user_id: m.id });
      fetchGroupMembers(selectedGroupId);
      toast.success(m.is_admin ? "Admin retiré" : "Promu admin");
    } catch (err) { toast.error(err.response?.data?.detail || "Erreur"); }
  };

  const handleLeaveGroup = async () => {
    if (!selectedGroupId) return;
    if (!window.confirm(t("dm.confirm_leave_group"))) return;
    const gid = selectedGroupId;
    try {
      await axios.delete(`${API}/messages/groups/${gid}/members/${user.id}`);
      // Retire immédiatement le groupe de la liste (plus d'attente / de cache).
      setGroups((prev) => prev.filter((g) => g.id !== gid));
      toast.success(t("dm.you_left_group"));
      navigate("/messages");
      fetchGroups();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur");
    }
  };

  // ── « Nouveau message » : recherche + multi-sélection ────────────────────────
  const openNewMessageModal = () => {
    setNmSearch(""); setNmResults([]); setNmSelected([]); setShowNewMessageModal(true);
  };
  const toggleNmSelect = (u) => {
    setNmSelected((prev) => prev.find((x) => x.id === u.id)
      ? prev.filter((x) => x.id !== u.id)
      : [...prev, u]);
  };
  const startConversation = async () => {
    if (nmSelected.length === 0) { toast.error(t("dm.err_select_person")); return; }
    // 1 personne → conversation privée. 2+ → groupe.
    if (nmSelected.length === 1) {
      setShowNewMessageModal(false);
      navigate(`/messages/${nmSelected[0].id}`);
      return;
    }
    try {
      setLoading(true);
      const autoName = nmSelected.map((m) => m.username).join(", ").slice(0, 40);
      const res = await axios.post(`${API}/messages/groups`, {
        name: autoName, member_ids: nmSelected.map((m) => m.id),
      });
      if (res.data?.group) {
        setShowNewMessageModal(false);
        await fetchGroups();
        navigate(`/messages/group/${res.data.group.id}`);
        toast.success(t("dm.group_created"));
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur création groupe");
    } finally { setLoading(false); }
  };

  // ── Actions « Détails » ──────────────────────────────────────────────────────
  const handleClearConversation = async () => {
    if (!selectedUserId) return;
    if (!window.confirm(t("dm.confirm_delete_discussion"))) return;
    try {
      await axios.delete(`${API}/messages/conversations/${selectedUserId}`);
      setConversations((prev) => prev.filter((c) => c.user_id !== selectedUserId));
      setShowDetails(false);
      navigate("/messages");
      toast.success(t("dm.chat_deleted"));
    } catch { toast.error(t("dm.err_generic")); }
  };
  const handleBlockUser = async () => {
    if (!selectedUserId) return;
    if (!window.confirm(`Bloquer @${selectedUser?.username} ?`)) return;
    try {
      await axios.post(`${API}/privacy/block`, { user_id: selectedUserId });
      setShowDetails(false);
      navigate("/messages");
      toast.success(`@${selectedUser?.username} bloqué`);
    } catch { toast.error(t("dm.err_generic")); }
  };
  const handleReport = async () => {
    const target = selectedUserId || selectedGroupId;
    if (!target) return;
    try {
      await axios.post(`${API}/reports`, {
        reported_content_id: target,
        content_type: isGroup ? "group" : "user",
        reason: "Signalé depuis la messagerie",
      });
      setShowDetails(false);
      toast.success(t("dm.report_sent"));
    } catch { toast.error(t("dm.err_generic")); }
  };

  const getStatus = (msg) => {
    if (msg.sender_id !== user.id) return null;
    if (msg.status === "read") return <CheckCheck className="w-3 h-3" style={{ color: C.cyan }} />;
    if (msg.status === "delivered") return <CheckCheck className="w-3 h-3" style={{ color: C.outline }} />;
    return <Check className="w-3 h-3" style={{ color: C.outline }} />;
  };

  const getReplied = (id) => messages.find(m => m.id === id);

  // Recherche dans la conversation ouverte (filtre les messages affichés).
  const convSearchQ = convSearch.trim().toLowerCase();
  const displayedMessages = convSearchQ
    ? messages.filter((m) => (m.content || "").toLowerCase().includes(convSearchQ))
    : messages;

  // « Vu » : dernier message que J'AI envoyé, s'il a été lu par l'autre.
  const lastOwnReadId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.sender_id === user.id) return (m.status === "read" || m.read_at) ? m.id : null;
    }
    return null;
  })();

  // Liste unifiée : messages privés + groupes, triés du plus récent au plus
  // ancien. Chaque nouveau message remonte sa conversation tout en haut.
  const chatItems = useMemo(() => {
    const dms = (conversations || []).map((c) => ({
      key: `dm-${c.user_id}`, kind: "dm", data: c,
      time: c.last_message_time || 0,
    }));
    const grps = (groups || []).map((g) => ({
      key: `grp-${g.id}`, kind: "group", data: g,
      time: g.last_message_time || g.created_at || 0,
    }));
    // Épinglés d'abord, puis du plus récent au plus ancien (façon Instagram).
    return [...dms, ...grps].sort((a, b) => {
      const pa = a.data.pinned ? 1 : 0;
      const pb = b.data.pinned ? 1 : 0;
      if (pa !== pb) return pb - pa;
      return new Date(b.time || 0) - new Date(a.time || 0);
    });
  }, [conversations, groups]);

  // ── Render helpers ──────────────────────────────────────────────────────────
  const ConvItem = ({ conv }) => {
    const active = selectedUserId === conv.user_id;
    const unread = conv.unread_count > 0 || conv.marked_unread;
    const lp = { kind: "dm", id: conv.user_id, name: conv.username, pinned: !!conv.pinned, muted: !!conv.muted };
    return (
      <div className="relative group">
      <button
        onClick={() => navigate(`/messages/${conv.user_id}`)}
        onContextMenu={(e) => { e.preventDefault(); setConvMenu(lp); }}
        onTouchStart={() => startConvLongPress(lp)}
        onTouchEnd={cancelConvLongPress}
        onTouchMove={cancelConvLongPress}
        className="w-full flex items-center gap-3.5 px-4 py-4 text-left transition-all"
        style={{
          // Nouvelle conversation non lue → surlignage bleu ; sinon état actif/normal.
          background: active
            ? `linear-gradient(to right, ${C.cyan}10, transparent)`
            : unread ? "rgba(59,130,246,0.10)" : "transparent",
          borderLeft: active ? `2px solid ${C.cyan}` : unread ? "2px solid #3b82f6" : "2px solid transparent",
          WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none",
        }}
      >
        <div className="relative">
          <UserAvatar username={conv.username} pic={conv.profile_pic} size={10} />
          {/* Présence : point vert « en ligne » (masqué si l'interlocuteur a caché son statut). */}
          {conv.is_online && <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full" style={{ background: "#22c55e", border: `2px solid ${C.surface}`, boxShadow: "0 0 6px rgba(34,197,94,0.6)" }} />}
          {unread && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full" style={{ background: "#3b82f6", border: `2px solid ${C.surface}` }} />}
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm truncate flex items-center gap-1" style={{ color: active ? C.cyan : C.onSurface, fontWeight: unread ? 800 : 700 }}>
              <span className="truncate">{conv.username}</span>
              {conv.pinned && <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 13, color: C.outline }}>keep</span>}
              {conv.muted && <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 13, color: C.outline }}>notifications_off</span>}
            </p>
            {conv.unread_count > 0 && (
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "#3b82f6", color: "#fff" }}>{conv.unread_count}</span>
            )}
          </div>
          <p className="text-xs truncate" style={{ color: unread ? C.onVariant : C.outline, fontWeight: unread ? 600 : 400 }}>{conv.last_message}</p>
        </div>
      </button>
      {/* PC : 3 points au survol → menu (non lu / épingler / sourdine / supprimer). */}
      <button
        title={t("dm.options")}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConvMenu(lp); }}
        className="hidden lg:flex items-center justify-center absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: C.high, color: C.onSurface, border: `1px solid ${C.outlineVar}` }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>more_horiz</span>
      </button>
      </div>
    );
  };

  const GroupItem = ({ group }) => {
    const active = selectedGroupId === group.id;
    const unread = !!group.marked_unread;
    const lp = { kind: "group", id: group.id, name: group.name, pinned: !!group.pinned, muted: !!group.muted };
    return (
      <div className="relative group">
      <button
        onClick={() => navigate(`/messages/group/${group.id}`)}
        onContextMenu={(e) => { e.preventDefault(); setConvMenu(lp); }}
        onTouchStart={() => startConvLongPress(lp)}
        onTouchEnd={cancelConvLongPress}
        onTouchMove={cancelConvLongPress}
        className="w-full flex items-center gap-3.5 px-4 py-4 text-left transition-all"
        style={{
          background: active ? `linear-gradient(to right, rgba(139,92,246,0.1), transparent)` : unread ? "rgba(59,130,246,0.10)" : "transparent",
          borderLeft: active ? "2px solid #8b5cf6" : unread ? "2px solid #3b82f6" : "2px solid transparent",
          WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none",
        }}
      >
        {group.avatar_url ? (
          <img src={group.avatar_url} alt={group.name} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
            style={{ background: "#28303e", color: "#fff" }}>
            {group.name?.[0]?.toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <p className="text-sm font-bold truncate flex items-center gap-1" style={{ color: active ? "#a78bfa" : C.onSurface }}>
            <span className="truncate">{group.name}</span>
            {group.pinned && <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 13, color: C.outline }}>keep</span>}
            {group.muted && <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 13, color: C.outline }}>notifications_off</span>}
          </p>
          <p className="text-xs truncate" style={{ color: C.outline }}>
            {group.last_message || `${group.member_ids?.length || 0} membres`}
          </p>
        </div>
      </button>
      {/* PC : 3 points au survol → menu (non lu / épingler / sourdine / supprimer). */}
      <button
        title={t("dm.options")}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConvMenu(lp); }}
        className="hidden lg:flex items-center justify-center absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: C.high, color: C.onSurface, border: `1px solid ${C.outlineVar}` }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>more_horiz</span>
      </button>
      </div>
    );
  };

  // ── Conversation list panel ──────────────────────────────────────────────────
  const ConvPanel = () => (
    <div
      className={`flex flex-col border-r h-full w-full sm:w-[300px] sm:min-w-[280px] sm:max-w-[320px] select-none sm:select-text ${hasSelection ? "hidden sm:flex" : "flex"}`}
      style={{ borderColor: "rgba(255,255,255,0.05)", background: `${C.surface}cc`, WebkitTouchCallout: "none" }}
    >
      {/* Header — pas de trait de séparation, même fond que la liste.
          Plus de bouton retour : le footer mobile gère la navigation. */}
      <div className="px-5 pt-[calc(1.25rem_+_env(safe-area-inset-top))] pb-3 flex items-center gap-2">
        {/* Espaceur gauche = largeur exacte du bouton droit → le pseudo est
            centré MATHÉMATIQUEMENT au milieu du header (façon Instagram).
            Masqué sur PC, où le pseudo s'aligne à gauche. */}
        <div className="w-9 flex-shrink-0 sm:hidden" aria-hidden />
        {/* Nom d'utilisateur : centré sur mobile, aligné à gauche sur PC */}
        <h2 className="font-black text-xl tracking-tight flex-1 min-w-0 text-center sm:text-left truncate"
          style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>
          {user?.username || "Messages"}
        </h2>
        {/* Un seul bouton « Nouveau message » (façon Insta : DM ou groupe). */}
        <button onClick={openNewMessageModal} title={t("dm.new_message")}
          className="w-9 h-9 flex-shrink-0 rounded-xl flex items-center justify-center transition-all hover:opacity-80"
          style={{ background: `${C.cyan}18`, color: C.cyan }}>
          <span className="material-symbols-outlined text-lg">edit_square</span>
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: C.outline }}>search</span>
          <input
            ref={newMsgSearchRef}
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value.trim()) setShowNewMsg(false); else setShowNewMsg(true); }}
            placeholder={t("dm.search_conv")}
            className="w-full text-sm pl-9 pr-3 py-2.5 rounded-xl border-none outline-none placeholder:text-slate-600 select-text truncate"
            style={{ background: C.high, color: C.onSurface, WebkitUserSelect: "text", userSelect: "text" }}
          />
        </div>
      </div>

      {/* Search results */}
      {showNewMsg && searchResults.length > 0 && (
        <div className="px-4 pb-3 space-y-1">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: C.outline }}>{t("dm.users")}</p>
          {searchResults.map(u => (
            <button key={u.id} onClick={() => { navigate(`/messages/${u.id}`); setSearchQuery(""); setShowNewMsg(false); }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all hover:bg-white/5 text-left">
              <UserAvatar username={u.username} pic={u.profile_pic} size={8} />
              <span className="text-sm font-medium" style={{ color: C.onSurface }}>@{u.username}</span>
            </button>
          ))}
        </div>
      )}

      {/* Notes éphémères (façon Instagram) — bande horizontale scrollable.
          La bulle peut s'étendre jusqu'à 3 lignes ; seuls les abonnements
          mutuels apparaissent (filtrés côté serveur). */}
      {!showNewMsg && (
        <div className="px-4 pb-4 pt-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          <div className="flex gap-5 items-end">
            {/* Ta note */}
            <button onClick={openNoteComposer} className="flex flex-col items-center gap-1.5 flex-shrink-0" style={{ width: 88 }} title={t("dm.your_note")}>
              <div className="px-3 py-1.5 rounded-2xl text-[11px] font-medium leading-snug text-center shadow-lg"
                style={{ maxWidth: 86, background: C.container, color: myNote ? C.onSurface : C.outline, border: `1px solid ${C.cyan}22`,
                  display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {myNote ? myNote.content : "Note…"}
              </div>
              <div className="relative -mt-1">
                <UserAvatar username={user?.username} pic={user?.profile_pic} size={16} />
                {!myNote && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-sm font-black"
                    style={{ background: C.cyan, color: C.onPrimary, border: `2px solid ${C.surface}` }}>+</div>
                )}
              </div>
              <span className="text-[11px] font-semibold text-center truncate" style={{ width: 82, color: C.onSurface }}>{t("dm.your_note")}</span>
            </button>

            {/* Notes des abonnements mutuels */}
            {otherNotes.map((n) => (
              <button key={n.id} onClick={() => navigate(`/messages/${n.user_id}`)}
                className="flex flex-col items-center gap-1.5 flex-shrink-0" style={{ width: 88 }} title={n.content}>
                <div className="px-3 py-1.5 rounded-2xl text-[11px] font-medium leading-snug text-center shadow-lg"
                  style={{ maxWidth: 86, background: C.container, color: C.onSurface, border: `1px solid ${C.cyan}22`,
                    display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {n.content}
                </div>
                <div className="-mt-1"><UserAvatar username={n.username} pic={n.profile_pic} size={16} /></div>
                <span className="text-[11px] text-center truncate" style={{ width: 82, color: C.outline }}>@{n.username}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scrollable list — groupes et messages privés fusionnés, triés du plus
          récent au plus ancien (chaque nouveau message remonte en haut).
          pb-20 sur mobile pour ne pas passer sous le footer. */}
      <div ref={convScrollRef}
        onTouchStart={onConvPullStart} onTouchMove={onConvPullMove} onTouchEnd={onConvPullEnd}
        className="flex-1 min-h-0 overflow-y-auto pb-20 lg:pb-0" style={{ overscrollBehavior: "contain" }}>
        {/* Indicateur « tirer pour rafraîchir » (mobile) */}
        {(convPull > 0 || convRefreshing) && (
          <div className="flex justify-center items-center overflow-hidden"
            style={{ height: convRefreshing ? 36 : convPull, transition: convPullStartY.current ? "none" : "height 0.2s" }}>
            <div className="w-6 h-6 rounded-full border-2"
              style={{ borderColor: `${C.cyan}33`, borderTopColor: C.cyan,
                animation: convRefreshing ? "spin 0.7s linear infinite" : "none",
                transform: convRefreshing ? "none" : `rotate(${convPull * 4}deg)`, opacity: Math.min(1, convPull / PULL_THRESHOLD) }} />
          </div>
        )}
        {/* Nexus AI — épinglé tout en haut, toujours accessible. */}
        {!showNewMsg && (
          <button onClick={() => setShowAI(true)}
            className="w-full flex items-center gap-3.5 px-4 py-4 transition-all hover:bg-white/5 text-left">
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: `linear-gradient(135deg, ${C.cyan}, #3b82f6)` }}>
              <span className="material-symbols-outlined text-xl" style={{ color: C.onPrimary }}>auto_awesome</span>
            </div>
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <p className="font-bold flex items-center gap-1" style={{ color: C.onSurface }}>
                Nexus AI
                <span className="material-symbols-outlined text-base" style={{ color: C.cyan, fontVariationSettings: "'FILL' 1" }}>verified</span>
              </p>
              <p className="text-xs truncate" style={{ color: C.outline }}>Ton assistant — pose ta question</p>
            </div>
          </button>
        )}

        {chatItems.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <span className="material-symbols-outlined text-3xl block mb-2" style={{ color: C.outline, opacity: 0.4 }}>forum</span>
            <p className="text-xs" style={{ color: C.outline }}>{t("dm.no_conversations")}</p>
            <button onClick={openNewMessage} className="mt-3 text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:opacity-80" style={{ background: `${C.cyan}18`, color: C.cyan }}>
              Commencer
            </button>
          </div>
        ) : (
          chatItems.map((item) =>
            item.kind === "group"
              ? <GroupItem key={item.key} group={item.data} />
              : <ConvItem key={item.key} conv={item.data} />
          )
        )}
      </div>
    </div>
  );

  // ── Chat panel ───────────────────────────────────────────────────────────────
  const ChatPanel = () => (
    <div className={`flex-1 min-h-0 flex flex-col overflow-hidden ${hasSelection ? "flex" : "hidden sm:flex"}`} style={{ background: "rgba(2,6,23,0.5)" }}>
      {hasSelection && currentName ? (
        <>
          {/* Chat header */}
          <div className="min-h-[3.5rem] hdr-safe px-5 flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(11,19,38,0.6)" }}>
            <div className="flex items-center gap-3">
              <button onClick={() => navigate("/messages")} className="sm:hidden mr-1" style={{ color: C.outline }}>
                <span className="material-symbols-outlined">arrow_back</span>
              </button>
              {/* Avatar + nom cliquables → ouvre le panneau Détails (façon Insta) */}
              <button onClick={() => setShowDetails(true)} className="flex items-center gap-3 text-left">
                <UserAvatar username={currentName} pic={currentPic} size={9} />
                <div>
                  <h3 className="font-bold text-sm" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>{currentName}</h3>
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.cyan }}>
                    {isGroup ? `${selectedGroup?.member_ids?.length || 0} membres` : "Chiffré P2P"}
                  </p>
                </div>
              </button>
            </div>
            <div className="flex items-center gap-1">
              {/* Appels audio / vidéo (conversations privées uniquement) */}
              {!isGroup && (
                <>
                  <button title={t("dm.call_audio")}
                    onClick={() => window.dispatchEvent(new CustomEvent("nexus:startcall", { detail: { userId: selectedUserId, username: currentName, profilePic: currentPic, video: false } }))}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:bg-white/5" style={{ color: C.outline }}>
                    <span className="material-symbols-outlined text-xl">call</span>
                  </button>
                  <button title={t("dm.call_video")}
                    onClick={() => window.dispatchEvent(new CustomEvent("nexus:startcall", { detail: { userId: selectedUserId, username: currentName, profilePic: currentPic, video: true } }))}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:bg-white/5" style={{ color: C.outline }}>
                    <span className="material-symbols-outlined text-xl">videocam</span>
                  </button>
                </>
              )}
              {/* Rechercher dans la conversation */}
              <button onClick={() => { setShowConvSearch((v) => { if (v) setConvSearch(""); return !v; }); }} title={t("dm.search_title")}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:bg-white/5"
                style={{ color: showConvSearch ? C.cyan : C.outline }}>
                <Ico name="search" size={20} />
              </button>
              {/* Bouton Détails (i) — PC uniquement. Sur mobile, on ouvre les
                  détails en tapant l'avatar/nom (l'appui long sur la liste gère
                  le reste : épingler, sourdine, non lu, supprimer). */}
              <button onClick={() => setShowDetails((v) => !v)} title={t("dm.details")}
                className="hidden sm:flex w-9 h-9 rounded-full items-center justify-center transition-all hover:bg-white/5"
                style={{ color: showDetails ? C.cyan : C.outline }}>
                <Ico name="info" size={22} />
              </button>
            </div>
          </div>

          {/* Barre de recherche dans la conversation */}
          {showConvSearch && (
            <div className="px-4 py-2 flex items-center gap-2 flex-shrink-0" style={{ background: "rgba(11,19,38,0.6)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="material-symbols-outlined text-base" style={{ color: C.outline }}>search</span>
              <input
                autoFocus
                value={convSearch}
                onChange={(e) => setConvSearch(e.target.value)}
                placeholder={t("dm.search_in_conv")}
                className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-slate-600 select-text"
                style={{ color: C.onSurface, WebkitUserSelect: "text", userSelect: "text" }}
              />
              {convSearchQ && (
                <span className="text-[11px] flex-shrink-0" style={{ color: C.outline }}>{displayedMessages.length}</span>
              )}
              <button onClick={() => { setShowConvSearch(false); setConvSearch(""); }} style={{ color: C.outline }} className="hover:text-white transition-colors flex-shrink-0">
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
          )}

          {/* Bandeau messages éphémères */}
          {!isGroup && ephemeralTtl > 0 && (
            <div className="flex items-center justify-center gap-2 px-4 py-1.5 flex-shrink-0"
              style={{ background: `${C.cyan}12`, color: C.cyan }}>
              <Ico name="timer" size={14} />
              <span className="text-[11px] font-bold">Messages éphémères · {ephemeralLabel(ephemeralTtl)}</span>
            </div>
          )}

          {/* Messages */}
          <div ref={messagesScrollRef}
            onTouchStart={onPullStart} onTouchMove={onPullMove} onTouchEnd={onPullEnd}
            className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col"
            style={{ overscrollBehavior: "contain", overscrollBehaviorX: "none", touchAction: "pan-y" }}>
            {/* Indicateur « tirer pour rafraîchir » (mobile) */}
            {(pullDist > 0 || refreshing) && (
              <div className="flex justify-center items-center overflow-hidden flex-shrink-0"
                style={{ height: refreshing ? 36 : pullDist, transition: pullStartY.current ? "none" : "height 0.2s" }}>
                <div className="w-6 h-6 rounded-full border-2"
                  style={{ borderColor: `${C.cyan}33`, borderTopColor: C.cyan,
                    animation: refreshing ? "spin 0.7s linear infinite" : "none",
                    transform: refreshing ? "none" : `rotate(${pullDist * 4}deg)`, opacity: Math.min(1, pullDist / PULL_THRESHOLD) }} />
              </div>
            )}
            {loading ? (
              <div className="flex justify-center items-center h-full">
                <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: `${C.cyan}33`, borderTopColor: C.cyan }} />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col justify-center items-center h-full gap-3">
                <span className="material-symbols-outlined text-4xl" style={{ color: C.outline, opacity: 0.3 }}>forum</span>
                <p className="text-sm" style={{ color: C.outline }}>{t("dm.send_first")}</p>
              </div>
            ) : (convSearchQ && displayedMessages.length === 0) ? (
              <div className="flex flex-col justify-center items-center h-full gap-3">
                <span className="material-symbols-outlined text-4xl" style={{ color: C.outline, opacity: 0.3 }}>search_off</span>
                <p className="text-sm" style={{ color: C.outline }}>{t("dm.no_messages_found")}</p>
              </div>
            ) : (
              // mt-auto colle les messages EN BAS (peu de messages → collés au bas,
              // pas d'espace vide au-dessus de la saisie ; sinon défilement normal).
              <div className="mt-auto space-y-2">
              {displayedMessages.map((msg, idx) => {
              const isOwn = msg.sender_id === user.id;
              const repliedMsg = msg.reply_to_id ? getReplied(msg.reply_to_id) : null;
              // Séparateur de date : affiché une seule fois, au changement de jour.
              const prev = displayedMessages[idx - 1];
              const showDaySeparator =
                msg.created_at && (!prev || !isSameDay(prev.created_at, msg.created_at));
              return (
                <Fragment key={msg.id}>
                {showDaySeparator && (
                  <div className="flex justify-center py-2 select-none">
                    <span className="text-[10px] font-bold px-3 py-1 rounded-full"
                      style={{ background: C.container, color: C.outline }}>
                      {formatDayLabel(msg.created_at)}
                    </span>
                  </div>
                )}
                <div
                  onMouseEnter={() => setHoveredMessage(msg.id)}
                  onMouseLeave={() => setHoveredMessage(null)}
                  onTouchStart={(e) => onMsgTouchStart(msg, e)}
                  onTouchEnd={() => onMsgTouchEnd(msg)}
                  onTouchMove={(e) => onMsgTouchMove(msg, e)}
                  onDoubleClick={() => likeHeart(msg)}
                  onContextMenu={(e) => { e.preventDefault(); setMsgMenu(msg); }}
                  className={`relative flex ${isOwn ? "justify-end" : "justify-start"} group`}
                  style={{
                    transform: swipe.id === msg.id ? `translateX(${swipe.dx}px)` : "none",
                    transition: swipe.id === msg.id ? "none" : "transform 0.2s",
                  }}
                >
                  {/* Icône « répondre » révélée pendant le swipe */}
                  {swipe.id === msg.id && Math.abs(swipe.dx) > 12 && (
                    <span className={`material-symbols-outlined absolute top-1/2 -translate-y-1/2 ${isOwn ? "right-full mr-1" : "left-full ml-1"}`}
                      style={{ color: C.cyan, opacity: Math.min(1, Math.abs(swipe.dx) / SWIPE_REPLY) }}>reply</span>
                  )}
                  <div className="relative max-w-[78%]">
                    {/* Reply preview (message cité, façon Insta) */}
                    {repliedMsg && (
                      <div className={`mb-1 px-2.5 py-1.5 rounded-xl border-l-2 ${isOwn ? "ml-auto" : ""}`}
                        style={{ background: C.high, borderColor: C.cyan, maxWidth: "100%" }}>
                        <p className="text-[10px] font-bold" style={{ color: C.cyan }}>
                          {repliedMsg.sender_id === user.id ? "Vous" : (repliedMsg.sender_username || "")}
                        </p>
                        <p className="text-[11px] truncate" style={{ color: C.onVariant, maxWidth: 220 }}>
                          {isDataImage(repliedMsg.content) || repliedMsg.media_url
                            ? "📷 Photo"
                            : (repliedMsg.content || "").substring(0, 70)}
                        </p>
                      </div>
                    )}

                    <div className="flex items-end gap-2">
                      {!isOwn && <UserAvatar username={msg.sender_username} pic={msg.sender_profile_pic} size={7} />}

                      {/* Bubble */}
                      <div className="relative">
                        {/* Cœur « pop » au double-tap */}
                        {heartBurst === msg.id && (
                          <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-2xl pointer-events-none z-20"
                            style={{ animation: "ping 0.6s cubic-bezier(0,0,0.2,1)" }}>❤️</span>
                        )}
                        <div
                          className="px-3 py-2 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap"
                          style={isOwn ? {
                            background: "rgba(59,130,246,0.15)",
                            border: "1px solid rgba(59,130,246,0.25)",
                            color: C.onSurface,
                            borderRadius: "18px 18px 4px 18px",
                          } : {
                            background: C.container,
                            border: `1px solid ${C.cyan}18`,
                            color: C.onSurface,
                            borderRadius: "18px 18px 18px 4px",
                          }}
                        >
                          {!isOwn && isGroup && (
                            <p className="text-[10px] font-bold mb-0.5" style={{ color: C.cyan }}>{msg.sender_username}</p>
                          )}
                          {/* Message vocal */}
                          {audioSrcFrom(msg) && <VoiceMessage src={audioSrcFrom(msg)} own={isOwn} />}
                          {/* Vidéo (DM ou groupe) */}
                          {videoSrcFrom(msg) && (
                            <MsgVideo src={cleanImageSrc(videoSrcFrom(msg))} onLoaded={() => scrollToBottom()} />
                          )}
                          {/* Images : média du message, médias de groupe, ou image collée en texte
                              (on exclut le media_url si c'est en fait un audio/vidéo). */}
                          {[
                            (audioSrcFrom(msg) || videoSrcFrom(msg)) ? null : msg.media_url,
                            ...(Array.isArray(msg.media_urls)
                              ? msg.media_urls.filter((u) => !(typeof u === "string" && (u.startsWith("data:audio") || u.startsWith("data:video"))))
                              : []),
                            imageSrcFromContent(msg.content),
                          ].filter(Boolean).map((src, i) => (
                            <MsgImage key={i} src={cleanImageSrc(src)} onOpen={setLightbox} onLoaded={() => scrollToBottom()} />
                          ))}
                          {/* Texte : les liens deviennent cliquables et soulignés. */}
                          {isDataImage(msg.content) ? null : linkify(
                            (msg.content || "").length > 2000 ? (msg.content || "").slice(0, 2000) + "…" : (msg.content || ""),
                            { color: C.cyan, underline: true }
                          )}
                          {/* Traduction (façon Instagram : affichée sous le texte) */}
                          {translations[msg.id] && (
                            <div className="mt-1.5 pt-1.5 text-sm" style={{ borderTop: `1px solid ${C.outlineVar}`, color: C.onSurface }}>
                              <span className="text-[9px] font-bold uppercase tracking-widest block mb-0.5" style={{ color: C.cyan }}>{t("dm.translated")}</span>
                              {translations[msg.id]}
                            </div>
                          )}
                          {/* Aperçu du premier lien (Open Graph). */}
                          {!isDataImage(msg.content) && extractFirstUrl(msg.content) && (
                            <LinkPreview url={extractFirstUrl(msg.content)} accent={C.cyan} />
                          )}
                        </div>

                        {/* Reactions — la réaction de l'utilisateur porte une pastille (anneau cyan) */}
                        {groupReactions(msg.reactions).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {groupReactions(msg.reactions).map(([emoji, count]) => {
                              const mine = myReaction(msg.reactions) === emoji;
                              return (
                                <button key={emoji} onClick={() => handleReaction(msg.id, emoji)}
                                  className="text-xs px-1.5 py-0.5 rounded-full transition-all hover:opacity-80"
                                  style={{ background: mine ? `${C.cyan}22` : C.high, border: `1px solid ${mine ? C.cyan : C.outlineVar}` }}
                                  title={mine ? "Retirer ma réaction" : undefined}>
                                  {emoji} {count}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {/* Hover actions (PC uniquement — sur mobile on utilise l'appui long) */}
                        {hoveredMessage === msg.id && (
                          <div
                            className={`hidden sm:flex absolute ${isOwn ? "right-full mr-2" : "left-full ml-2"} top-0 items-center gap-1 rounded-xl px-1 py-1 shadow-lg`}
                            style={glass}
                          >
                            <button onClick={() => setShowEmojiPicker(showEmojiPicker === msg.id ? null : msg.id)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors text-sm">
                              😊
                            </button>
                            <button onClick={() => setReplyingTo(msg)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors" style={{ color: C.outline }}>
                              <span className="material-symbols-outlined text-sm">reply</span>
                            </button>
                            <button onClick={() => handleCopy(msg.content)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors" style={{ color: C.outline }}>
                              <span className="material-symbols-outlined text-sm">content_copy</span>
                            </button>
                            {isOwn && (
                              <button onClick={() => handleDeleteMessage(msg.id)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/20 hover:text-red-400 transition-colors" style={{ color: C.outline }}>
                                <span className="material-symbols-outlined text-sm">delete</span>
                              </button>
                            )}
                          </div>
                        )}

                        {/* Emoji picker */}
                        {showEmojiPicker === msg.id && (
                          <div className={`absolute ${isOwn ? "right-0" : "left-0"} top-full mt-1 flex gap-1.5 px-3 py-2 rounded-2xl shadow-xl z-20`} style={glass}>
                            {QUICK_EMOJIS.map(e => (
                              <button key={e} onClick={() => handleReaction(msg.id, e)} className="text-lg hover:scale-125 transition-transform">
                                {e}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Status + time */}
                    <div className={`flex items-center gap-1 mt-0.5 ${isOwn ? "justify-end" : "justify-start ml-9"}`}>
                      {msg.expires_at && (
                        <span title={t("dm.ephemeral")} style={{ color: C.cyan }}><Ico name="timer" size={11} /></span>
                      )}
                      <span className="text-[9px]" style={{ color: C.outline }}>
                        {msg.created_at ? new Date(msg.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}
                      </span>
                      {getStatus(msg)}
                    </div>
                    {/* « Vu » sous le dernier message lu (accusé de lecture, façon Insta) */}
                    {!isGroup && msg.id === lastOwnReadId && (
                      <div className="flex justify-end mt-0.5">
                        <span className="text-[9px] font-semibold" style={{ color: C.cyan }}>
                          Vu{msg.read_at ? ` ${new Date(msg.read_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                </Fragment>
              );
            })}
              <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Reply indicator */}
          {replyingTo && (
            <div className="px-4 py-2 flex items-center justify-between" style={{ background: "rgba(2,6,23,0.5)" }}>
              <div className="flex items-center gap-2 text-xs" style={{ color: C.outline }}>
                <span className="material-symbols-outlined text-sm" style={{ color: C.cyan }}>reply</span>
                <span>{t("dm.reply_to")} <strong style={{ color: C.onSurface }}>{replyingTo.content?.substring(0, 40)}…</strong></span>
              </div>
              <button onClick={() => setReplyingTo(null)} style={{ color: C.outline }} className="hover:text-white transition-colors">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          )}

          {/* Input — collé en bas, avec la safe-area iOS pour combler l'espace
              sous la barre (home indicator) et éviter qu'elle « remonte ». */}
          <div className="px-4 pt-3 flex-shrink-0" style={{ background: "rgba(2,6,23,0.5)", paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))", touchAction: "none" }}>
            {/* Aperçu de l'image en attente */}
            {pendingImage && (
              <div className="mb-2 relative inline-block">
                {isVideoDataUrl(pendingImage) ? (
                  <video src={pendingImage} className="h-20 rounded-xl object-cover" muted playsInline />
                ) : (
                  <img src={pendingImage} alt="aperçu" className="h-20 rounded-xl object-cover" />
                )}
                <button
                  type="button"
                  onClick={() => setPendingImage(null)}
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-xs"
                  style={{ background: "#ef4444", color: "#fff" }}
                  title={t("dm.remove")}
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>
            )}
            {/* Aperçu du message vocal en attente */}
            {pendingAudio && (
              <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: C.container }}>
                <span className="material-symbols-outlined text-base" style={{ color: C.cyan }}>graphic_eq</span>
                <audio src={pendingAudio} controls style={{ height: 32, flex: 1 }} />
                <button type="button" onClick={() => setPendingAudio(null)} title={t("dm.remove")} style={{ color: "#f87171" }}>
                  <span className="material-symbols-outlined text-sm">delete</span>
                </button>
              </div>
            )}

            {recording ? (
              /* Barre d'enregistrement vocal (façon Insta : corbeille · mic rouge ·
                 chrono · onde animée · valider) */
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-2xl" style={glass}>
                <button type="button" onClick={cancelRecording} title={t("dm.delete")}
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
                  style={{ color: "#f87171" }}>
                  <span className="material-symbols-outlined text-lg">delete</span>
                </button>
                <span className="material-symbols-outlined text-lg animate-pulse flex-shrink-0" style={{ color: "#ef4444" }}>mic</span>
                <span className="text-sm font-bold tabular-nums flex-shrink-0" style={{ color: C.onSurface, minWidth: 42 }}>{fmtSecs(recordSecs)}</span>
                <div className="flex-1 flex items-center gap-[3px] h-6 overflow-hidden">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <span key={i} className="rounded-full animate-pulse"
                      style={{ width: 3, flexShrink: 0, background: C.cyan, opacity: 0.85,
                        height: `${25 + Math.abs(Math.sin(i * 1.7)) * 70}%`, animationDelay: `${(i % 6) * 110}ms` }} />
                  ))}
                </div>
                <button type="button" onClick={stopRecording} title={t("dm.finish")}
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
                  style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
                  <span className="material-symbols-outlined text-lg">check</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col">
              {!isGroup && scheduledMsgs.length > 0 && (
                <button onClick={() => setManageSched(true)}
                  className="flex items-center gap-1.5 mb-2 px-3 py-1.5 rounded-full text-xs font-bold self-start active:scale-95 transition-transform"
                  style={{ background: "rgba(34,211,238,0.12)", color: C.cyan }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 15 }}>schedule</span>
                  {scheduledMsgs.length} message{scheduledMsgs.length > 1 ? "s" : ""} planifié{scheduledMsgs.length > 1 ? "s" : ""}
                </button>
              )}
              <form onSubmit={handleSendMessage} className="flex items-center gap-2 px-3 py-2 rounded-2xl" style={glass}>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={handlePickMedia}
                />
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={compressing}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-50"
                  style={{ background: C.high, color: C.cyan }}
                  title={t("dm.send_img_video")}
                >
                  <span className="material-symbols-outlined text-sm">{compressing ? "hourglass_top" : "image"}</span>
                </button>
                {!pendingAudio && (
                  <button
                    type="button"
                    onClick={startRecording}
                    className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
                    style={{ background: C.high, color: C.cyan }}
                    title={t("dm.voice_message")}
                  >
                    <span className="material-symbols-outlined text-sm">mic</span>
                  </button>
                )}
                <input
                  value={messageContent}
                  onChange={(e) => setMessageContent(e.target.value)}
                  placeholder={t("dm.send_message")}
                  className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-slate-600 select-text"
                  style={{ color: C.onSurface, WebkitUserSelect: "text", userSelect: "text" }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSendMessage(e); }}
                />
                {/* « + » → menu d'outils (Dessiner). */}
                <div className="relative">
                  <button type="button" onClick={() => setShowPlusMenu((v) => !v)}
                    className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
                    style={{ background: C.high, color: C.cyan }} title={t("dm.more_tools")}>
                    <span className="material-symbols-outlined text-sm" style={{ transform: showPlusMenu ? "rotate(45deg)" : "none", transition: "transform 0.2s" }}>add</span>
                  </button>
                  {showPlusMenu && (
                    <>
                      <div className="fixed inset-0 z-[60]" onClick={() => setShowPlusMenu(false)} />
                      <div className="absolute bottom-11 right-0 z-[61] rounded-2xl overflow-hidden" style={{ background: C.surface, border: `1px solid ${C.high}`, boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
                        <button type="button" onClick={() => { setShowPlusMenu(false); setShowDraw(true); }}
                          className="flex items-center gap-2 px-4 py-3 w-40 text-left active:scale-[0.98]" style={{ color: C.onSurface }}>
                          <span className="material-symbols-outlined text-base" style={{ color: C.cyan }}>brush</span>
                          <span className="text-sm font-semibold">{t("dm.draw")}</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <button type="submit" disabled={!messageContent.trim() && !pendingImage && !pendingAudio}
                  onPointerDown={() => {
                    // Appui long (1 s) → planifier (1:1 uniquement, si contenu).
                    if (isGroup || (!messageContent.trim() && !pendingImage)) return;
                    sendLpFired.current = false;
                    clearTimeout(sendLpTimer.current);
                    sendLpTimer.current = setTimeout(() => { sendLpFired.current = true; setShowScheduleModal(true); }, 1000);
                  }}
                  onPointerUp={() => clearTimeout(sendLpTimer.current)}
                  onPointerLeave={() => clearTimeout(sendLpTimer.current)}
                  title={t("dm.send_long_press")}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
                  style={{ background: (messageContent.trim() || pendingImage || pendingAudio) ? "linear-gradient(135deg,#22d3ee,#3b82f6)" : C.high, color: (messageContent.trim() || pendingImage || pendingAudio) ? C.onPrimary : C.outline }}>
                  <span className="material-symbols-outlined text-sm">send</span>
                </button>
              </form>
              </div>
            )}
          </div>
        </>
      ) : hasSelection ? (
        /* Une conversation EST sélectionnée mais ses infos chargent encore
           (appel /users/{id}). On affiche un spinner discret — JAMAIS le
           placeholder « Sélectionnez une conversation », qui serait faux et
           donnait l'impression d'une app vide/lente à chaque ouverture. */
        <div className="flex-1 flex items-center justify-center">
          <div className="w-7 h-7 rounded-full border-2 animate-spin"
            style={{ borderColor: `${C.cyan}33`, borderTopColor: C.cyan }} />
        </div>
      ) : (
        /* Empty state — vraiment AUCUNE conversation sélectionnée (colonne
           droite sur PC ; sur mobile la liste occupe l'écran). */
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ background: `${C.cyan}12` }}>
            <span className="material-symbols-outlined text-4xl" style={{ color: C.cyan, opacity: 0.6 }}>forum</span>
          </div>
          <div className="text-center">
            <h3 className="font-black text-lg mb-1" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>{t("dm.comm_center")}</h3>
            <p className="text-sm" style={{ color: C.outline }}>{t("dm.select_conv")}</p>
          </div>
          <button onClick={openNewMessage} className="px-5 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 hover:opacity-90"
            style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
            Nouvelle conversation
          </button>
        </div>
      )}
      <DrawCanvasModal open={showDraw} onClose={() => setShowDraw(false)} onSubmit={postDrawing} />
      <ScheduleMessageModal open={showScheduleModal} onClose={() => setShowScheduleModal(false)} onConfirm={scheduleCurrentMessage} />
      <ScheduleMessageModal open={!!rescheduleId} onClose={() => setRescheduleId(null)} onConfirm={rescheduleTo} title={t("dm.new_time")} />
      {manageSched && (
        <div className="fixed inset-0 z-[96] flex items-end sm:items-center justify-center sm:p-4"
          style={{ background: "rgba(2,6,20,0.86)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) setManageSched(false); }}>
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5" style={{ background: "#0d1424", border: "1px solid rgba(255,255,255,0.1)", paddingBottom: "calc(env(safe-area-inset-bottom,0px) + 1rem)", animation: "clipSheetUp 0.28s cubic-bezier(0.22,1,0.36,1)" }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "rgba(255,255,255,0.22)" }} />
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined" style={{ color: C.cyan }}>schedule</span>
              <h3 className="text-white font-black text-lg">{t("dm.scheduled_messages")}</h3>
            </div>
            {scheduledMsgs.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: "#6b7686" }}>{t("dm.no_scheduled")}</p>
            ) : (
              <div className="space-y-2 max-h-[52vh] overflow-y-auto no-scrollbar">
                {scheduledMsgs.map((s) => (
                  <div key={s.id} className="rounded-2xl p-3" style={{ background: "#1a2234" }}>
                    <p className="text-sm text-white truncate flex items-center gap-1">
                      {!s.content && s.media_type && <span className="material-symbols-outlined" style={{ fontSize: 15, color: "#8b96a8" }}>image</span>}
                      <span className="truncate">{s.content || (s.media_type ? "Média joint" : "")}</span>
                    </p>
                    <p className="text-[11px] mb-2" style={{ color: C.cyan }}>{new Date(s.scheduled_at).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                    <div className="flex gap-2">
                      <button onClick={() => sendScheduledNow(s.id)} className="flex-1 py-1.5 rounded-xl text-xs font-bold" style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: "#04121a" }}>{t("dm.send")}</button>
                      <button onClick={() => { setManageSched(false); setRescheduleId(s.id); }} className="flex-1 py-1.5 rounded-xl text-xs font-bold" style={{ background: "#232c40", color: "#c7d0e0" }}>{t("dm.reschedule")}</button>
                      <button onClick={() => deleteScheduled(s.id)} className="flex-1 py-1.5 rounded-xl text-xs font-bold" style={{ background: "#3a1414", color: "#f87171" }}>{t("dm.delete")}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setManageSched(false)} className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold" style={{ background: "#1a2234", color: "#a7b3cc" }}>{t("dm.close")}</button>
          </div>
        </div>
      )}
    </div>
  );

  // ── Details panel (contenu partagé sidebar PC / bottom sheet mobile) ──────────
  const DetailsRow = ({ icon, label, sub, danger, onClick }) => (
    <button onClick={onClick}
      className="w-full flex items-center gap-4 px-5 py-3.5 transition-all hover:bg-white/5 text-left"
      style={{ color: danger ? "#f87171" : C.onSurface }}>
      <span className="flex-shrink-0"><Ico name={icon} size={24} /></span>
      <span className="flex-1 min-w-0">
        <span className="text-[15px] block truncate">{label}</span>
        {sub && <span className="text-xs block truncate" style={{ color: C.outline }}>{sub}</span>}
      </span>
      {!danger && <span className="material-symbols-outlined text-lg flex-shrink-0" style={{ color: C.outline }}>chevron_right</span>}
    </button>
  );

  const QuickAction = ({ icon, label, onClick }) => (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
      <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: C.container, color: C.onSurface }}>
        <Ico name={icon} size={22} />
      </span>
      <span className="text-[11px] text-center truncate w-full" style={{ color: C.onSurface }}>{label}</span>
    </button>
  );

  const DetailsContent = ({ mobile } = {}) => {
    const muteId = isGroup ? selectedGroupId : selectedUserId;
    return (
      <div className="flex flex-col h-full">
        {/* Barre du haut (fermeture) */}
        <div className="px-2 py-2 flex items-center flex-shrink-0">
          <button onClick={() => setShowDetails(false)}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-white/5"
            style={{ color: C.onSurface }}>
            <span className="material-symbols-outlined">{mobile ? "arrow_back" : "close"}</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-6" style={{ scrollbarWidth: "none" }}>
          {/* En-tête : grand avatar + nom + username */}
          <div className="flex flex-col items-center gap-1.5 px-4 pb-5">
            <UserAvatar username={currentName} pic={currentPic} size={22} />
            <p className="text-xl font-black mt-1" style={{ color: C.onSurface, fontFamily: "Space Grotesk, sans-serif" }}>{currentName}</p>
            <p className="text-sm" style={{ color: C.outline }}>
              {isGroup ? `${selectedGroup?.member_ids?.length || 0} membres` : (selectedUser?.username ? `@${selectedUser.username}` : "")}
            </p>
          </div>

          {/* Actions rapides */}
          <div className="flex items-start gap-1 px-4 pb-5">
            {!isGroup && (
              <QuickAction icon="profile" label="Profil"
                onClick={() => { setShowDetails(false); navigate(`/profile/${selectedUserId}`); }} />
            )}
            <QuickAction icon="search" label="Rechercher" onClick={() => toast("Bientôt disponible")} />
            <QuickAction icon={isMuted(muteId) ? "unmute" : "mute"} label={isMuted(muteId) ? "Réactiver" : "Mettre en sourdine"}
              onClick={() => toggleMute(muteId)} />
            <QuickAction icon="options" label="Options" onClick={() => setDetailsMore((v) => !v)} />
          </div>

          {isGroup ? (
            /* ── Gestion de groupe ── */
            <>
              <div style={{ borderTop: `1px solid ${C.outline}14` }}>
                {groupIsAdmin && (
                  editingName ? (
                    <div className="flex items-center gap-2 px-5 py-3">
                      <input value={groupNameDraft} autoFocus onChange={(e) => setGroupNameDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") renameGroup(); }}
                        className="flex-1 px-3 py-2 rounded-xl text-sm border-none outline-none"
                        style={{ background: C.high, color: C.onSurface }} />
                      <button onClick={renameGroup} className="px-3 py-2 rounded-xl text-xs font-bold" style={{ background: C.cyan, color: C.onPrimary }}>OK</button>
                    </div>
                  ) : (
                    <DetailsRow icon="edit" label="Renommer le groupe"
                      onClick={() => { setGroupNameDraft(selectedGroup?.name || ""); setEditingName(true); }} />
                  )
                )}
                <DetailsRow icon="report" label="Quelque chose ne fonctionne pas" onClick={handleReport} />
              </div>

              {/* Membres */}
              <div className="mt-2" style={{ borderTop: `1px solid ${C.outline}14` }}>
                <div className="flex items-center justify-between px-5 pt-3 pb-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: C.outline }}>
                    {groupMembers.length || selectedGroup?.member_ids?.length || 0} membres
                  </p>
                  {groupIsAdmin && (
                    <button onClick={() => setShowAddMember((v) => !v)} className="text-xs font-bold flex items-center gap-1" style={{ color: C.cyan }}>
                      <span className="material-symbols-outlined text-sm">person_add</span> Ajouter
                    </button>
                  )}
                </div>

                {showAddMember && groupIsAdmin && (
                  <div className="px-4 pb-2">
                    <input value={addMemberSearch} autoFocus onChange={(e) => setAddMemberSearch(e.target.value)}
                      placeholder={t("dm.search_person")}
                      className="w-full px-3 py-2 rounded-xl text-sm border-none outline-none placeholder:text-slate-600"
                      style={{ background: C.high, color: C.onSurface }} />
                    {addMemberResults.map((u) => (
                      <button key={u.id} onClick={() => addGroupMember(u)}
                        className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/5 text-left">
                        <UserAvatar username={u.username} pic={u.profile_pic} size={8} />
                        <span className="text-sm" style={{ color: C.onSurface }}>@{u.username}</span>
                        <span className="material-symbols-outlined text-sm ml-auto" style={{ color: C.cyan }}>add</span>
                      </button>
                    ))}
                  </div>
                )}

                {groupMembers.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 px-5 py-2.5">
                    <UserAvatar username={m.username} pic={m.profile_pic} size={9} />
                    <button onClick={() => { setShowDetails(false); navigate(`/profile/${m.id}`); }} className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-bold truncate" style={{ color: C.onSurface }}>
                        @{m.username}{m.id === user.id ? " (vous)" : ""}
                      </p>
                      {(m.is_creator || m.is_admin) && (
                        <p className="text-[10px] font-bold" style={{ color: C.cyan }}>{m.is_creator ? "Créateur" : "Admin"}</p>
                      )}
                    </button>
                    {groupIsAdmin && m.id !== user.id && !m.is_creator && (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => toggleGroupAdmin(m)} title={m.is_admin ? "Retirer les droits admin" : "Promouvoir admin"}
                          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/5"
                          style={{ color: m.is_admin ? C.cyan : C.outline }}>
                          <span className="material-symbols-outlined text-sm">shield_person</span>
                        </button>
                        <button onClick={() => removeGroupMember(m)} title={t("dm.remove_from_group")}
                          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-red-500/10"
                          style={{ color: "#f87171" }}>
                          <span className="material-symbols-outlined text-sm">person_remove</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* ── Liste DM (façon Insta) ── */
            <div style={{ borderTop: `1px solid ${C.outline}14` }}>
              <DetailsRow icon="palette" label="Personnaliser" sub="Thème et police"
                onClick={() => { setShowDetails(false); navigate("/settings"); }} />
              <DetailsRow icon="nickname" label="Pseudos" onClick={() => toast("Bientôt disponible")} />
              <DetailsRow icon="timer" label="Messages éphémères" sub={ephemeralLabel(ephemeralTtl)}
                onClick={() => { setShowDetails(false); setShowEphemeralChooser(true); }} />
              <DetailsRow icon="privacy" label="Confidentialité et sécurité"
                onClick={() => { setShowDetails(false); navigate("/settings"); }} />
              <DetailsRow icon="group" label="Créer une discussion de groupe"
                onClick={() => { setShowDetails(false); openNewMessageModal(); }} />
              <DetailsRow icon="report" label="Quelque chose ne fonctionne pas" onClick={handleReport} />
            </div>
          )}

          {/* Options avancées (révélées par ⋯) */}
          {detailsMore && (
            <div className="mt-2" style={{ borderTop: `1px solid ${C.outline}14` }}>
              {isGroup ? (
                <DetailsRow icon="leave" label="Quitter le groupe" danger onClick={handleLeaveGroup} />
              ) : (
                <>
                  <DetailsRow icon="block" label="Bloquer" danger onClick={handleBlockUser} />
                  <DetailsRow icon="trash" label="Supprimer la discussion" danger onClick={handleClearConversation} />
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Layout user={user} compact hideMobileChrome bottomNav={!hasSelection}>
      {/* Nebula background */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <div className="absolute rounded-full blur-3xl" style={{ width: "40%", height: "40%", top: "-10%", left: "-5%", background: "radial-gradient(circle, rgba(34,211,238,0.04), transparent)" }} />
        <div className="absolute rounded-full blur-3xl" style={{ width: "40%", height: "40%", bottom: "-10%", right: "-5%", background: "radial-gradient(circle, rgba(59,130,246,0.04), transparent)" }} />
      </div>

      {/* Main 2-column layout.
          On appelle les panneaux comme fonctions {ConvPanel()} et non <ConvPanel />
          pour éviter que React ne les remonte à chaque frappe (sinon le champ
          de saisie perd le focus et le clavier se ferme). */}
      {/* Overlay plein écran en position: fixed — indépendant de la hauteur des
          ancêtres et des unités dvh/vh, qui sont peu fiables sur iOS Safari
          (barre d'URL dynamique). top/bottom/left/right ancrent le conteneur au
          viewport, donc la colonne de chat remplit toujours l'écran et la barre
          de saisie reste collée en bas — plus de vide noir.
          bottom-16 sur mobile quand aucune conv n'est ouverte : laisse la place
          au footer (h-16). Sinon bottom-0 (conv ouverte = pas de footer ; PC =
          jamais de footer). */}
      <div
        className="fixed left-0 right-0 lg:left-20 z-10 flex overflow-hidden select-none sm:select-text"
        style={{
          top: "var(--nexus-vtop, 0px)",
          height: "var(--nexus-vh, 100dvh)",
          WebkitTouchCallout: "none",
        }}
      >
        {ConvPanel()}
        {ChatPanel()}
        {/* Détails — sidebar droite sur PC uniquement */}
        {showDetails && hasSelection && (
          <div className="hidden lg:flex flex-col w-80 flex-shrink-0 border-l"
            style={{ borderColor: "rgba(255,255,255,0.05)", background: `${C.surface}cc` }}>
            {DetailsContent()}
          </div>
        )}
      </div>

      {/* Instantanés (photos éphémères façon Instagram) : FAB + reçus + caméra.
          Monté au niveau stable de la page (jamais remonté avec les panneaux).
          Masqué quand une conversation est ouverte sur mobile. */}
      <InstantsEntry user={user} hidden={hasSelection} />

      {/* Nexus AI — overlay de discussion (indépendant du flux WebSocket). */}
      {showAI && <NexusAIChat onClose={() => setShowAI(false)} />}

      {/* ── Menu appui long conversation (mobile) : façon Instagram ── */}
      {convMenu && (
        <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center select-none"
          style={{ background: "rgba(0,0,0,0.55)", WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
          onClick={() => setConvMenu(null)}>
          <div
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden"
            style={{ background: C.surface, border: `1px solid ${C.outlineVar}`, paddingBottom: "env(safe-area-inset-bottom)" }}
            onClick={(e) => e.stopPropagation()}>
            {/* Poignée + nom */}
            <div className="pt-3 pb-2 flex flex-col items-center gap-2">
              <div className="w-10 h-1 rounded-full" style={{ background: C.outlineVar }} />
              <p className="text-sm font-bold truncate max-w-[80%]" style={{ color: C.onSurface }}>{convMenu.name}</p>
            </div>
            <div className="py-1">
              <button onClick={handleMarkUnread}
                className="w-full flex items-center gap-4 px-6 py-3.5 transition-all hover:bg-white/5 text-left" style={{ color: C.onSurface }}>
                <span className="material-symbols-outlined" style={{ color: C.cyan }}>mark_chat_unread</span>
                <span className="text-[15px]">{t("dm.mark_unread")}</span>
              </button>
              <button onClick={handleTogglePin}
                className="w-full flex items-center gap-4 px-6 py-3.5 transition-all hover:bg-white/5 text-left" style={{ color: C.onSurface }}>
                <span className="material-symbols-outlined" style={{ color: C.cyan }}>keep</span>
                <span className="text-[15px]">{convMenu.pinned ? "Désépingler" : "Épingler"}</span>
              </button>
              <button onClick={handleToggleMutePref}
                className="w-full flex items-center gap-4 px-6 py-3.5 transition-all hover:bg-white/5 text-left" style={{ color: C.onSurface }}>
                <span className="material-symbols-outlined" style={{ color: C.cyan }}>{convMenu.muted ? "notifications_active" : "notifications_off"}</span>
                <span className="text-[15px]">{convMenu.muted ? "Réactiver les notifications" : "Mettre en sourdine"}</span>
              </button>
              <button onClick={handleDeleteFromMenu}
                className="w-full flex items-center gap-4 px-6 py-3.5 transition-all hover:bg-red-500/10 text-left" style={{ color: "#f87171" }}>
                <span className="material-symbols-outlined">{convMenu.kind === "group" ? "logout" : "delete"}</span>
                <span className="text-[15px]">{convMenu.kind === "group" ? "Quitter le groupe" : "Supprimer"}</span>
              </button>
            </div>
            <button onClick={() => setConvMenu(null)}
              className="w-full py-4 text-[15px] font-bold border-t" style={{ borderColor: C.outlineVar, color: C.outline }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ── Menu appui long MESSAGE (mobile) : réagir / répondre / copier / supprimer ── */}
      {msgMenu && (
        <div className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center select-none"
          style={{ background: "rgba(0,0,0,0.55)", WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
          onClick={() => setMsgMenu(null)}>
          <div
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden"
            style={{ background: C.surface, border: `1px solid ${C.outlineVar}`, paddingBottom: "env(safe-area-inset-bottom)" }}
            onClick={(e) => e.stopPropagation()}>
            {/* Rangée d'emojis rapides (réactions) — pastille sur celle déjà mise */}
            <div className="pt-3 pb-2 flex flex-col items-center gap-3">
              <div className="w-10 h-1 rounded-full" style={{ background: C.outlineVar }} />
              <div className="flex gap-2 px-4">
                {QUICK_EMOJIS.map((e) => {
                  const mine = myReaction(msgMenu.reactions) === e;
                  return (
                    <button key={e}
                      onClick={() => { handleReaction(msgMenu.id, e); setMsgMenu(null); }}
                      className="w-11 h-11 rounded-full flex items-center justify-center text-2xl transition-transform active:scale-90 hover:scale-110"
                      style={{ background: mine ? `${C.cyan}22` : C.container, border: mine ? `2px solid ${C.cyan}` : "2px solid transparent" }}>
                      {e}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="py-1 border-t" style={{ borderColor: C.outlineVar }}>
              <button onClick={() => { setReplyingTo(msgMenu); setMsgMenu(null); }}
                className="w-full flex items-center gap-4 px-6 py-3.5 transition-all hover:bg-white/5 text-left" style={{ color: C.onSurface }}>
                <span className="material-symbols-outlined" style={{ color: C.cyan }}>reply</span>
                <span className="text-[15px]">{t("dm.reply")}</span>
              </button>
              <button onClick={() => { const m = msgMenu; setMsgMenu(null); setForwardMsg(m); }}
                className="w-full flex items-center gap-4 px-6 py-3.5 transition-all hover:bg-white/5 text-left" style={{ color: C.onSurface }}>
                <span className="material-symbols-outlined" style={{ color: C.cyan }}>forward</span>
                <span className="text-[15px]">{t("dm.forward")}</span>
              </button>
              {!isDataImage(msgMenu.content) && (msgMenu.content || "").trim() && (
                <>
                  <button onClick={() => { const m = msgMenu; setMsgMenu(null); translateMessage(m); }}
                    className="w-full flex items-center gap-4 px-6 py-3.5 transition-all hover:bg-white/5 text-left" style={{ color: C.onSurface }}>
                    <span className="material-symbols-outlined" style={{ color: C.cyan }}>translate</span>
                    <span className="text-[15px]">{translations[msgMenu.id] ? "Afficher l'original" : "Traduire"}</span>
                  </button>
                  <button onClick={() => { handleCopy(msgMenu.content); setMsgMenu(null); }}
                    className="w-full flex items-center gap-4 px-6 py-3.5 transition-all hover:bg-white/5 text-left" style={{ color: C.onSurface }}>
                    <span className="material-symbols-outlined" style={{ color: C.cyan }}>content_copy</span>
                    <span className="text-[15px]">{t("dm.copy")}</span>
                  </button>
                </>
              )}
              {/* Supprimer pour vous : disponible sur tout message (masque chez moi
                  seulement, sans notifier l'autre). */}
              <button onClick={() => { handleDeleteMessage(msgMenu.id, false); setMsgMenu(null); }}
                className="w-full flex items-center gap-4 px-6 py-3.5 transition-all hover:bg-white/5 text-left" style={{ color: C.onSurface }}>
                <span className="material-symbols-outlined" style={{ color: C.outline }}>visibility_off</span>
                <span className="text-[15px]">{t("dm.delete_for_you")}</span>
              </button>
              {/* Supprimer pour tout le monde : seulement mes propres messages. */}
              {msgMenu.sender_id === user.id && (
                <button onClick={() => { handleDeleteMessage(msgMenu.id, true); setMsgMenu(null); }}
                  className="w-full flex items-center gap-4 px-6 py-3.5 transition-all hover:bg-red-500/10 text-left" style={{ color: "#f87171" }}>
                  <span className="material-symbols-outlined">delete</span>
                  <span className="text-[15px]">{t("dm.delete_for_all")}</span>
                </button>
              )}
            </div>
            <button onClick={() => setMsgMenu(null)}
              className="w-full py-4 text-[15px] font-bold border-t" style={{ borderColor: C.outlineVar, color: C.outline }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ── Transférer un message : choix de la conversation cible ── */}
      {forwardMsg && (
        <div className="fixed inset-0 z-[76] flex items-end sm:items-center justify-center"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={() => setForwardMsg(null)}>
          <div
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
            style={{ background: C.surface, border: `1px solid ${C.outlineVar}`, maxHeight: "70vh", paddingBottom: "env(safe-area-inset-bottom)" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="pt-3 pb-2 flex flex-col items-center gap-2 flex-shrink-0">
              <div className="w-10 h-1 rounded-full" style={{ background: C.outlineVar }} />
              <p className="text-sm font-bold" style={{ color: C.onSurface }}>{t("dm.forward_to")}</p>
            </div>
            <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: "none" }}>
              {chatItems.length === 0 ? (
                <p className="text-center text-xs py-6" style={{ color: C.outline }}>{t("dm.no_conversations")}</p>
              ) : chatItems.map((item) => {
                const g = item.kind === "group";
                const name = g ? item.data.name : item.data.username;
                const pic = g ? item.data.avatar_url : item.data.profile_pic;
                const id = g ? item.data.id : item.data.user_id;
                return (
                  <button key={item.key} onClick={() => forwardTo({ kind: item.kind, id })}
                    className="w-full flex items-center gap-3 px-5 py-3 transition-all hover:bg-white/5 text-left">
                    {g ? (
                      pic ? <img src={pic} alt={name} className="w-9 h-9 rounded-xl object-cover" />
                        : <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm" style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)", color: "#fff" }}>{name?.[0]?.toUpperCase()}</div>
                    ) : <UserAvatar username={name} pic={pic} size={9} />}
                    <span className="text-sm font-semibold truncate" style={{ color: C.onSurface }}>{name}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setForwardMsg(null)}
              className="w-full py-4 text-[15px] font-bold border-t flex-shrink-0" style={{ borderColor: C.outlineVar, color: C.outline }}>
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* ── Lightbox (image agrandie) ── */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.9)" }}
          onClick={() => setLightbox(null)}
        >
          <button
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: "rgba(255,255,255,0.1)", color: "#fff" }}
            aria-label={t("dm.close")}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
          <img
            src={lightbox}
            alt="image"
            className="max-w-full max-h-full rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* ── Note Composer (statut éphémère façon Insta) ── */}
      {showNoteComposer && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
          onClick={() => setShowNoteComposer(false)}>
          <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-6"
            style={{ background: C.low, border: `1px solid ${C.outlineVar}` }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-black text-lg" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>{t("dm.your_note")}</h3>
              <button onClick={() => setShowNoteComposer(false)} style={{ color: C.outline }} className="hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            {/* Aperçu bulle */}
            <div className="flex justify-center mb-5">
              <div className="relative flex items-end justify-center" style={{ paddingTop: 22 }}>
                <div className="absolute top-0 px-3 py-1 rounded-full text-[11px] text-center max-w-[160px] truncate"
                  style={{ background: C.container, color: C.onSurface, border: `1px solid ${C.cyan}22` }}>
                  {noteText.trim() || "Partagez une pensée…"}
                </div>
                <UserAvatar username={user?.username} pic={user?.profile_pic} size={14} />
              </div>
            </div>

            <div className="relative">
              <input
                autoFocus
                value={noteText}
                maxLength={NOTE_MAX}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveNote(); }}
                placeholder={t("dm.share_note")}
                className="w-full px-4 py-3 rounded-xl text-sm border-none outline-none placeholder:text-slate-500"
                style={{ background: C.high, color: C.onSurface }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: C.outline }}>
                {noteText.length}/{NOTE_MAX}
              </span>
            </div>
            <p className="text-[10px] mt-2" style={{ color: C.outline }}>{t("dm.note_expires")}</p>

            <div className="flex gap-2 mt-5">
              {myNote && (
                <button onClick={deleteMyNote}
                  className="px-4 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95"
                  style={{ background: "transparent", color: "#f87171", border: "1px solid #f8717155" }}>
                  Supprimer
                </button>
              )}
              <button onClick={saveNote} disabled={!noteText.trim()}
                className="flex-1 py-2.5 rounded-xl font-black text-sm transition-all active:scale-95 disabled:opacity-40 hover:opacity-90"
                style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
                Partager
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Détails : bottom sheet sur mobile ── */}
      {showDetails && hasSelection && (
        <div className="lg:hidden fixed inset-0 z-[85] flex items-end" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => setShowDetails(false)}>
          <div className="w-full rounded-t-3xl overflow-hidden" style={{ background: C.surface, maxHeight: "88vh", height: "88vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center pt-2"><div className="w-10 h-1 rounded-full" style={{ background: C.outlineVar }} /></div>
            {DetailsContent({ mobile: true })}
          </div>
        </div>
      )}

      {/* ── Choix de la durée des messages éphémères ── */}
      {showEphemeralChooser && (
        <div className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
          onClick={() => setShowEphemeralChooser(false)}>
          <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5"
            style={{ background: C.low, border: `1px solid ${C.outlineVar}` }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-1 px-1">
              <span style={{ color: C.cyan }}><Ico name="timer" size={22} /></span>
              <h3 className="font-black text-lg" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>{t("dm.ephemeral_messages")}</h3>
            </div>
            <p className="text-xs px-1 mb-4" style={{ color: C.outline }}>
              Les nouveaux messages disparaissent automatiquement après la durée choisie, des deux côtés.
            </p>
            {EPHEMERAL_OPTIONS.map((o) => {
              const active = Number(ephemeralTtl) === o.ttl;
              return (
                <button key={o.ttl} onClick={() => setEphemeral(o.ttl)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all hover:bg-white/5 text-left"
                  style={{ color: C.onSurface }}>
                  <span className="text-sm font-medium">{o.label}</span>
                  {active && <span className="w-5 h-5 rounded-full flex items-center justify-center"
                    style={{ background: C.cyan, color: C.onPrimary }}><span className="material-symbols-outlined text-sm">check</span></span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Nouveau message (recherche + multi-sélection) ── */}
      {showNewMessageModal && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
          onClick={() => setShowNewMessageModal(false)}>
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
            style={{ background: C.low, border: `1px solid ${C.outlineVar}`, maxHeight: "80vh" }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: `1px solid ${C.outline}18` }}>
              <button onClick={() => setShowNewMessageModal(false)} style={{ color: C.outline }} className="hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
              <h3 className="font-black text-base" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>{t("dm.new_message")}</h3>
              <span className="w-6" />
            </div>

            {/* Recherche */}
            <div className="px-4 py-3 flex-shrink-0">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: C.outline }}>search</span>
                <input autoFocus value={nmSearch} onChange={(e) => setNmSearch(e.target.value)}
                  placeholder={t("dm.search")}
                  className="w-full text-sm pl-9 pr-4 py-2.5 rounded-xl border-none outline-none placeholder:text-slate-600"
                  style={{ background: C.high, color: C.onSurface }} />
              </div>
            </div>

            {/* Sélectionnés */}
            {nmSelected.length > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-2 flex-shrink-0">
                {nmSelected.map((m) => (
                  <div key={m.id} className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
                    style={{ background: `${C.cyan}18`, color: C.cyan, border: `1px solid ${C.cyan}30` }}>
                    @{m.username}
                    <button onClick={() => toggleNmSelect(m)} className="hover:text-red-400 transition-colors">
                      <span className="material-symbols-outlined text-xs">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Résultats */}
            <div className="flex-1 overflow-y-auto px-2" style={{ scrollbarWidth: "none" }}>
              {nmResults.length === 0 ? (
                <p className="text-center py-8 text-xs" style={{ color: C.outline }}>
                  {nmSearch.trim() ? "Aucun utilisateur" : "Recherchez des personnes à contacter"}
                </p>
              ) : nmResults.map((u) => {
                const checked = Boolean(nmSelected.find((x) => x.id === u.id));
                return (
                  <button key={u.id} onClick={() => toggleNmSelect(u)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-white/5 text-left">
                    <UserAvatar username={u.username} pic={u.profile_pic} size={10} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: C.onSurface }}>@{u.username}</p>
                      {u.bio && <p className="text-xs truncate" style={{ color: C.outline }}>{u.bio}</p>}
                    </div>
                    <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                      style={checked
                        ? { background: C.cyan, color: C.onPrimary }
                        : { border: `2px solid ${C.outlineVar}` }}>
                      {checked && <span className="material-symbols-outlined text-sm">check</span>}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Discuter */}
            <div className="p-4 flex-shrink-0">
              <button onClick={startConversation} disabled={nmSelected.length === 0 || loading}
                className="w-full py-3 rounded-xl font-black text-sm transition-all active:scale-95 disabled:opacity-40 hover:opacity-90"
                style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
                {loading ? "..." : nmSelected.length >= 2 ? `Créer le groupe (${nmSelected.length})` : "Discuter"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── New Group Modal ── */}
      {showNewGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}>
          <div className="w-full max-w-md rounded-3xl p-6" style={{ background: C.low, border: `1px solid ${C.outlineVar}` }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-black text-lg" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>{t("dm.new_group")}</h3>
              <button onClick={() => setShowNewGroup(false)} style={{ color: C.outline }} className="hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder={t("dm.group_name")}
              className="w-full mb-4 px-4 py-2.5 rounded-xl text-sm border-none outline-none placeholder:text-slate-500"
              style={{ background: C.high, color: C.onSurface }} />
            <input value={groupSearch} onChange={e => setGroupSearch(e.target.value)} placeholder={t("dm.search_members")}
              className="w-full mb-3 px-4 py-2.5 rounded-xl text-sm border-none outline-none placeholder:text-slate-500"
              style={{ background: C.high, color: C.onSurface }} />
            {groupSearchRes.length > 0 && (
              <div className="mb-3 rounded-xl overflow-hidden" style={{ border: `1px solid ${C.outlineVar}` }}>
                {groupSearchRes.map(u => (
                  <button key={u.id} onClick={() => { if (!selectedMembers.find(m => m.id === u.id)) setSelectedMembers(p => [...p, u]); setGroupSearch(""); setGroupSearchRes([]); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left">
                    <UserAvatar username={u.username} pic={u.profile_pic} size={8} />
                    <span className="text-sm font-medium" style={{ color: C.onSurface }}>@{u.username}</span>
                  </button>
                ))}
              </div>
            )}
            {selectedMembers.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {selectedMembers.map(m => (
                  <div key={m.id} className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
                    style={{ background: `${C.cyan}18`, color: C.cyan, border: `1px solid ${C.cyan}30` }}>
                    @{m.username}
                    <button onClick={() => setSelectedMembers(p => p.filter(x => x.id !== m.id))} className="hover:text-red-400 transition-colors">
                      <span className="material-symbols-outlined text-xs">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button onClick={handleCreateGroup} disabled={loading || !groupName.trim() || selectedMembers.length === 0}
              className="w-full py-3 rounded-xl font-black text-sm transition-all active:scale-95 disabled:opacity-40 hover:opacity-90"
              style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
              {loading ? "Création..." : "Créer le groupe"}
            </button>
          </div>
        </div>
      )}
    </Layout>
  );
}
