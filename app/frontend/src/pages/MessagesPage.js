import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { toast } from "sonner";
import { Check, CheckCheck } from "lucide-react";

const C = {
  bg:         "#020617",
  surface:    "#0b1326",
  low:        "#131b2e",
  container:  "#171f33",
  high:       "#222a3d",
  bright:     "#31394d",
  cyan:       "#22d3ee",
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

  // Search / new message
  const [searchQuery,      setSearchQuery]      = useState("");
  const [searchResults,    setSearchResults]    = useState([]);
  const [showNewMsg,       setShowNewMsg]       = useState(false);

  // New group modal
  const [showNewGroup,     setShowNewGroup]     = useState(false);
  const [groupName,        setGroupName]        = useState("");
  const [selectedMembers,  setSelectedMembers]  = useState([]);
  const [groupSearch,      setGroupSearch]      = useState("");
  const [groupSearchRes,   setGroupSearchRes]   = useState([]);

  const messagesEndRef = useRef(null);
  const longPressTimer = useRef(null);

  const hasSelection = Boolean(selectedUserId || selectedGroupId);
  const currentName  = selectedUser?.username || selectedGroup?.name || "";
  const currentPic   = selectedUser?.profile_pic || selectedGroup?.avatar_url || "";

  // ── Fetch on mount ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetchConversations();
    fetchGroups();
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
      const res = await axios.get(`${API}/users/search?q=${q}`);
      setSearchResults((res.data || []).filter(u => u.id !== user.id));
    } catch {}
  };

  const searchGroupUsers = async (q) => {
    try {
      const res = await axios.get(`${API}/users/search?q=${q}`);
      setGroupSearchRes((res.data || []).filter(u => u.id !== user.id));
    } catch {}
  };

  const handleSendMessage = async (e) => {
    e?.preventDefault();
    if (!messageContent.trim()) return;
    try {
      if (isGroup && selectedGroupId) {
        const res = await axios.post(`${API}/messages/groups/${selectedGroupId}/messages`, {
          content: messageContent.trim(), reply_to_id: replyingTo?.id
        });
        if (res.data?.message) setMessages(p => [...p, res.data.message]);
      } else if (selectedUserId) {
        const res = await axios.post(`${API}/messages`, {
          recipient_id: selectedUserId, content: messageContent.trim(), reply_to_id: replyingTo?.id
        });
        if (res.data) setMessages(p => [...p, res.data]);
      }
      setMessageContent(""); setReplyingTo(null);
      fetchConversations();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Erreur lors de l'envoi");
    }
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
      await axios.delete(`${API}/messages/${messageId}`, { data: { delete_for: "me" } });
      setMessages(p => p.filter(m => m.id !== messageId));
      toast.success("Message supprimé");
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
    try {
      await axios.delete(`${API}/messages/groups/${selectedGroupId}/members/${user.id}`);
      toast.success("Vous avez quitté le groupe");
      navigate("/messages");
      await fetchGroups();
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
          <p className="text-[10px]" style={{ color: C.outline }}>{group.member_ids?.length || 0} membres</p>
        </div>
      </button>
    );
  };

  // ── Conversation list panel ──────────────────────────────────────────────────
  const ConvPanel = () => (
    <div
      className={`flex flex-col border-r h-full ${hasSelection ? "hidden sm:flex" : "flex"}`}
      style={{ width: 300, minWidth: 280, maxWidth: 320, borderColor: "rgba(255,255,255,0.05)", background: `${C.surface}cc` }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <h2 className="font-black text-xl tracking-tight" style={{ fontFamily: "Space Grotesk, sans-serif", color: C.onSurface }}>Comms</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowNewGroup(true)} title="Nouveau groupe"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:opacity-80"
            style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa" }}>
            <span className="material-symbols-outlined text-sm">group_add</span>
          </button>
          <button onClick={() => setShowNewMsg(true)} title="Nouveau message"
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
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value.trim()) setShowNewMsg(false); else setShowNewMsg(true); }}
            placeholder="Rechercher..."
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

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        {/* Groups */}
        {groups.length > 0 && (
          <div>
            <p className="px-4 pt-3 pb-1 text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: C.outline }}>Groupes</p>
            {groups.map(g => <GroupItem key={g.id} group={g} />)}
          </div>
        )}
        {/* DMs */}
        <div>
          <p className="px-4 pt-3 pb-1 text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: C.outline }}>Messages privés</p>
          {conversations.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <span className="material-symbols-outlined text-3xl block mb-2" style={{ color: C.outline, opacity: 0.4 }}>forum</span>
              <p className="text-xs" style={{ color: C.outline }}>Aucune conversation</p>
              <button onClick={() => setShowNewMsg(true)} className="mt-3 text-xs font-bold px-3 py-1.5 rounded-lg transition-all hover:opacity-80" style={{ background: `${C.cyan}18`, color: C.cyan }}>
                Commencer
              </button>
            </div>
          ) : conversations.map(c => <ConvItem key={c.user_id} conv={c} />)}
        </div>
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
            ) : messages.map((msg) => {
              const isOwn = msg.sender_id === user.id;
              const repliedMsg = msg.reply_to_id ? getReplied(msg.reply_to_id) : null;
              return (
                <div key={msg.id}
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
                          className="px-3 py-2 rounded-2xl text-sm leading-relaxed"
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
                          {msg.content}
                        </div>

                        {/* Reactions */}
                        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {Object.entries(msg.reactions).map(([emoji, users]) => (
                              <button key={emoji} onClick={() => handleReaction(msg.id, emoji)}
                                className="text-xs px-1.5 py-0.5 rounded-full transition-all hover:opacity-80"
                                style={{ background: C.high, border: `1px solid ${C.outlineVar}` }}>
                                {emoji} {users.length}
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
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply indicator */}
          {replyingTo && (
            <div className="px-4 py-2 flex items-center justify-between" style={{ background: C.container, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
              <div className="flex items-center gap-2 text-xs" style={{ color: C.outline }}>
                <span className="material-symbols-outlined text-sm" style={{ color: C.cyan }}>reply</span>
                <span>Réponse à <strong style={{ color: C.onSurface }}>{replyingTo.content?.substring(0, 40)}…</strong></span>
              </div>
              <button onClick={() => setReplyingTo(null)} style={{ color: C.outline }} className="hover:text-white transition-colors">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          )}

          {/* Input */}
          <div className="px-4 py-3 flex-shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(11,19,38,0.7)" }}>
            <form onSubmit={handleSendMessage} className="flex items-center gap-2 px-3 py-2 rounded-2xl" style={glass}>
              <input
                value={messageContent}
                onChange={(e) => setMessageContent(e.target.value)}
                placeholder="Envoyer un message..."
                className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-slate-600"
                style={{ color: C.onSurface }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSendMessage(e); }}
              />
              <button type="submit" disabled={!messageContent.trim()}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-40"
                style={{ background: messageContent.trim() ? "linear-gradient(135deg,#22d3ee,#3b82f6)" : C.high, color: messageContent.trim() ? C.onPrimary : C.outline }}>
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
          <button onClick={() => setShowNewMsg(true)} className="px-5 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 hover:opacity-90"
            style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: C.onPrimary }}>
            Nouvelle conversation
          </button>
        </div>
      )}
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Layout user={user} compact>
      {/* Nebula background */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <div className="absolute rounded-full blur-3xl" style={{ width: "40%", height: "40%", top: "-10%", left: "-5%", background: "radial-gradient(circle, rgba(34,211,238,0.04), transparent)" }} />
        <div className="absolute rounded-full blur-3xl" style={{ width: "40%", height: "40%", bottom: "-10%", right: "-5%", background: "radial-gradient(circle, rgba(59,130,246,0.04), transparent)" }} />
      </div>

      {/* Main 2-column layout */}
      <div className="relative z-10 flex" style={{ height: "calc(100vh - 56px)", marginTop: 56 }}>
        <ConvPanel />
        <ChatPanel />
      </div>

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
