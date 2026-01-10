// src/pages/MessagesPageEnhanced.jsx - Messages avec toutes les fonctionnalités

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
  MoreVertical, Reply, Smile, Copy, Trash2, Users
} from "lucide-react";
import { toast } from "sonner";

// Picker emoji simple
const QUICK_EMOJIS = ["❤️", "👍", "😂", "😮", "😢", "🙏"];

export default function MessagesPageEnhanced({ user }) {
  const { userId: selectedUserId, groupId: selectedGroupId } = useParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [groups, setGroups] = useState([]);
  const [messages, setMessages] = useState([]);
  const [messageContent, setMessageContent] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [showNewMessageModal, setShowNewMessageModal] = useState(false);
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(null); // message_id ou null
  const [hoveredMessage, setHoveredMessage] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  
  // Groupe
  const [groupName, setGroupName] = useState("");
  const [selectedMembers, setSelectedMembers] = useState([]);
  
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
    }
  }, [selectedUserId, selectedGroupId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchConversations = async () => {
    try {
      const response = await axios.get(`${API}/messages/conversations`);
      setConversations(response.data);
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
    }
  };

  const fetchMessages = async (otherUserId) => {
    try {
      const response = await axios.get(`${API}/messages/${otherUserId}`);
      setMessages(response.data);
      
      const userResponse = await axios.get(`${API}/users/${otherUserId}`);
      setSelectedUser(userResponse.data);
      setSelectedGroup(null);
    } catch (error) {
      toast.error("Erreur lors du chargement des messages");
    }
  };

  const fetchGroupMessages = async (groupId) => {
    try {
      const response = await axios.get(`${API}/messages/groups/${groupId}/messages`);
      setMessages(response.data.messages || []);
      
      const groupResponse = await axios.get(`${API}/messages/groups/${groupId}`);
      setSelectedGroup(groupResponse.data.group);
      setSelectedUser(null);
    } catch (error) {
      toast.error("Erreur lors du chargement des messages du groupe");
    }
  };

  const markAsRead = async (otherUserId) => {
    try {
      await axios.put(`${API}/messages/mark-as-read/${otherUserId}`);
      fetchConversations(); // Refresh pour mettre à jour les compteurs
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

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!messageContent.trim()) return;

    try {
      if (selectedGroupId) {
        // Message de groupe
        const response = await axios.post(`${API}/messages/groups/${selectedGroupId}/messages`, {
          content: messageContent,
          reply_to_id: replyingTo?.id
        });
        setMessages([...messages, response.data.message]);
      } else {
        // Message privé
        const response = await axios.post(`${API}/messages`, {
          recipient_id: selectedUserId,
          content: messageContent,
          reply_to_id: replyingTo?.id
        });
        setMessages([...messages, response.data.message]);
      }
      
      setMessageContent("");
      setReplyingTo(null);
      fetchConversations();
    } catch (error) {
      toast.error("Erreur lors de l'envoi du message");
    }
  };

  const handleReaction = async (messageId, emoji) => {
    try {
      const response = await axios.post(`${API}/messages/${messageId}/react`, { emoji });
      
      // Mettre à jour localement
      setMessages(messages.map(msg => 
        msg.id === messageId 
          ? { ...msg, reactions: response.data.reactions }
          : msg
      ));
      
      setShowEmojiPicker(null);
    } catch (error) {
      toast.error("Erreur lors de l'ajout de la réaction");
    }
  };

  const handleCopyMessage = (content) => {
    navigator.clipboard.writeText(content);
    toast.success("Message copié !");
  };

  const handleDeleteMessage = async (messageId, deleteFor = "me") => {
    try {
      await axios.delete(`${API}/messages/${messageId}`, {
        data: { delete_for: deleteFor }
      });
      
      if (deleteFor === "everyone") {
        setMessages(messages.filter(msg => msg.id !== messageId));
      } else {
        // Masquer localement
        setMessages(messages.filter(msg => msg.id !== messageId));
      }
      
      toast.success("Message supprimé");
    } catch (error) {
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedMembers.length === 0) {
      toast.error("Nom et membres requis");
      return;
    }

    try {
      const response = await axios.post(`${API}/messages/groups`, {
        name: groupName,
        member_ids: selectedMembers.map(m => m.id)
      });
      
      setShowNewGroupModal(false);
      setGroupName("");
      setSelectedMembers([]);
      
      fetchGroups();
      navigate(`/messages/group/${response.data.group.id}`);
      toast.success("Groupe créé !");
    } catch (error) {
      toast.error("Erreur lors de la création du groupe");
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

  return (
    <Layout user={user}>
      <div className="flex h-[calc(100vh-64px)] lg:h-screen">
        {/* Conversations List */}
        <div className={`w-full sm:w-80 border-r border-slate-800 overflow-y-auto ${
          selectedUserId || selectedGroupId ? 'hidden sm:block' : 'block'
        }`}>
          {/* Header */}
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
          
          {/* Groupes */}
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
                      {group.member_ids.length} membres
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {/* Conversations privées */}
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
            <div>
              {conversations.map((conv) => (
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
              ))}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className={`flex-1 flex flex-col ${
          selectedUserId || selectedGroupId ? 'block' : 'hidden sm:flex'
        }`}>
          {(selectedUserId && selectedUser) || (selectedGroupId && selectedGroup) ? (
            <>
              {/* Header */}
              <div className="sticky top-0 bg-slate-950 border-b border-slate-800 p-4 flex items-center gap-3 z-10">
                <Button
                  variant="ghost"
                  size="icon"
                  className="sm:hidden"
                  onClick={() => navigate('/messages')}
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <Avatar>
                  <AvatarImage src={selectedUser?.profile_pic || selectedGroup?.avatar_url} />
                  <AvatarFallback className={selectedGroup ? "bg-gradient-to-r from-purple-500 to-pink-500" : "bg-slate-700"}>
                    {(selectedUser?.username || selectedGroup?.name)[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <h3 className="font-semibold">
                    {selectedUser?.username || selectedGroup?.name}
                  </h3>
                  {selectedUser?.bio && (
                    <p className="text-xs text-slate-400 truncate">{selectedUser.bio}</p>
                  )}
                  {selectedGroup && (
                    <p className="text-xs text-slate-400">
                      {selectedGroup.member_ids.length} membres
                    </p>
                  )}
                </div>
              </div>

              {/* Messages avec hover et actions */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg) => {
                  const isOwn = msg.sender_id === user.id;
                  const repliedMsg = msg.reply_to_id ? getRepliedMessage(msg.reply_to_id) : null;

                  return (
                    <div
                      key={msg.id}
                      onMouseEnter={() => setHoveredMessage(msg.id)}
                      onMouseLeave={() => setHoveredMessage(null)}
                      className={`flex ${isOwn ? 'justify-end' : 'justify-start'} group`}
                    >
                      <div className="relative">
                        {/* Bulle de message */}
                        <div
                          className={`max-w-xs sm:max-w-md px-4 py-2 rounded-2xl ${
                            isOwn
                              ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white'
                              : 'bg-slate-800 text-white'
                          }`}
                        >
                          {/* Message répondu */}
                          {repliedMsg && (
                            <div className="mb-2 pb-2 border-b border-white/20">
                              <p className="text-xs opacity-70 truncate">
                                Réponse à : {repliedMsg.content}
                              </p>
                            </div>
                          )}
                          
                          <p className="break-words">{msg.content}</p>
                          
                          {/* Statut (ticks) */}
                          {isOwn && (
                            <div className="flex items-center justify-end mt-1 gap-1">
                              <span className="text-[10px] opacity-70">
                                {new Date(msg.created_at).toLocaleTimeString('fr-FR', {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </span>
                              {getMessageStatus(msg)}
                            </div>
                          )}
                        </div>

                        {/* Réactions */}
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

                        {/* Actions au hover (PC uniquement) */}
                        {hoveredMessage === msg.id && (
                          <div className={`hidden md:flex absolute top-0 ${
                            isOwn ? 'left-0 -translate-x-full -ml-2' : 'right-0 translate-x-full mr-2'
                          } items-center gap-1 bg-slate-900 rounded-lg p-1 shadow-lg border border-slate-700`}>
                            {/* Emoji */}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 hover:bg-slate-800"
                              onClick={() => setShowEmojiPicker(msg.id)}
                            >
                              <Smile className="w-4 h-4" />
                            </Button>

                            {/* Reply */}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 hover:bg-slate-800"
                              onClick={() => setReplyingTo(msg)}
                            >
                              <Reply className="w-4 h-4" />
                            </Button>

                            {/* Menu 3 points */}
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
                              <DropdownMenuContent className="bg-slate-900 border-slate-700 text-white">
                                <DropdownMenuItem
                                  onClick={() => handleCopyMessage(msg.content)}
                                  className="cursor-pointer hover:bg-slate-800"
                                >
                                  <Copy className="w-4 h-4 mr-2" />
                                  Copier
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => setReplyingTo(msg)}
                                  className="cursor-pointer hover:bg-slate-800"
                                >
                                  <Reply className="w-4 h-4 mr-2" />
                                  Répondre
                                </DropdownMenuItem>
                                {isOwn && (
                                  <>
                                    <DropdownMenuItem
                                      onClick={() => handleDeleteMessage(msg.id, "me")}
                                      className="cursor-pointer hover:bg-slate-800 text-red-400"
                                    >
                                      <Trash2 className="w-4 h-4 mr-2" />
                                      Supprimer pour moi
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleDeleteMessage(msg.id, "everyone")}
                                      className="cursor-pointer hover:bg-slate-800 text-red-400"
                                    >
                                      <Trash2 className="w-4 h-4 mr-2" />
                                      Supprimer pour tous
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        )}

                        {/* Emoji picker */}
                        {showEmojiPicker === msg.id && (
                          <div className="absolute top-0 right-0 translate-x-full mr-2 bg-slate-900 rounded-lg p-2 shadow-lg border border-slate-700 flex gap-1 z-20">
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
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Input avec réponse */}
              <div className="border-t border-slate-800">
                {/* Barre de réponse */}
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

      {/* Modal Nouveau Message (identique à avant) */}
      <Dialog open={showNewMessageModal} onOpenChange={setShowNewMessageModal}>
        {/* ... même contenu qu'avant ... */}
      </Dialog>

      {/* Modal Nouveau Groupe */}
      <Dialog open={showNewGroupModal} onOpenChange={setShowNewGroupModal}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Créer un groupe</DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            {/* Nom du groupe */}
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Nom du groupe</label>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Ex: Devs Python"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            {/* Recherche membres */}
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Ajouter des membres</label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher..."
                  className="bg-slate-800 border-slate-700 text-white pl-10"
                />
              </div>

              {/* Membres sélectionnés */}
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

              {/* Résultats recherche */}
              <div className="max-h-48 overflow-y-auto space-y-2">
                {searchResults.map(user => (
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
                ))}
              </div>
            </div>

            <Button
              onClick={handleCreateGroup}
              disabled={!groupName.trim() || selectedMembers.length === 0}
              className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
            >
              Créer le groupe
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
