import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNavigate } from "react-router-dom";
import { Heart, MessageCircle, UserPlus, Share2 } from "lucide-react";
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

    if (notification.post_id) {
      navigate(`/post/${notification.post_id}`);
    } else if (notification.type === 'follow') {
      navigate(`/profile/${notification.from_user_id}`);
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'like':
        return <Heart className="w-5 h-5 text-red-500" fill="currentColor" />;
      case 'comment':
        return <MessageCircle className="w-5 h-5 text-blue-500" />;
      case 'follow':
        return <UserPlus className="w-5 h-5 text-green-500" />;
      case 'share':
        return <Share2 className="w-5 h-5 text-purple-500" />;
      default:
        return null;
    }
  };

  return (
    <Layout user={user}>
      <div className="max-w-2xl mx-auto">
        <div className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-xl border-b border-slate-800 p-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Notifications</h1>
          {notifications.some(n => !n.read) && (
            <Button
              data-testid="mark-all-read-button"
              onClick={handleMarkAllRead}
              variant="outline"
              size="sm"
              className="border-slate-700 text-cyan-500 hover:bg-slate-800"
            >
              Tout marquer comme lu
            </Button>
          )}
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
                    <span className="text-slate-400">{notif.message}</span>
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {new Date(notif.created_at).toLocaleString('fr-FR')}
                  </p>
                </div>
                {!notif.read && (
                  <div className="flex-shrink-0 w-2 h-2 bg-cyan-500 rounded-full"></div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
