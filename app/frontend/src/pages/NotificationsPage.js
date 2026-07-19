import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNavigate } from "react-router-dom";
import { Heart, MessageCircle, UserPlus, Share2, Repeat, AtSign, TrendingUp, Trash2, Radio } from "lucide-react";
import { toast } from "sonner";

export default function NotificationsPage({ user }) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    try {
      const response = await axios.get(`${API}/notifications`);
      setNotifications(response.data);
    } catch (error) {
      toast.error("Erreur lors du chargement des notifications");
    } finally {
      setLoading(false);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await axios.put(`${API}/notifications/read-all`);
      setNotifications(notifications.map(n => ({ ...n, read: true })));
      toast.success("Toutes les notifications sont marquées comme lues");
    } catch (error) {
      toast.error("Erreur lors de l'action");
    }
  };

  const handleNotificationClick = async (notification) => {
    if (!notification.read) {
      try {
        await axios.put(`${API}/notifications/${notification.id}/read`);
        setNotifications(notifications.map(n => 
          n.id === notification.id ? { ...n, read: true } : n
        ));
      } catch (error) {
        // Silent fail
      }
    }

    if (notification.type === 'live' && notification.post_id) {
      navigate(`/live/${notification.post_id}`);
    } else if (notification.type === 'mention' || notification.type === 'repost' || notification.type === 'like' || notification.type === 'comment' || notification.type === 'trending') {
      if (notification.post_id) navigate(`/post/${notification.post_id}`);
    } else if (notification.post_id) {
      navigate(`/post/${notification.post_id}`);
    } else if (notification.type === 'follow' || notification.type === 'follow_accepted') {
      navigate(`/profile/${notification.from_user_id}`);
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    try {
      await axios.delete(`${API}/notifications/${id}`);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch {
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm("Supprimer toutes les notifications ?")) return;
    try {
      await axios.delete(`${API}/notifications`);
      setNotifications([]);
      toast.success("Notifications supprimées");
    } catch {
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleAcceptRequest = async (e, notif) => {
    e.stopPropagation();
    try {
      await axios.post(`${API}/follow-requests/${notif.from_user_id}/accept`);
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
      toast.success(`Vous avez accepté @${notif.from_username}`);
    } catch { toast.error("Erreur"); }
  };

  const handleRejectRequest = async (e, notif) => {
    e.stopPropagation();
    try {
      await axios.post(`${API}/follow-requests/${notif.from_user_id}/reject`);
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
    } catch { toast.error("Erreur"); }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'like':
        return <Heart className="w-5 h-5 text-red-500" fill="currentColor" />;
      case 'comment':
        return <MessageCircle className="w-5 h-5 text-blue-500" />;
      case 'follow':
      case 'follow_request':
      case 'follow_accepted':
        return <UserPlus className="w-5 h-5 text-green-500" />;
      case 'repost':
      case 'share':
        return <Repeat className="w-5 h-5 text-purple-500" />;
      case 'mention':
        return <AtSign className="w-5 h-5 text-cyan-500" />;
      case 'trending':
        return <TrendingUp className="w-5 h-5 text-orange-500" />;
      case 'live':
        return <Radio className="w-5 h-5 text-red-500" />;
      default:
        return null;
    }
  };

  const getNotificationText = (notif) => {
    if (notif.message) return notif.message;
    switch (notif.type) {
      case 'like':     return "a aimé votre publication";
      case 'comment':  return notif.comment_content ? `a commenté : « ${notif.comment_content} »` : "a commenté votre publication";
      case 'follow':   return "s'est abonné(e) à vous";
      case 'repost':   return "a reposté votre publication";
      case 'mention':  return "vous a mentionné dans une publication";
      case 'trending': return "Votre publication est dans les tendances 🔥";
      case 'follow_request':  return "souhaite s'abonner à vous";
      case 'follow_accepted': return "a accepté votre demande d'abonnement";
      case 'live':     return "est en direct 🔴 — rejoignez maintenant";
      default:         return "";
    }
  };

  return (
    <Layout user={user}>
      <div className="max-w-2xl mx-auto">
        <div className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800 p-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Notifications</h1>
          <div className="flex items-center gap-2">
            {notifications.some(n => !n.read) && (
              <Button
                data-testid="mark-all-read-button"
                onClick={handleMarkAllRead}
                variant="outline"
                size="sm"
                className="border-slate-700 text-cyan-500 hover:bg-slate-800"
              >
                Tout lire
              </Button>
            )}
            {notifications.length > 0 && (
              <Button
                onClick={handleClearAll}
                variant="outline"
                size="sm"
                className="border-slate-700 text-red-400 hover:bg-slate-800"
              >
                Tout effacer
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p>Aucune notification</p>
          </div>
        ) : (
          <div>
            {notifications.map((notif) => (
              <div
                key={notif.id}
                data-testid={`notification-${notif.id}`}
                onClick={() => handleNotificationClick(notif)}
                className={`flex items-start gap-3 p-4 border-b border-slate-800 hover:bg-slate-900 cursor-pointer ${
                  !notif.read ? 'bg-slate-900/50' : ''
                }`}
              >
                <div className="flex-shrink-0 mt-1">
                  {getNotificationIcon(notif.type)}
                </div>
                <Avatar className="flex-shrink-0">
                  <AvatarImage src={notif.from_profile_pic} />
                  <AvatarFallback className="bg-slate-700">
                    {notif.from_username[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold">{notif.from_username}</span>{' '}
                    <span className="text-slate-400">{getNotificationText(notif)}</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {new Date(notif.created_at).toLocaleString('fr-FR')}
                  </p>
                  {notif.type === 'follow_request' && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={(e) => handleAcceptRequest(e, notif)}
                        className="px-3 py-1 rounded-lg text-xs font-bold bg-cyan-500 text-slate-900 hover:opacity-90"
                      >
                        Accepter
                      </button>
                      <button
                        onClick={(e) => handleRejectRequest(e, notif)}
                        className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-300 hover:bg-slate-700"
                      >
                        Refuser
                      </button>
                    </div>
                  )}
                </div>
                {!notif.read && (
                  <div className="flex-shrink-0 w-2 h-2 bg-cyan-500 rounded-full mt-2"></div>
                )}
                <button
                  onClick={(e) => handleDelete(e, notif.id)}
                  className="flex-shrink-0 text-slate-500 hover:text-red-400 transition-colors p-1"
                  title="Supprimer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
