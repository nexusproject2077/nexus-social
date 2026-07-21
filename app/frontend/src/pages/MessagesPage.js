import { useState, useEffect, useLayoutEffect, useRef, useMemo, Fragment } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { toast } from "sonner";
import { Check, CheckCheck } from "lucide-react";
import { compressImage, dataUrlBytes } from "@/lib/compressImage";

const C = {
  bg:         "#020617",
  surface:    "#0b1326",
  low:        "#131b2e",
  container:  "#171f33",
  high:       "#222a3d",
  bright:     "#31394d",
  cyan:       (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee",
  onPrimary:  "#00363e",
  outline:    "#859397",
  outlineVar: "#3c494c",
  onSurface:  "#dae2fd",
  onVariant:  "#bbc9cd",
};

const glass = { background: "rgba(19,27,46,0.55)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "1px solid rgba(34,211,238,0.08)" };

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

// True si le message est un vocal (media_type audio, ou data URL audio).
const audioSrcFrom = (msg) => {
  if (!msg) return null;
  if (msg.media_type === "audio" && msg.media_url) return msg.media_url;
  if (typeof msg.media_url === "string" && msg.media_url.startsWith("data:audio")) return msg.media_url;
  return null;
};

// Lecteur de message vocal (contrôles natifs, compact).
function VoiceMessage({ src, own }) {
  return (
    <div className="flex items-center gap-2 mb-1" style={{ minWidth: 180 }}>
      <span className="material-symbols-outlined text-base" style={{ color: own ? "#93c5fd" : "#22d3ee" }}>graphic_eq</span>
      <audio src={src} controls preload="metadata" style={{ height: 34, maxWidth: 220 }} />
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
  const params = useParams();
  const navigate = useNavigate();

  const selectedUserId  = params.userId;
  const selectedGroupId = params.groupId;
  const isGroup = Boolean(selectedGroupId);

  const [conversations,   setConversations]   = useState([]);
  const [groups,          setGroups]           = useState([]);
  const [messages,        setMessages]         = useState([]);
  const [messageContent,  setMessageContent]   = useState("");
  const [selectedUser,    setSelectedUser]     = useState(null);
  const [selectedGroup,   setSelectedGroup]    = useState(null);
  const [replyingTo,      setReplyingTo]       = useState(null);
  const [hoveredMessage,  setHoveredMessage]   = useState(null);
  const [showEmojiPicker, setShowEmojiPicker]  = useState(null);
  const [loading,         setLoading]          = useState(false);
  const [lightbox,        setLightbox]         = useState(null); // src de l'image agrandie

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
    if (force || nearBottom) c.scrollTop = c.scrollHeight;
  };
  const longPressTimer = useRef(null);

  // Image en attente d'envoi (data URL compressée) + sélecteur de fichier.
  const [pendingImage, setPendingImage] = useState(null);
  const [compressing, setCompressing] = useState(false);
  const imageInputRef = useRef(null);

  // Message vocal : enregistrement micro (MediaRecorder) → data URL.
  const [recording, setRecording]     = useState(false);
  const [pendingAudio, setPendingAudio] = useState(null);
  const [recordSecs, setRecordSecs]   = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const MAX_RECORD_SECS = 120;

  const handlePickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de re-sélectionner le même fichier
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Sélectionnez une image"); return; }
    try {
      setCompressing(true);
      const dataUrl = await compressImage(file);
      setPendingImage(dataUrl);
      const kb = Math.max(1, Math.round(dataUrlBytes(dataUrl) / 1024));
      toast.success(`Image prête (~${kb} Ko)`);
    } catch {
      toast.error("Impossible de traiter cette image");
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
        if (blob.size > 4_000_000) { toast.error("Message vocal trop long"); return; }
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
    } catch { toast.error("Micro indisponible — autorisez l'accès au micro"); }
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

  // ── Fetch on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetchConversations();
    fetchGroups();
    fetchNotes();
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      fetchMessages(selectedUserId);
      markAsRead(selectedUserId);
    } else if (selectedGroupId) {
      fetchGroupMessages(selectedGroupId);
    }
  }, [selectedUserId, selectedGroupId]);

  // Toujours afficher les DERNIERS messages (bas de la conversation). useLayoutEffect
  // positionne AVANT le paint (pas de flash sur les premiers messages) ; les passages
  // différés rattrapent la hauteur une fois les images rendues.
  useLayoutEffect(() => {
    scrollToBottom(true);
    requestAnimationFrame(() => scrollToBottom(true));
    const t1 = setTimeout(() => scrollToBottom(true), 150);
    const t2 = setTimeout(() => scrollToBottom(true), 500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [messages, selectedUserId, selectedGroupId]);

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
      setConversations(res.data || []);
    } catch { console.error("Erreur conversations"); }
  };

  const fetchGroups = async () => {
    try {
      // Using the alias endpoint to avoid route conflict with /{user_id}
      const res = await axios.get(`${API}/messages/groups-list`);
      setGroups(res.data.groups || []);
    } catch { setGroups([]); }
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
      toast.success("Note publiée");
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
      toast.success("Note supprimée");
    } catch { toast.error("Erreur"); }
  };

  const fetchMessages = async (uid) => {
    try {
      setLoading(true);
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
    } catch { toast.error("Erreur lors du chargement des messages"); }
    finally { setLoading(false); }
  };

  const setEphemeral = async (ttl) => {
    if (!selectedUserId) return;
    try {
      await axios.put(`${API}/messages/conversations/${selectedUserId}/ephemeral`, { ttl_seconds: ttl });
      setEphemeralTtl(ttl);
      setShowEphemeralChooser(false);
      toast.success(ttl ? `Messages éphémères : ${ephemeralLabel(ttl)}` : "Messages éphémères désactivés");
    } catch { toast.error("Erreur"); }
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
    const text = messageContent.trim();
    if (!text && !pendingImage && !pendingAudio) return;
    try {
      if (isGroup && selectedGroupId) {
        if (pendingImage || pendingAudio) { toast.error("Médias non disponibles dans les groupes"); return; }
        const res = await axios.post(`${API}/messages/groups/${selectedGroupId}/messages`, {
          content: text, reply_to_id: replyingTo?.id
        });
        if (res.data?.message) setMessages(p => [...p, res.data.message]);
      } else if (selectedUserId) {
        const res = await axios.post(`${API}/messages`, {
          recipient_id: selectedUserId,
          content: text,
          media_url: pendingAudio || pendingImage || null,
          media_type: pendingAudio ? "audio" : (pendingImage ? "image" : null),
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

  // Le backend renvoie reactions sous forme de LISTE [{user_id, emoji}] ;
  // on regroupe par emoji pour l'affichage.
  const groupReactions = (reactions) => {
    const counts = {};
    (Array.isArray(reactions) ? reactions : []).forEach((r) => {
      if (r && r.emoji) counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    });
    return Object.entries(counts);
  };

  const handleReaction = async (messageId, emoji) => {
    try {
      const res = await axios.post(`${API}/messages/${messageId}/react`, { emoji });
      setMessages(p => p.map(m => m.id === messageId ? { ...m, reactions: res.data.reactions } : m));
      setShowEmojiPicker(null);
    } catch { toast.error("Erreur réaction"); }
  };

  const handleDeleteMessage = async (messageId) => {
    try {
      // Le bouton n'apparaît que sur ses propres messages → suppression pour
      // tout le monde (l'autre personne ne les voit plus non plus).
      await axios.delete(`${API}/messages/${messageId}`, { data: { delete_for: "everyone" } });
      setMessages(p => p.filter(m => m.id !== messageId));
      fetchConversations();
      toast.success("Message supprimé pour tout le monde");
    } catch { toast.error("Erreur suppression"); }
  };

  const handleCopy = (content) => {
    navigator.clipboard.writeText(content);
    toast.success("Copié !");
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedMembers.length === 0) {
      toast.error("Nom et membres requis"); return;
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
        toast.success("Groupe créé !");
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
      toast.success("Groupe renommé");
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
    if (!window.confirm("Quitter ce groupe ?")) return;
    const gid = selectedGroupId;
    try {
      await axios.delete(`${API}/messages/groups/${gid}/members/${user.id}`);
      // Retire immédiatement le groupe de la liste (plus d'attente / de cache).
      setGroups((prev) => prev.filter((g) => g.id !== gid));
      toast.success("Vous avez quitté le groupe");
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
    if (nmSelected.length === 0) { toast.error("Sélectionnez au moins une personne"); return; }
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
        toast.success("Groupe créé !");
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur création groupe");
    } finally { setLoading(false); }
  };

  // ── Actions « Détails » ──────────────────────────────────────────────────────
  const handleClearConversation = async () => {
    if (!selectedUserId) return;
    if (!window.confirm("Supprimer cette discussion ? Elle disparaîtra de votre boîte.")) return;
    try {
      await axios.delete(`${API}/messages/conversations/${selectedUserId}`);
      setConversations((prev) => prev.filter((c) => c.user_id !== selectedUserId));
      setShowDetails(false);
      navigate("/messages");
      toast.success("Discussion supprimée");
    } catch { toast.error("Erreur"); }
  };
  const handleBlockUser = async () => {
    if (!selectedUserId) return;
    if (!window.confirm(`Bloquer @${selectedUser?.username} ?`)) return;
    try {
      await axios.post(`${API}/privacy/block`, { user_id: selectedUserId });
      setShowDetails(false);
      navigate("/messages");
      toast.success(`@${selectedUser?.username} bloqué`);
    } catch { toast.error("Erreur"); }
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
      toast.success("Signalement envoyé");
    } catch { toast.error("Erreur"); }
  };

  const getStatus = (msg) => {
    if (msg.sender_id !== user.id) return null;
    if (msg.status === "read") return <CheckCheck className="w-3 h-3" style={{ color: C.cyan }} />;
    if (msg.status === "delivered") return <CheckCheck className="w-3 h-3" style={{ color: C.outline }} />;
    return <Check className="w-3 h-3" style={{ color: C.outline }} />;
  };

  const getReplied = (id) => messages.find(m => m.id === id);

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
    return [...dms, ...grps].sort(
      (a, b) => new Date(b.time || 0) - new Date(a.time || 0)
    );
  }, [conversations, groups]);

  // ── Render helpers ──────────────────────────────────────────────────────────
  const ConvItem = ({ conv }) => {
    const active = selectedUserId === conv.user_id;
    const unread = conv.unread_count > 0;
    return (
      <button
        key={conv.user_id}
        onClick={() => navigate(`/messages/${conv.user_id}`)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all"
        style={{
          // Nouvelle conversation non lue → surlignage bleu ; sinon état actif/normal.
          background: active
            ? `linear-gradient(to right, ${C.cyan}10, transparent)`
            : unread ? "rgba(59,130,246,0.10)" : "transparent",
          borderLeft: active ? `2px solid ${C.cyan}` : unread ? "2px solid #3b82f6" : "2px solid transparent",
        }}
      >
        <div className="relative">
          <UserAvatar username={conv.username} pic={conv.profile_pic} size={10} />
          {unread && <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full" style={{ background: "#3b82f6", border: `2px solid ${C.surface}` }} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm truncate" style={{ color: active ? C.cyan : C.onSurface, fontWeight: unread ? 800 : 700 }}>{conv.username}</p>
            {unread && (
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: "#3b82f6", color: "#fff" }}>{conv.unread_count}</span>
            )}
          </div>
          <p className="text-xs truncate" style={{ color: unread ? C.onVariant : C.outline, fontWeight: unread ? 600 : 400 }}>{conv.last_message}</p>
        </div>
      </button>
    );
  };

  const GroupItem = ({ group }) => {
    const active = selectedGroupId === group.id;
    return (
      <button
        onClick={() => navigate(`/messages/group/${group.id}`)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all"
        style={{
          background: active ? `linear-gradient(to right, rgba(139,92,246,0.1), transparent)` : "transparent",
          borderLeft: active ? "2px solid #8b5cf6" : "2px solid transparent",
        }}
      >
        {group.avatar_url ? (
          <img src={group.avatar_url} alt={group.name} className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#8b5cf6,#ec4899)", color: "#fff" }}>
            {group.name?.[0]?.toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold truncate" style={{ color: active ? "#a78bfa" : C.onSurface }}>{group.name}</p>
          <p className="text-xs truncate" style={{ color: C.outline }}>
            {group.last_message || `${group.member_ids?.length || 0} membres`}
          </p>
        </div>
      </button>
    );
  };

  // ── Conversation list panel ──────────────────────────────────────────────────
  const ConvPanel = () => (
    <div
      className={`flex flex-col border-r h-full w-full sm:w-[300px] sm:min-w-[280px] sm:max-w-[320px] ${hasSelection ? "hidden sm:flex" : "flex"}`}
      style={{ borderColor: "rgba(255,255,255,0.05)", background: `${C.surface}cc` }}
    >
      {/* Header — pas de trait de séparation, même fond que la liste.
          Plus de bouton retour : le footer mobile gère la navigation. */}
      <div className="px-5 pt-5 pb-3 flex items-center gap-2">
        {/* Nom d'utilisateur : centré sur mobile, aligné à gauche sur PC */}
        <h2 className="font-black text-xl tracking-tight flex-1 text-center sm:text-left truncate"
          style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>
          {user?.username || "Messages"}
        </h2>
        {/* Un seul bouton « Nouveau message » (façon Insta : DM ou groupe). */}
        <button onClick={openNewMessageModal} title="Nouveau message"
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:opacity-80"
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
            placeholder="Rechercher ou démarrer une conversation..."
            className="w-full text-sm pl-9 pr-4 py-2 rounded-xl border-none outline-none placeholder:text-slate-600"
            style={{ background: C.high, color: C.onSurface }}
          />
        </div>
      </div>

      {/* Search results */}
      {showNewMsg && searchResults.length > 0 && (
        <div className="px-4 pb-3 space-y-1">
          <p className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: C.outline }}>Utilisateurs</p>
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
            <button onClick={openNoteComposer} className="flex flex-col items-center gap-1.5 flex-shrink-0" style={{ width: 88 }} title="Votre note">
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
              <span className="text-[11px] font-semibold text-center truncate" style={{ width: 82, color: C.onSurface }}>Votre note</span>
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
      <div className="flex-1 min-h-0 overflow-y-auto pb-20 lg:pb-0" style={{ scrollbarWidth: "none", overscrollBehavior: "contain" }}>
        {chatItems.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <span className="material-symbols-outlined text-3xl block mb-2" style={{ color: C.outline, opacity: 0.4 }}>forum</span>
            <p className="text-xs" style={{ color: C.outline }}>Aucune conversation</p>
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
          <div className="h-14 px-5 flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(11,19,38,0.6)" }}>
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
                  <button title="Appel audio"
                    onClick={() => window.dispatchEvent(new CustomEvent("nexus:startcall", { detail: { userId: selectedUserId, username: currentName, profilePic: currentPic, video: false } }))}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:bg-white/5" style={{ color: C.outline }}>
                    <span className="material-symbols-outlined text-xl">call</span>
                  </button>
                  <button title="Appel vidéo"
                    onClick={() => window.dispatchEvent(new CustomEvent("nexus:startcall", { detail: { userId: selectedUserId, username: currentName, profilePic: currentPic, video: true } }))}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:bg-white/5" style={{ color: C.outline }}>
                    <span className="material-symbols-outlined text-xl">videocam</span>
                  </button>
                </>
              )}
              {/* Bouton Détails (i) — ouvre la sidebar (PC) / bottom sheet (mobile) */}
              <button onClick={() => setShowDetails((v) => !v)} title="Détails"
                className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:bg-white/5"
                style={{ color: showDetails ? C.cyan : C.outline }}>
                <Ico name="info" size={22} />
              </button>
            </div>
          </div>

          {/* Bandeau messages éphémères */}
          {!isGroup && ephemeralTtl > 0 && (
            <div className="flex items-center justify-center gap-2 px-4 py-1.5 flex-shrink-0"
              style={{ background: `${C.cyan}12`, color: C.cyan }}>
              <Ico name="timer" size={14} />
              <span className="text-[11px] font-bold">Messages éphémères · {ephemeralLabel(ephemeralTtl)}</span>
            </div>
          )}

          {/* Messages */}
          <div ref={messagesScrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col" style={{ scrollbarWidth: "none", overscrollBehavior: "contain" }}>
            {loading ? (
              <div className="flex justify-center items-center h-full">
                <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: `${C.cyan}33`, borderTopColor: C.cyan }} />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col justify-center items-center h-full gap-3">
                <span className="material-symbols-outlined text-4xl" style={{ color: C.outline, opacity: 0.3 }}>forum</span>
                <p className="text-sm" style={{ color: C.outline }}>Envoyez le premier message !</p>
              </div>
            ) : (
              // mt-auto colle les messages EN BAS (peu de messages → collés au bas,
              // pas d'espace vide au-dessus de la saisie ; sinon défilement normal).
              <div className="mt-auto space-y-2">
              {messages.map((msg, idx) => {
              const isOwn = msg.sender_id === user.id;
              const repliedMsg = msg.reply_to_id ? getReplied(msg.reply_to_id) : null;
              // Séparateur de date : affiché une seule fois, au changement de jour.
              const prev = messages[idx - 1];
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
                  className={`flex ${isOwn ? "justify-end" : "justify-start"} group`}
                >
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
                          {/* Images : média du message, médias de groupe, ou image collée en texte
                              (on exclut le media_url si c'est en fait un audio). */}
                          {[
                            audioSrcFrom(msg) ? null : msg.media_url,
                            ...(Array.isArray(msg.media_urls) ? msg.media_urls : []),
                            imageSrcFromContent(msg.content),
                          ].filter(Boolean).map((src, i) => (
                            <MsgImage key={i} src={cleanImageSrc(src)} onOpen={setLightbox} onLoaded={() => scrollToBottom()} />
                          ))}
                          {!isDataImage(msg.content) && (msg.content || "").length > 2000
                            ? (msg.content || "").slice(0, 2000) + "…"
                            : (isDataImage(msg.content) ? null : msg.content)}
                        </div>

                        {/* Reactions */}
                        {groupReactions(msg.reactions).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {groupReactions(msg.reactions).map(([emoji, count]) => (
                              <button key={emoji} onClick={() => handleReaction(msg.id, emoji)}
                                className="text-xs px-1.5 py-0.5 rounded-full transition-all hover:opacity-80"
                                style={{ background: C.high, border: `1px solid ${C.outlineVar}` }}>
                                {emoji} {count}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Hover actions */}
                        {hoveredMessage === msg.id && (
                          <div
                            className={`absolute ${isOwn ? "right-full mr-2" : "left-full ml-2"} top-0 flex items-center gap-1 rounded-xl px-1 py-1 shadow-lg`}
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
                        <span title="Message éphémère" style={{ color: C.cyan }}><Ico name="timer" size={11} /></span>
                      )}
                      <span className="text-[9px]" style={{ color: C.outline }}>
                        {msg.created_at ? new Date(msg.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}
                      </span>
                      {getStatus(msg)}
                    </div>
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
                <span>Réponse à <strong style={{ color: C.onSurface }}>{replyingTo.content?.substring(0, 40)}…</strong></span>
              </div>
              <button onClick={() => setReplyingTo(null)} style={{ color: C.outline }} className="hover:text-white transition-colors">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          )}

          {/* Input — collé en bas, avec la safe-area iOS pour combler l'espace
              sous la barre (home indicator) et éviter qu'elle « remonte ». */}
          <div className="px-4 pt-3 flex-shrink-0" style={{ background: "rgba(2,6,23,0.5)", paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
            {/* Aperçu de l'image en attente */}
            {pendingImage && (
              <div className="mb-2 relative inline-block">
                <img src={pendingImage} alt="aperçu" className="h-20 rounded-xl object-cover" />
                <button
                  type="button"
                  onClick={() => setPendingImage(null)}
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-xs"
                  style={{ background: "#ef4444", color: "#fff" }}
                  title="Retirer"
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
                <button type="button" onClick={() => setPendingAudio(null)} title="Retirer" style={{ color: "#f87171" }}>
                  <span className="material-symbols-outlined text-sm">delete</span>
                </button>
              </div>
            )}

            {recording ? (
              /* Barre d'enregistrement vocal (façon Insta : corbeille · mic rouge ·
                 chrono · onde animée · valider) */
              <div className="flex items-center gap-2.5 px-3 py-2 rounded-2xl" style={glass}>
                <button type="button" onClick={cancelRecording} title="Supprimer"
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
                <button type="button" onClick={stopRecording} title="Terminer"
                  className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
                  style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
                  <span className="material-symbols-outlined text-lg">check</span>
                </button>
              </div>
            ) : (
              <form onSubmit={handleSendMessage} className="flex items-center gap-2 px-3 py-2 rounded-2xl" style={glass}>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePickImage}
                />
                {!isGroup && (
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={compressing}
                    className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-50"
                    style={{ background: C.high, color: C.cyan }}
                    title="Envoyer une image"
                  >
                    <span className="material-symbols-outlined text-sm">{compressing ? "hourglass_top" : "image"}</span>
                  </button>
                )}
                {!isGroup && !pendingAudio && (
                  <button
                    type="button"
                    onClick={startRecording}
                    className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
                    style={{ background: C.high, color: C.cyan }}
                    title="Message vocal"
                  >
                    <span className="material-symbols-outlined text-sm">mic</span>
                  </button>
                )}
                <input
                  value={messageContent}
                  onChange={(e) => setMessageContent(e.target.value)}
                  placeholder="Envoyer un message..."
                  className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-slate-600"
                  style={{ color: C.onSurface }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSendMessage(e); }}
                />
                <button type="submit" disabled={!messageContent.trim() && !pendingImage && !pendingAudio}
                  className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
                  style={{ background: (messageContent.trim() || pendingImage || pendingAudio) ? "linear-gradient(135deg,#22d3ee,#3b82f6)" : C.high, color: (messageContent.trim() || pendingImage || pendingAudio) ? C.onPrimary : C.outline }}>
                  <span className="material-symbols-outlined text-sm">send</span>
                </button>
              </form>
            )}
          </div>
        </>
      ) : (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ background: `${C.cyan}12` }}>
            <span className="material-symbols-outlined text-4xl" style={{ color: C.cyan, opacity: 0.6 }}>forum</span>
          </div>
          <div className="text-center">
            <h3 className="font-black text-lg mb-1" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Centre de communication</h3>
            <p className="text-sm" style={{ color: C.outline }}>Sélectionnez une conversation pour commencer</p>
          </div>
          <button onClick={openNewMessage} className="px-5 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 hover:opacity-90"
            style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
            Nouvelle conversation
          </button>
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
                      placeholder="Rechercher une personne..."
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
                        <button onClick={() => removeGroupMember(m)} title="Retirer du groupe"
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
      <div className="relative z-10 flex h-[100dvh] lg:h-screen">
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
            aria-label="Fermer"
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
              <h3 className="font-black text-lg" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Votre note</h3>
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
                placeholder="Partagez une note…"
                className="w-full px-4 py-3 rounded-xl text-sm border-none outline-none placeholder:text-slate-500"
                style={{ background: C.high, color: C.onSurface }}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px]" style={{ color: C.outline }}>
                {noteText.length}/{NOTE_MAX}
              </span>
            </div>
            <p className="text-[10px] mt-2" style={{ color: C.outline }}>Votre note disparaît après 24 h.</p>

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
              <h3 className="font-black text-lg" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Messages éphémères</h3>
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
              <h3 className="font-black text-base" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Nouveau message</h3>
              <span className="w-6" />
            </div>

            {/* Recherche */}
            <div className="px-4 py-3 flex-shrink-0">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-sm" style={{ color: C.outline }}>search</span>
                <input autoFocus value={nmSearch} onChange={(e) => setNmSearch(e.target.value)}
                  placeholder="Rechercher..."
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
              <h3 className="font-black text-lg" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Nouveau groupe</h3>
              <button onClick={() => setShowNewGroup(false)} style={{ color: C.outline }} className="hover:text-white transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Nom du groupe..."
              className="w-full mb-4 px-4 py-2.5 rounded-xl text-sm border-none outline-none placeholder:text-slate-500"
              style={{ background: C.high, color: C.onSurface }} />
            <input value={groupSearch} onChange={e => setGroupSearch(e.target.value)} placeholder="Rechercher des membres..."
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
