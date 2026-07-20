import { useState, useEffect, useRef, useMemo, Fragment } from "react";
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
function MsgImage({ src, onOpen }) {
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
      onError={() => setFailed(true)}
    />
  );
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

  const messagesEndRef = useRef(null);
  const longPressTimer = useRef(null);

  // Image en attente d'envoi (data URL compressée) + sélecteur de fichier.
  const [pendingImage, setPendingImage] = useState(null);
  const [compressing, setCompressing] = useState(false);
  const imageInputRef = useRef(null);

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

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

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
    } catch { toast.error("Erreur lors du chargement des messages"); }
    finally { setLoading(false); }
  };

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
    try { await axios.put(`${API}/messages/mark-as-read/${uid}`); fetchConversations(); } catch {}
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
    if (!text && !pendingImage) return;
    try {
      if (isGroup && selectedGroupId) {
        if (pendingImage) { toast.error("Les images ne sont pas encore disponibles dans les groupes"); return; }
        const res = await axios.post(`${API}/messages/groups/${selectedGroupId}/messages`, {
          content: text, reply_to_id: replyingTo?.id
        });
        if (res.data?.message) setMessages(p => [...p, res.data.message]);
      } else if (selectedUserId) {
        const res = await axios.post(`${API}/messages`, {
          recipient_id: selectedUserId,
          content: text,
          media_url: pendingImage || null,
          media_type: pendingImage ? "image" : null,
          reply_to_id: replyingTo?.id,
        });
        if (res.data) setMessages(p => [...p, res.data]);
      }
      setMessageContent(""); setReplyingTo(null); setPendingImage(null);
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
    return (
      <button
        key={conv.user_id}
        onClick={() => navigate(`/messages/${conv.user_id}`)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all"
        style={{
          background: active ? `linear-gradient(to right, ${C.cyan}10, transparent)` : "transparent",
          borderLeft: active ? `2px solid ${C.cyan}` : "2px solid transparent",
        }}
      >
        <div className="relative">
          <UserAvatar username={conv.username} pic={conv.profile_pic} size={10} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold truncate" style={{ color: active ? C.cyan : C.onSurface }}>{conv.username}</p>
            {conv.unread_count > 0 && (
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-full" style={{ background: C.cyan, color: C.onPrimary }}>{conv.unread_count}</span>
            )}
          </div>
          <p className="text-xs truncate" style={{ color: C.outline }}>{conv.last_message}</p>
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
      {/* Header — pas de trait de séparation, même fond que la liste */}
      <div className="px-5 pt-5 pb-3 flex items-center gap-2">
        {/* Retour à l'accueil (mobile : le footer est masqué sur Messages) */}
        <button onClick={() => navigate("/")} className="lg:hidden -ml-1" title="Retour" style={{ color: C.outline }}>
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        {/* Nom d'utilisateur : centré sur mobile, aligné à gauche sur PC */}
        <h2 className="font-black text-xl tracking-tight flex-1 text-center sm:text-left truncate"
          style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>
          {user?.username ? `@${user.username}` : "Messages"}
        </h2>
        <div className="flex gap-2">
          <button onClick={() => setShowNewGroup(true)} title="Nouveau groupe"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-80"
            style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}>
            <span className="material-symbols-outlined text-sm">group_add</span>
          </button>
          <button onClick={openNewMessage} title="Nouveau message"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-80"
            style={{ background: `${C.cyan}18`, color: C.cyan }}>
            <span className="material-symbols-outlined text-sm">add</span>
          </button>
        </div>
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

      {/* Notes éphémères (façon Instagram) — bande horizontale scrollable */}
      {!showNewMsg && (
        <div className="px-4 pb-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          <div className="flex gap-4">
            {/* Ta note */}
            <button onClick={openNoteComposer} className="flex flex-col items-center gap-1 flex-shrink-0" style={{ width: 66 }} title="Votre note">
              <div className="relative flex items-end justify-center" style={{ paddingTop: 20 }}>
                <div className="absolute top-0 px-2 py-0.5 rounded-full text-[9px] leading-tight text-center whitespace-nowrap overflow-hidden text-ellipsis"
                  style={{ maxWidth: 64, background: C.container, color: myNote ? C.onSurface : C.outline, border: `1px solid ${C.cyan}22` }}>
                  {myNote ? myNote.content : "Note…"}
                </div>
                <UserAvatar username={user?.username} pic={user?.profile_pic} size={11} />
                {!myNote && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[11px] font-black"
                    style={{ background: C.cyan, color: C.onPrimary, border: `2px solid ${C.surface}` }}>+</div>
                )}
              </div>
              <span className="text-[10px] text-center truncate" style={{ width: 64, color: C.onSurface }}>Votre note</span>
            </button>

            {/* Notes des personnes suivies */}
            {otherNotes.map((n) => (
              <button key={n.id} onClick={() => navigate(`/messages/${n.user_id}`)}
                className="flex flex-col items-center gap-1 flex-shrink-0" style={{ width: 66 }} title={n.content}>
                <div className="relative flex items-end justify-center" style={{ paddingTop: 20 }}>
                  <div className="absolute top-0 px-2 py-0.5 rounded-full text-[9px] leading-tight text-center whitespace-nowrap overflow-hidden text-ellipsis"
                    style={{ maxWidth: 64, background: C.container, color: C.onSurface, border: `1px solid ${C.cyan}22` }}>
                    {n.content}
                  </div>
                  <UserAvatar username={n.username} pic={n.profile_pic} size={11} />
                </div>
                <span className="text-[10px] text-center truncate" style={{ width: 64, color: C.outline }}>@{n.username}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Scrollable list — groupes et messages privés fusionnés, triés du plus
          récent au plus ancien (chaque nouveau message remonte en haut). */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
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
    <div className={`flex-1 flex flex-col overflow-hidden ${hasSelection ? "flex" : "hidden sm:flex"}`} style={{ background: "rgba(2,6,23,0.5)" }}>
      {hasSelection && currentName ? (
        <>
          {/* Chat header */}
          <div className="h-14 px-5 flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(11,19,38,0.6)" }}>
            <div className="flex items-center gap-3">
              <button onClick={() => navigate("/messages")} className="sm:hidden mr-1" style={{ color: C.outline }}>
                <span className="material-symbols-outlined">arrow_back</span>
              </button>
              <div className="relative">
                <UserAvatar username={currentName} pic={currentPic} size={9} />
              </div>
              <div>
                <h3 className="font-bold text-sm" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>{currentName}</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.cyan }}>
                  {isGroup ? `${selectedGroup?.member_ids?.length || 0} membres` : "Chiffré P2P"}
                </p>
              </div>
            </div>
            {isGroup && (
              <button onClick={handleLeaveGroup} title="Quitter le groupe" className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:bg-red-500/20 hover:text-red-400"
                style={{ color: C.outline, border: "1px solid rgba(255,255,255,0.08)" }}>
                Quitter
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2" style={{ scrollbarWidth: "none" }}>
            {loading ? (
              <div className="flex justify-center items-center h-full">
                <div className="w-7 h-7 rounded-full border-2 animate-spin" style={{ borderColor: `${C.cyan}33`, borderTopColor: C.cyan }} />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col justify-center items-center h-full gap-3">
                <span className="material-symbols-outlined text-4xl" style={{ color: C.outline, opacity: 0.3 }}>forum</span>
                <p className="text-sm" style={{ color: C.outline }}>Envoyez le premier message !</p>
              </div>
            ) : messages.map((msg, idx) => {
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
                    {/* Reply preview */}
                    {repliedMsg && (
                      <div className={`text-[10px] mb-1 px-2 py-1 rounded-lg border-l-2 ${isOwn ? "ml-auto" : ""}`}
                        style={{ background: C.high, borderColor: C.cyan, color: C.outline, maxWidth: "100%" }}>
                        ↩ {repliedMsg.content?.substring(0, 50)}…
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
                          {/* Images : média du message, médias de groupe, ou image collée en texte */}
                          {[
                            msg.media_url,
                            ...(Array.isArray(msg.media_urls) ? msg.media_urls : []),
                            imageSrcFromContent(msg.content),
                          ].filter(Boolean).map((src, i) => (
                            <MsgImage key={i} src={cleanImageSrc(src)} onOpen={setLightbox} />
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

          {/* Input — pas de trait de séparation, même fond que la zone messages */}
          <div className="px-4 py-3 flex-shrink-0" style={{ background: "rgba(2,6,23,0.5)" }}>
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
              <input
                value={messageContent}
                onChange={(e) => setMessageContent(e.target.value)}
                placeholder="Envoyer un message..."
                className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-slate-600"
                style={{ color: C.onSurface }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSendMessage(e); }}
              />
              <button type="submit" disabled={!messageContent.trim() && !pendingImage}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
                style={{ background: (messageContent.trim() || pendingImage) ? "linear-gradient(135deg,#22d3ee,#3b82f6)" : C.high, color: (messageContent.trim() || pendingImage) ? C.onPrimary : C.outline }}>
                <span className="material-symbols-outlined text-sm">send</span>
              </button>
            </form>
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

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Layout user={user} compact hideMobileChrome>
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
