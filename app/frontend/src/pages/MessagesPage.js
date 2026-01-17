import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Send, ArrowLeft, Plus, Search, X, Check, CheckCheck,
  MoreVertical, Reply, Smile, Copy, Trash2, Users,
  UserMinus, LogOut, Settings, Crown, Shield
} from "lucide-react";
import { toast } from "sonner";

const QUICK_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

export default function MessagesPage({ user }) {
  const params = useParams();
  const navigate = useNavigate();
  
  const selectedUserId = params.userId;
  const selectedGroupId = params.groupId;
  const isGroup = Boolean(selectedGroupId);
  
  const [conversations, setConversations] = useState([]);
  const [groups, setGroups] = useState([]);
  const [messages, setMessages] = useState([]);
  const [messageContent, setMessageContent] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [showNewMessageModal, setShowNewMessageModal] = useState(false);
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(null);
  const [hoveredMessage, setHoveredMessage] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Separate search for group modal
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [groupSearchResults, setGroupSearchResults] = useState([]);
  const [groupSearchLoading, setGroupSearchLoading] = useState(false);
  
  // Mobile long press
  const [longPressMessage, setLongPressMessage] = useState(null);
  const [showMobileActions, setShowMobileActions] = useState(false);
  const longPressTimer = useRef(null);

  // Group details modal
  const [showGroupDetails, setShowGroupDetails] = useState(false);
  const [groupMembers, setGroupMembers] = useState([]);
  
  const messagesEndRef = useRef(null);

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
    } else {
      // Recharger les groupes quand on revient à la page principale
      fetchGroups();
      fetchConversations();
    }
  }, [selectedUserId, selectedGroupId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Search for new message modal
  useEffect(() => {
    const delaySearch = setTimeout(() => {
      if (searchQuery.trim().length > 0) {
        searchUsers();
      } else {
        setSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(delaySearch);
  }, [searchQuery]);

  // Search for group modal
  useEffect(() => {
    const delaySearch = setTimeout(() => {
      if (groupSearchQuery.trim().length > 0) {
        searchUsersForGroup();
      } else {
        setGroupSearchResults([]);
      }
    }, 300);
    return () => clearTimeout(delaySearch);
  }, [groupSearchQuery]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchConversations = async () => {
    try {
      const response = await axios.get(`${API}/messages/conversations`);
      setConversations(response.data || []);
    } catch (error) {
      console.error("Erreur conversations:", error);
    }
  };

  const fetchGroups = async () => {
    try {
      const response = await axios.get(`${API}/messages/groups`);
      setGroups(response.data.groups || []);
    } catch (error) {
      console.error("Erreur groupes:", error);
      setGroups([]);
    }
  };

  const fetchMessages = async (otherUserId) => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/messages/${otherUserId}`);
      setMessages(response.data || []);
      
      const userResponse = await axios.get(`${API}/users/${otherUserId}`);
      setSelectedUser(userResponse.data);
      setSelectedGroup(null);
    } catch (error) {
      toast.error("Erreur lors du chargement des messages");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchGroupMessages = async (groupId) => {
    try {
      setLoading(true);
      const [messagesRes, groupRes] = await Promise.all([
        axios.get(`${API}/messages/groups/${groupId}/messages`),
        axios.get(`${API}/messages/groups/${groupId}`)
      ]);

      setMessages(messagesRes.data.messages || []);
      setSelectedGroup(groupRes.data.group);
      setSelectedUser(null);
    } catch (error) {
      console.error("Erreur groupe:", error);
      const errorMessage = error.response?.data?.detail || "Erreur lors du chargement du groupe";
      toast.error(errorMessage);
      setMessages([]);
      setSelectedGroup(null);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (otherUserId) => {
    try {
      await axios.put(`${API}/messages/mark-as-read/${otherUserId}`);
      fetchConversations();
    } catch (error) {
      console.error("Erreur mark as read:", error);
    }
  };

  const searchUsers = async () => {
    try {
      setSearchLoading(true);
      const response = await axios.get(`${API}/users/search?q=${searchQuery}`);
      const filtered = response.data.filter(u => u.id !== user.id);
      setSearchResults(filtered);
    } catch (error) {
      console.error("Erreur recherche:", error);
    } finally {
      setSearchLoading(false);
    }
  };

  const searchUsersForGroup = async () => {
    try {
      setGroupSearchLoading(true);
      const response = await axios.get(`${API}/users/search?q=${groupSearchQuery}`);
      const filtered = response.data.filter(u => u.id !== user.id);
      setGroupSearchResults(filtered);
    } catch (error) {
      console.error("Erreur recherche groupe:", error);
    } finally {
      setGroupSearchLoading(false);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!messageContent.trim()) return;

    try {
      if (isGroup && selectedGroupId) {
        const response = await axios.post(`${API}/messages/groups/${selectedGroupId}/messages`, {
          content: messageContent.trim(),
          reply_to_id: replyingTo?.id
        });
        if (response.data && response.data.message) {
          setMessages([...messages, response.data.message]);
        }
      } else if (selectedUserId) {
        const response = await axios.post(`${API}/messages`, {
          recipient_id: selectedUserId,
          content: messageContent.trim(),
          reply_to_id: replyingTo?.id
        });
        if (response.data) {
          setMessages([...messages, response.data]);
        }
      }

      setMessageContent("");
      setReplyingTo(null);
      fetchConversations();
    } catch (error) {
      console.error("Erreur envoi message:", error);
      const errorMessage = error.response?.data?.detail || "Erreur lors de l'envoi du message";
      toast.error(errorMessage);
    }
  };

  const handleReaction = async (messageId, emoji) => {
    try {
      const response = await axios.post(`${API}/messages/${messageId}/react`, { emoji });
      setMessages(messages.map(msg => 
        msg.id === messageId ? { ...msg, reactions: response.data.reactions } : msg
      ));
      setShowEmojiPicker(null);
      setShowMobileActions(false);
    } catch (error) {
      toast.error("Erreur lors de l'ajout de la réaction");
    }
  };

  const handleCopyMessage = (content) => {
    navigator.clipboard.writeText(content);
    toast.success("Message copié !");
    setShowMobileActions(false);
  };

  const handleDeleteMessage = async (messageId, deleteFor = "me") => {
    try {
      await axios.delete(`${API}/messages/${messageId}`, {
        data: { delete_for: deleteFor }
      });
      setMessages(messages.filter(msg => msg.id !== messageId));
      toast.success("Message supprimé");
      setShowMobileActions(false);
    } catch (error) {
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      toast.error("Le nom du groupe est requis");
      return;
    }

    if (selectedMembers.length === 0) {
      toast.error("Veuillez sélectionner au moins un membre");
      return;
    }

    try {
      setLoading(true);
      const response = await axios.post(`${API}/messages/groups`, {
        name: groupName.trim(),
        member_ids: selectedMembers.map(m => m.id)
      });

      if (response.data && response.data.group) {
        setShowNewGroupModal(false);
        setGroupName("");
        setSelectedMembers([]);
        setGroupSearchQuery("");
        setGroupSearchResults([]);

        await fetchGroups();
        navigate(`/messages/group/${response.data.group.id}`);
        toast.success("Groupe créé avec succès !");
      } else {
        toast.error("Réponse invalide du serveur");
      }
    } catch (error) {
      console.error("Erreur création groupe:", error);
      const errorMessage = error.response?.data?.detail || "Erreur lors de la création du groupe";
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectConversation = (userId) => {
    navigate(`/messages/${userId}`);
    setShowNewMessageModal(false);
  };

  const handleSelectGroup = (groupId) => {
    navigate(`/messages/group/${groupId}`);
  };

  const handleStartNewConversation = (userId) => {
    setShowNewMessageModal(false);
    navigate(`/messages/${userId}`);
  };

  const fetchGroupMembers = async () => {
    if (!selectedGroup || !selectedGroup.member_ids) return;

    try {
      const membersPromises = selectedGroup.member_ids.map(memberId =>
        axios.get(`${API}/users/${memberId}`)
      );
      const membersResponses = await Promise.all(membersPromises);
      const members = membersResponses.map(res => res.data);
      setGroupMembers(members);
    } catch (error) {
      console.error("Erreur chargement membres:", error);
      toast.error("Erreur lors du chargement des membres");
    }
  };

  const handleLeaveGroup = async () => {
    if (!selectedGroupId || !user) return;

    try {
      await axios.delete(`${API}/messages/groups/${selectedGroupId}/members/${user.id}`);
      toast.success("Vous avez quitté le groupe");
      setShowGroupDetails(false);
      navigate('/messages');
      await fetchGroups();
    } catch (error) {
      console.error("Erreur quitter groupe:", error);
      const errorMessage = error.response?.data?.detail || "Erreur lors de la sortie du groupe";
      toast.error(errorMessage);
    }
  };

  const handleRemoveMember = async (memberId) => {
    if (!selectedGroupId) return;

    try {
      await axios.delete(`${API}/messages/groups/${selectedGroupId}/members/${memberId}`);
      toast.success("Membre retiré du groupe");
      await fetchGroupMembers();
      // Recharger les détails du groupe
      const groupRes = await axios.get(`${API}/messages/groups/${selectedGroupId}`);
      setSelectedGroup(groupRes.data.group);
    } catch (error) {
      console.error("Erreur retrait membre:", error);
      const errorMessage = error.response?.data?.detail || "Erreur lors du retrait du membre";
      toast.error(errorMessage);
    }
  };

  // Long press handlers
  const handleTouchStart = (msg) => {
    longPressTimer.current = setTimeout(() => {
      setLongPressMessage(msg);
      setShowMobileActions(true);
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  const getMessageStatus = (msg) => {
    if (msg.sender_id !== user.id) return null;
    
    if (msg.status === "read") {
      return <CheckCheck className="w-4 h-4 text-blue-400" />;
    } else if (msg.status === "delivered") {
      return <CheckCheck className="w-4 h-4 text-slate-400" />;
    } else {
      return <Check className="w-4 h-4 text-slate-400" />;
    }
  };

  const getRepliedMessage = (replyToId) => {
    return messages.find(m => m.id === replyToId);
  };

  const hasSelection = Boolean(selectedUserId || selectedGroupId);
  const currentName = selectedUser?.username || selectedGroup?.name || "";
  const currentAvatar = selectedUser?.profile_pic || selectedGroup?.avatar_url || "";

  return (
    <Layout user={user}>
      <div className="flex h-[calc(100vh-64px)] lg:h-screen">
        {/* Sidebar */}
        <div className={`w-full sm:w-80 border-r border-slate-800 overflow-y-auto ${
          hasSelection ? 'hidden sm:block' : 'block'
        }`}>
          <div className="sticky top-0 bg-slate-950 border-b border-slate-800 p-4 z-10">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                Messages
              </h2>
              <div className="flex gap-2">
                <Button
                  onClick={() => setShowNewGroupModal(true)}
                  size="icon"
                  className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 rounded-full"
                  title="Nouveau groupe"
                >
                  <Users className="w-5 h-5" />
                </Button>
                <Button
                  onClick={() => setShowNewMessageModal(true)}
                  size="icon"
                  className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 rounded-full"
                  title="Nouveau message"
                >
                  <Plus className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </div>
          
          {groups.length > 0 && (
            <div className="border-b border-slate-800">
              <div className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">
                Groupes
              </div>
              {groups.map((group) => (
                <div
                  key={group.id}
                  onClick={() => handleSelectGroup(group.id)}
                  className={`flex items-center gap-3 p-4 hover:bg-slate-900 cursor-pointer border-b border-slate-800 transition ${
                    selectedGroupId === group.id ? 'bg-slate-900' : ''
                  }`}
                >
                  <Avatar>
                    <AvatarImage src={group.avatar_url} />
                    <AvatarFallback className="bg-gradient-to-r from-purple-500 to-pink-500">
                      {group.name[0].toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{group.name}</p>
                    <p className="text-sm text-slate-400 truncate">
                      {group.member_ids?.length || 0} membres
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          <div className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase">
            Messages privés
          </div>
          
          {conversations.length === 0 ? (
            <div className="text-center py-12 px-4">
              <div className="text-slate-400 mb-4">
                <p className="mb-2">Aucune conversation</p>
                <p className="text-sm">Commencez une nouvelle conversation !</p>
              </div>
              <Button
                onClick={() => setShowNewMessageModal(true)}
                className="bg-gradient-to-r from-cyan-500 to-blue-500"
              >
                <Plus className="w-4 h-4 mr-2" />
                Nouveau message
              </Button>
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.user_id}
                onClick={() => handleSelectConversation(conv.user_id)}
                className={`flex items-center gap-3 p-4 hover:bg-slate-900 cursor-pointer border-b border-slate-800 transition ${
                  selectedUserId === conv.user_id ? 'bg-slate-900' : ''
                }`}
              >
                <Avatar>
                  <AvatarImage src={conv.profile_pic} />
                  <AvatarFallback className="bg-slate-700">
                    {conv.username[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold truncate">{conv.username}</p>
                    {conv.unread_count > 0 && (
                      <span className="bg-cyan-500 text-white text-xs rounded-full px-2 py-1 ml-2">
                        {conv.unread_count}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400 truncate">{conv.last_message}</p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Messages Area */}
        <div className={`flex-1 flex flex-col ${hasSelection ? 'block' : 'hidden sm:flex'}`}>
          {hasSelection && currentName ? (
            <>
              <div className="sticky top-0 bg-slate-950 border-b border-slate-800 p-4 flex items-center gap-3 z-10">
                <Button
                  variant="ghost"
                  size="icon"
                  className="sm:hidden"
                  onClick={() => navigate('/messages')}
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <div
                  className={`flex items-center gap-3 flex-1 ${isGroup ? 'cursor-pointer hover:bg-slate-900 -ml-2 -my-2 p-2 rounded-lg transition' : ''}`}
                  onClick={() => {
                    if (isGroup) {
                      setShowGroupDetails(true);
                      fetchGroupMembers();
                    }
                  }}
                >
                  <Avatar>
                    <AvatarImage src={currentAvatar} />
                    <AvatarFallback className={isGroup ? "bg-gradient-to-r from-purple-500 to-pink-500" : "bg-slate-700"}>
                      {currentName[0]?.toUpperCase() || '?'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <h3 className="font-semibold">{currentName}</h3>
                    {selectedUser?.bio && (
                      <p className="text-xs text-slate-400 truncate">{selectedUser.bio}</p>
                    )}
                    {selectedGroup && (
                      <p className="text-xs text-slate-400">
                        {selectedGroup.member_ids?.length || 0} membres
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {loading ? (
                  <div className="flex justify-center items-center h-full">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex justify-center items-center h-full text-slate-400">
                    <p>Aucun message</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isOwn = msg.sender_id === user.id;
                    const repliedMsg = msg.reply_to_id ? getRepliedMessage(msg.reply_to_id) : null;

                    return (
                      <div
                        key={msg.id}
                        onMouseEnter={() => setHoveredMessage(msg.id)}
                        onMouseLeave={() => setHoveredMessage(null)}
                        onTouchStart={() => handleTouchStart(msg)}
                        onTouchEnd={handleTouchEnd}
                        className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group`}
                      >
                        <div className="relative flex items-center gap-2">
                          {/* Actions AVANT (desktop only, messages à droite) */}
                          {isOwn && hoveredMessage === msg.id && (
                            <div className="hidden md:flex items-center gap-1 bg-slate-900 rounded-lg p-1 shadow-lg border border-slate-700">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 hover:bg-slate-800"
                                onClick={() => setShowEmojiPicker(msg.id)}
                              >
                                <Smile className="w-4 h-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 hover:bg-slate-800"
                                onClick={() => setReplyingTo(msg)}
                              >
                                <Reply className="w-4 h-4" />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 hover:bg-slate-800"
                                  >
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent 
                                  className="bg-slate-900 border-slate-700 text-white"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <DropdownMenuItem
                                    onSelect={() => handleCopyMessage(msg.content)}
                                    className="cursor-pointer hover:bg-slate-800"
                                  >
                                    <Copy className="w-4 h-4 mr-2" />
                                    Copier
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => setReplyingTo(msg)}
                                    className="cursor-pointer hover:bg-slate-800"
                                  >
                                    <Reply className="w-4 h-4 mr-2" />
                                    Répondre
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => handleDeleteMessage(msg.id, "me")}
                                    className="cursor-pointer hover:bg-slate-800 text-red-400"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Supprimer pour moi
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => handleDeleteMessage(msg.id, "everyone")}
                                    className="cursor-pointer hover:bg-slate-800 text-red-400"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Supprimer pour tous
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}

                          {/* Bulle */}
                          <div className="relative max-w-xs sm:max-w-md">
                            <div
                              className={`px-4 py-2 rounded-2xl ${
                                isOwn
                                  ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white'
                                  : 'bg-slate-800 text-white'
                              }`}
                            >
                              {repliedMsg && (
                                <div className="mb-2 pb-2 border-b border-white/20">
                                  <p className="text-xs opacity-70 truncate">
                                    Réponse à : {repliedMsg.content}
                                  </p>
                                </div>
                              )}
                              
                              <p className="break-words">{msg.content}</p>
                              
                              <div className="flex items-center justify-end mt-1 gap-1">
                                <span className="text-[10px] opacity-70">
                                  {new Date(msg.created_at).toLocaleTimeString('fr-FR', {
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </span>
                                {isOwn && getMessageStatus(msg)}
                              </div>
                            </div>

                            {msg.reactions && msg.reactions.length > 0 && (
                              <div className="flex gap-1 mt-1">
                                {msg.reactions.map((reaction, idx) => (
                                  <div
                                    key={idx}
                                    className="bg-slate-700 px-2 py-1 rounded-full text-xs"
                                  >
                                    {reaction.emoji}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Emoji Picker */}
                            {showEmojiPicker === msg.id && (
                              <div className={`absolute top-0 ${
                                isOwn ? 'right-full mr-2' : 'left-full ml-2'
                              } bg-slate-900 rounded-lg p-2 shadow-lg border border-slate-700 flex gap-1 z-20`}>
                                {QUICK_EMOJIS.map(emoji => (
                                  <button
                                    key={emoji}
                                    onClick={() => handleReaction(msg.id, emoji)}
                                    className="hover:scale-125 transition text-2xl"
                                  >
                                    {emoji}
                                  </button>
                                ))}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  onClick={() => setShowEmojiPicker(null)}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                          </div>

                          {/* Actions APRÈS (desktop only, messages à gauche) */}
                          {!isOwn && hoveredMessage === msg.id && (
                            <div className="hidden md:flex items-center gap-1 bg-slate-900 rounded-lg p-1 shadow-lg border border-slate-700">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 hover:bg-slate-800"
                                onClick={() => setShowEmojiPicker(msg.id)}
                              >
                                <Smile className="w-4 h-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 hover:bg-slate-800"
                                onClick={() => setReplyingTo(msg)}
                              >
                                <Reply className="w-4 h-4" />
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 hover:bg-slate-800"
                                  >
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent 
                                  className="bg-slate-900 border-slate-700 text-white"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <DropdownMenuItem
                                    onSelect={() => handleCopyMessage(msg.content)}
                                    className="cursor-pointer hover:bg-slate-800"
                                  >
                                    <Copy className="w-4 h-4 mr-2" />
                                    Copier
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onSelect={() => setReplyingTo(msg)}
                                    className="cursor-pointer hover:bg-slate-800"
                                  >
                                    <Reply className="w-4 h-4 mr-2" />
                                    Répondre
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              <div className="border-t border-slate-800">
                {replyingTo && (
                  <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Reply className="w-4 h-4 text-cyan-400" />
                      <div>
                        <p className="text-xs text-slate-400">Répondre à</p>
                        <p className="text-sm truncate max-w-xs">{replyingTo.content}</p>
                      </div>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setReplyingTo(null)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="p-4">
                  <div className="flex gap-2">
                    <Input
                      value={messageContent}
                      onChange={(e) => setMessageContent(e.target.value)}
                      placeholder="Écrivez un message..."
                      className="bg-slate-800 border-slate-700 text-white"
                    />
                    <Button
                      type="submit"
                      disabled={!messageContent.trim()}
                      className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
                    >
                      <Send className="w-5 h-5" />
                    </Button>
                  </div>
                </form>
              </div>
            </>
          ) : (
            <div className="hidden sm:flex flex-1 items-center justify-center text-slate-400 flex-col gap-4">
              <p>Sélectionnez une conversation pour commencer</p>
              <div className="flex gap-2">
                <Button
                  onClick={() => setShowNewMessageModal(true)}
                  className="bg-gradient-to-r from-cyan-500 to-blue-500"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Nouveau message
                </Button>
                <Button
                  onClick={() => setShowNewGroupModal(true)}
                  className="bg-gradient-to-r from-purple-500 to-pink-500"
                >
                  <Users className="w-4 h-4 mr-2" />
                  Nouveau groupe
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Actions Modal (Long Press) */}
      <Dialog open={showMobileActions} onOpenChange={setShowMobileActions}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-lg">Actions</DialogTitle>
          </DialogHeader>
          
          {longPressMessage && (
            <div className="space-y-2 mt-4">
              <Button
                onClick={() => setShowEmojiPicker(longPressMessage.id)}
                className="w-full justify-start bg-slate-800 hover:bg-slate-700"
              >
                <Smile className="w-4 h-4 mr-2" />
                Réagir
              </Button>
              <Button
                onClick={() => {
                  setReplyingTo(longPressMessage);
                  setShowMobileActions(false);
                }}
                className="w-full justify-start bg-slate-800 hover:bg-slate-700"
              >
                <Reply className="w-4 h-4 mr-2" />
                Répondre
              </Button>
              <Button
                onClick={() => handleCopyMessage(longPressMessage.content)}
                className="w-full justify-start bg-slate-800 hover:bg-slate-700"
              >
                <Copy className="w-4 h-4 mr-2" />
                Copier
              </Button>
              {longPressMessage.sender_id === user.id && (
                <>
                  <Button
                    onClick={() => handleDeleteMessage(longPressMessage.id, "me")}
                    className="w-full justify-start bg-red-900/20 hover:bg-red-900/30 text-red-400"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Supprimer pour moi
                  </Button>
                  <Button
                    onClick={() => handleDeleteMessage(longPressMessage.id, "everyone")}
                    className="w-full justify-start bg-red-900/20 hover:bg-red-900/30 text-red-400"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Supprimer pour tous
                  </Button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Nouveau Message */}
      <Dialog open={showNewMessageModal} onOpenChange={setShowNewMessageModal}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Nouveau message</DialogTitle>
          </DialogHeader>

          <div className="mt-4">
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher un utilisateur..."
                className="bg-slate-800 border-slate-700 text-white pl-10"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {searchLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto"></div>
                </div>
              ) : searchResults.length > 0 ? (
                <div className="space-y-2">
                  {searchResults.map((user) => (
                    <div
                      key={user.id}
                      onClick={() => handleStartNewConversation(user.id)}
                      className="flex items-center gap-3 p-3 hover:bg-slate-800 rounded-lg cursor-pointer transition"
                    >
                      <Avatar>
                        <AvatarImage src={user.profile_pic} />
                        <AvatarFallback className="bg-slate-700">
                          {user.username[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{user.username}</p>
                        {user.bio && (
                          <p className="text-sm text-slate-400 truncate">{user.bio}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : searchQuery ? (
                <div className="text-center py-8 text-slate-400">
                  <p>Aucun utilisateur trouvé</p>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400">
                  <Search className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>Recherchez un utilisateur pour commencer</p>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Nouveau Groupe */}
      <Dialog open={showNewGroupModal} onOpenChange={setShowNewGroupModal}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Créer un groupe</DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Nom du groupe</label>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Ex: Devs Python"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">Ajouter des membres</label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  value={groupSearchQuery}
                  onChange={(e) => setGroupSearchQuery(e.target.value)}
                  placeholder="Rechercher..."
                  className="bg-slate-800 border-slate-700 text-white pl-10"
                />
              </div>

              {selectedMembers.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {selectedMembers.map(member => (
                    <div
                      key={member.id}
                      className="bg-cyan-500 text-white px-3 py-1 rounded-full text-sm flex items-center gap-2"
                    >
                      {member.username}
                      <button
                        onClick={() => setSelectedMembers(selectedMembers.filter(m => m.id !== member.id))}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="max-h-48 overflow-y-auto space-y-2">
                {groupSearchLoading ? (
                  <div className="text-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-500 mx-auto"></div>
                  </div>
                ) : groupSearchResults.length > 0 ? (
                  groupSearchResults.map(user => (
                    <div
                      key={user.id}
                      onClick={() => {
                        if (!selectedMembers.find(m => m.id === user.id)) {
                          setSelectedMembers([...selectedMembers, user]);
                        }
                      }}
                      className="flex items-center gap-3 p-2 hover:bg-slate-800 rounded-lg cursor-pointer"
                    >
                      <Avatar className="w-8 h-8">
                        <AvatarImage src={user.profile_pic} />
                        <AvatarFallback className="bg-slate-700 text-xs">
                          {user.username[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <p className="text-sm">{user.username}</p>
                    </div>
                  ))
                ) : groupSearchQuery ? (
                  <div className="text-center py-4 text-slate-400 text-sm">
                    Aucun utilisateur trouvé
                  </div>
                ) : (
                  <div className="text-center py-4 text-slate-400 text-sm">
                    Recherchez des utilisateurs à ajouter
                  </div>
                )}
              </div>
            </div>

            <Button
              onClick={handleCreateGroup}
              disabled={!groupName.trim() || selectedMembers.length === 0 || loading}
              className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                  Création...
                </div>
              ) : (
                "Créer le groupe"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Détails du Groupe */}
      <Dialog open={showGroupDetails} onOpenChange={setShowGroupDetails}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Détails du groupe</DialogTitle>
          </DialogHeader>

          {selectedGroup && (
            <div className="mt-4 space-y-6">
              {/* Header du groupe */}
              <div className="flex flex-col items-center gap-3 pb-6 border-b border-slate-800">
                <Avatar className="w-24 h-24">
                  <AvatarImage src={selectedGroup.avatar_url} />
                  <AvatarFallback className="bg-gradient-to-r from-purple-500 to-pink-500 text-3xl">
                    {selectedGroup.name[0]?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="text-center">
                  <h3 className="text-xl font-bold">{selectedGroup.name}</h3>
                  <p className="text-sm text-slate-400">
                    {selectedGroup.member_ids?.length || 0} membres
                  </p>
                </div>
              </div>

              {/* Liste des membres */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-semibold text-sm text-slate-400 uppercase">Membres</h4>
                  {selectedGroup.admin_ids?.includes(user.id) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-cyan-400 hover:text-cyan-300"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Ajouter
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  {groupMembers.map((member) => {
                    const isCreator = member.id === selectedGroup.creator_id;
                    const isAdmin = selectedGroup.admin_ids?.includes(member.id);
                    const isCurrentUser = member.id === user.id;
                    const canRemove = selectedGroup.admin_ids?.includes(user.id) && !isCreator && !isCurrentUser;

                    return (
                      <div
                        key={member.id}
                        className="flex items-center gap-3 p-3 hover:bg-slate-800 rounded-lg transition"
                      >
                        <Avatar>
                          <AvatarImage src={member.profile_pic} />
                          <AvatarFallback className="bg-slate-700">
                            {member.username[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold truncate">{member.username}</p>
                            {isCreator && (
                              <Crown className="w-4 h-4 text-yellow-500" title="Créateur" />
                            )}
                            {isAdmin && !isCreator && (
                              <Shield className="w-4 h-4 text-blue-500" title="Admin" />
                            )}
                          </div>
                          {member.bio && (
                            <p className="text-xs text-slate-400 truncate">{member.bio}</p>
                          )}
                        </div>
                        {canRemove && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                            onClick={() => handleRemoveMember(member.id)}
                          >
                            <UserMinus className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2 pt-4 border-t border-slate-800">
                {selectedGroup.creator_id !== user.id && (
                  <Button
                    onClick={handleLeaveGroup}
                    className="w-full justify-start bg-red-900/20 hover:bg-red-900/30 text-red-400 hover:text-red-300"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Quitter le groupe
                  </Button>
                )}

                {selectedGroup.admin_ids?.includes(user.id) && (
                  <Button
                    variant="ghost"
                    className="w-full justify-start text-slate-300 hover:bg-slate-800"
                  >
                    <Settings className="w-4 h-4 mr-2" />
                    Paramètres du groupe
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
