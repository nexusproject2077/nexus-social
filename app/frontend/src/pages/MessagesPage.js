import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Send, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

export default function MessagesPage({ user }) {
  const { userId: selectedUserId } = useParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [messageContent, setMessageContent] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetchConversations();
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      fetchMessages(selectedUserId);
    }
  }, [selectedUserId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchConversations = async () => {
    try {
      const response = await axios.get(`${API}/messages/conversations`);
      setConversations(response.data);
    } catch (error) {
      toast.error("Erreur lors du chargement des conversations");
    }
  };

  const fetchMessages = async (otherUserId) => {
    try {
      const response = await axios.get(`${API}/messages/${otherUserId}`);
      setMessages(response.data);
      
      // Get user info
      const userResponse = await axios.get(`${API}/users/${otherUserId}`);
      setSelectedUser(userResponse.data);
    } catch (error) {
      toast.error("Erreur lors du chargement des messages");
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!messageContent.trim() || !selectedUserId) return;

    try {
      const response = await axios.post(`${API}/messages`, {
        recipient_id: selectedUserId,
        content: messageContent,
      });
      setMessages([...messages, response.data]);
      setMessageContent("");
      fetchConversations(); // Update conversation list
    } catch (error) {
      toast.error("Erreur lors de l'envoi du message");
    }
  };

  const handleSelectConversation = (userId) => {
    navigate(`/messages/${userId}`);
  };

  return (
    <Layout user={user}>
      <div className="flex h-[calc(100vh-64px)]">
        {/* Conversations List */}
        <div className={`w-full sm:w-80 border-r border-slate-800 overflow-y-auto ${
          selectedUserId ? 'hidden sm:block' : 'block'
        }`}>
          <div className="sticky top-0 bg-slate-950 border-b border-slate-800 p-4">
            <h2 className="text-xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Messages</h2>
          </div>
          
          {conversations.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <p>Aucune conversation</p>
            </div>
          ) : (
            <div>
              {conversations.map((conv) => (
                <div
                  key={conv.user_id}
                  data-testid={`conversation-${conv.user_id}`}
                  onClick={() => handleSelectConversation(conv.user_id)}
                  className={`flex items-center gap-3 p-4 hover:bg-slate-900 cursor-pointer border-b border-slate-800 ${
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
                        <span className="bg-cyan-500 text-white text-xs rounded-full px-2 py-1">
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
          selectedUserId ? 'block' : 'hidden sm:flex'
        }`}>
          {selectedUserId && selectedUser ? (
            <>
              <div className="sticky top-0 bg-slate-950 border-b border-slate-800 p-4 flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="sm:hidden"
                  onClick={() => navigate('/messages')}
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <Avatar>
                  <AvatarImage src={selectedUser.profile_pic} />
                  <AvatarFallback className="bg-slate-700">
                    {selectedUser.username[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-semibold">{selectedUser.username}</h3>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    data-testid={`message-${msg.id}`}
                    className={`flex ${
                      msg.sender_id === user.id ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-xs sm:max-w-md px-4 py-2 rounded-2xl ${
                        msg.sender_id === user.id
                          ? 'bg-gradient-to-r from-cyan-500 to-blue-500 text-white'
                          : 'bg-slate-800 text-white'
                      }`}
                    >
                      <p>{msg.content}</p>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-800">
                <div className="flex gap-2">
                  <Input
                    data-testid="message-input"
                    value={messageContent}
                    onChange={(e) => setMessageContent(e.target.value)}
                    placeholder="Écrivez un message..."
                    className="bg-slate-800 border-slate-700 text-white"
                  />
                  <Button
                    data-testid="send-message-button"
                    type="submit"
                    disabled={!messageContent.trim()}
                    className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
                  >
                    <Send className="w-5 h-5" />
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <div className="hidden sm:flex flex-1 items-center justify-center text-slate-400">
              <p>Sélectionnez une conversation pour commencer</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
