import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useNavigate } from "react-router-dom";
import { Heart, MessageCircle, UserPlus, Repeat, AtSign, TrendingUp, Trash2, Radio, Reply, Check, Settings, X, BellRing } from "lucide-react";
import { toast } from "sonner";
import NotificationSettings from "@/components/NotificationSettings";
import { enablePush, pushReasonLabel } from "@/lib/push";
import { buildMutedMatcher } from "@/lib/mutedWords";

// Onglets façon X/Instagram.
const TABS = [
  { key: "all",      label: "Tout" },
  { key: "mentions", label: "Mentions" },
  { key: "likes",    label: "Likes" },
  { key: "reposts",  label: "Reposts" },
  { key: "follows",  label: "Follows" },
];

const matchesTab = (n, tab) => {
  switch (tab) {
    case "mentions": return n.type === "mention";
    case "likes":    return ["like", "comment_like", "reaction"].includes(n.type);
    case "reposts":  return ["repost", "share"].includes(n.type);
    case "follows":  return ["follow", "follow_request", "follow_accepted"].includes(n.type);
    default:         return true; // "all"
  }
};

// Étiquette de jour pour le groupement (Aujourd'hui / Hier / jour / date).
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayLabel = (iso) => {
  const d = new Date(iso);
  const diff = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  const lng = i18n.language || undefined;
  if (diff <= 0) return i18n.t("notif.today");
  if (diff === 1) return i18n.t("notif.yesterday");
  if (diff < 7)  return d.toLocaleDateString(lng, { weekday: "long" });
  return d.toLocaleDateString(lng, { day: "numeric", month: "long" });
};
const timeLabel = (iso) =>
  new Date(iso).toLocaleTimeString(i18n.language || undefined, { hour: "2-digit", minute: "2-digit" });

const PAGE = 30;

export default function NotificationsPage({ user }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [showSettings, setShowSettings] = useState(false);
  const [followedBack, setFollowedBack] = useState(() => new Set());
  const [showPushBanner, setShowPushBanner] = useState(false);

  const skipRef = useRef(0);
  const sentinelRef = useRef(null);

  // Propose d'activer les notifications push si le navigateur le supporte et que
  // la permission n'a pas encore été demandée (ni refusée). Opt-in sur geste.
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window &&
        "PushManager" in window && Notification.permission === "default") {
      setShowPushBanner(true);
    }
  }, []);

  const handleEnablePush = async () => {
    const res = await enablePush({ interactive: true });
    if (res.ok) {
      toast.success(pushReasonLabel("ok"));
      setShowPushBanner(false);
    } else {
      (res.reason === "denied" ? toast.error : toast)(pushReasonLabel(res.reason));
      if (res.reason === "denied") setShowPushBanner(false);
    }
  };

  const fetchNotifications = async (reset = false) => {
    const skip = reset ? 0 : skipRef.current;
    if (reset) setLoading(true); else setLoadingMore(true);
    try {
      const res = await axios.get(`${API}/notifications`, { params: { skip, limit: PAGE } });
      const data = res.data || [];
      setNotifications((prev) =>
        reset ? data : [...prev, ...data.filter((d) => !prev.some((p) => p.id === d.id))]
      );
      skipRef.current = (reset ? 0 : skipRef.current) + data.length;
      setHasMore(data.length >= PAGE);
    } catch {
      if (reset) toast.error(t("notif.err_load"));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => { fetchNotifications(true); }, []);

  // Scroll infini.
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return undefined;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting && hasMore && !loadingMore) fetchNotifications(false); },
      { rootMargin: "300px" }
    );
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, notifications.length]);

  const handleMarkAllRead = async () => {
    try {
      await axios.put(`${API}/notifications/read-all`);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      window.dispatchEvent(new Event("nexus:badges"));
    } catch { toast.error(t("notif.err_action")); }
  };

  const handleNotificationClick = async (notification) => {
    if (!notification.read) {
      try {
        await axios.put(`${API}/notifications/${notification.id}/read`);
        setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)));
        window.dispatchEvent(new Event("nexus:badges"));
      } catch { /* silent */ }
    }
    if (notification.type === "live" && notification.post_id) {
      navigate(`/live/${notification.post_id}`);
    } else if (notification.post_id) {
      navigate(`/post/${notification.post_id}`);
    } else if (["follow", "follow_accepted", "follow_request"].includes(notification.type)) {
      navigate(`/profil/${notification.from_user_id}`);
    }
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    try {
      await axios.delete(`${API}/notifications/${id}`);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      window.dispatchEvent(new Event("nexus:badges"));
    } catch { toast.error(t("notif.err_delete")); }
  };

  const handleClearAll = async () => {
    if (!window.confirm(t("notif.confirm_clear_all"))) return;
    try {
      await axios.delete(`${API}/notifications`);
      setNotifications([]);
      skipRef.current = 0;
      setHasMore(false);
      window.dispatchEvent(new Event("nexus:badges"));
    } catch { toast.error(t("notif.err_delete")); }
  };

  const handleAcceptRequest = async (e, notif) => {
    e.stopPropagation();
    try {
      await axios.post(`${API}/follow-requests/${notif.from_user_id}/accept`);
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
      toast.success(t("notif.accepted_request", { user: notif.from_username }));
    } catch { toast.error(t("notif.err_generic")); }
  };

  const handleRejectRequest = async (e, notif) => {
    e.stopPropagation();
    try {
      await axios.post(`${API}/follow-requests/${notif.from_user_id}/reject`);
      setNotifications((prev) => prev.filter((n) => n.id !== notif.id));
    } catch { toast.error(t("notif.err_generic")); }
  };

  // Action rapide : s'abonner en retour (« follow back »).
  const handleFollowBack = async (e, notif) => {
    e.stopPropagation();
    try {
      await axios.post(`${API}/users/${notif.from_user_id}/follow`);
      setFollowedBack((prev) => new Set(prev).add(notif.from_user_id));
      toast.success(t("notif.now_following", { user: notif.from_username }));
    } catch { toast.error(t("notif.err_generic")); }
  };

  // Action rapide : répondre (ouvre la publication concernée).
  const handleReply = (e, notif) => {
    e.stopPropagation();
    if (notif.post_id) navigate(`/post/${notif.post_id}`);
    else if (notif.type === "reaction") navigate(`/messages/${notif.from_user_id}`);
  };

  const getIcon = (type) => {
    switch (type) {
      case "like":
      case "comment_like": return <Heart className="w-4 h-4 text-red-500" fill="currentColor" />;
      case "comment":
      case "comment_reply": return <MessageCircle className="w-4 h-4 text-blue-400" />;
      case "follow":
      case "follow_request":
      case "follow_accepted": return <UserPlus className="w-4 h-4 text-green-400" />;
      case "repost":
      case "share": return <Repeat className="w-4 h-4 text-purple-400" />;
      case "mention": return <AtSign className="w-4 h-4 text-cyan-400" />;
      case "trending": return <TrendingUp className="w-4 h-4 text-orange-400" />;
      case "reaction": return <span className="text-base leading-none">❤️</span>;
      case "live": return <Radio className="w-4 h-4 text-red-500" />;
      case "moderation": return <span className="text-base leading-none">⚠️</span>;
      case "tip": return <span className="text-base leading-none">💸</span>;
      default: return <Heart className="w-4 h-4 text-slate-400" />;
    }
  };

  const getText = (n) => {
    switch (n.type) {
      case "like":            return t("notif.like");
      case "comment":         return n.comment_content ? t("notif.comment_with", { content: n.comment_content }) : t("notif.comment");
      case "comment_like":    return t("notif.comment_like");
      case "comment_reply":   return n.comment_content ? t("notif.reply_with", { content: n.comment_content }) : t("notif.reply");
      case "follow":          return t("notif.follow");
      case "repost":          return t("notif.repost");
      case "mention":         return t("notif.mention");
      case "trending":        return t("notif.trending");
      case "reaction":        return t("notif.reaction", { emoji: n.comment_content || "" });
      case "follow_request":  return t("notif.follow_request");
      case "follow_accepted": return t("notif.follow_accepted");
      case "live":            return t("notif.live");
      case "moderation":      return n.comment_content || t("notif.moderation");
      case "tip":             return n.comment_content || t("notif.tip");
      default:                return "";
    }
  };

  // Mots masqués : on retire aussi les notifications dont le texte (ex. contenu
  // d'un commentaire) correspond à un mot masqué.
  const filtered = useMemo(() => {
    const muteMatch = buildMutedMatcher(user?.muted_words || []);
    return notifications.filter(
      (n) => matchesTab(n, activeTab) && !muteMatch(n.comment_content)
    );
  }, [notifications, activeTab, user?.muted_words]);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const accent = "var(--nexus-accent, #22d3ee)";

  return (
    <Layout user={user} hideMobileHeader>
      <div className="max-w-2xl mx-auto min-h-screen" style={{ background: "#0b1326" }}>
        {/* Barre d'onglets (pas de gros header) — sticky, façon X. */}
        <div className="sticky top-0 z-20 backdrop-blur-xl border-b" style={{ background: "rgba(11,19,38,0.85)", borderColor: "rgba(255,255,255,0.06)" }}>
          <div className="flex items-center justify-between px-2 pt-safe-2">
            <div className="flex-1 flex gap-1 overflow-x-auto no-scrollbar">
              {TABS.map((tab) => {
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className="relative px-3 py-2 text-sm font-bold whitespace-nowrap transition-colors"
                    style={{ color: active ? "#dae2fd" : "#859397" }}
                  >
                    {t("notif.tab_"+tab.key)}
                    {active && <span className="absolute left-2 right-2 -bottom-[1px] h-[3px] rounded-full" style={{ background: accent }} />}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1 pl-1">
              {unreadCount > 0 && (
                <button onClick={handleMarkAllRead} title={t("notif.mark_all_read")}
                  className="p-2 rounded-full hover:bg-white/5 transition-colors" style={{ color: accent }}>
                  <Check className="w-5 h-5" />
                </button>
              )}
              {notifications.length > 0 && (
                <button onClick={handleClearAll} title={t("notif.clear_all")}
                  className="p-2 rounded-full hover:bg-white/5 transition-colors text-slate-500 hover:text-red-400">
                  <Trash2 className="w-5 h-5" />
                </button>
              )}
              <button onClick={() => setShowSettings(true)} title={t("notif.notif_settings")}
                className="p-2 rounded-full hover:bg-white/5 transition-colors text-slate-400 hover:text-slate-200">
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {showSettings && <NotificationSettings onClose={() => setShowSettings(false)} />}

        {/* Bandeau opt-in push (notifications même app fermée). */}
        {showPushBanner && (
          <div className="mx-3 mt-3 flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{ background: "#171f33", border: "1px solid #3c494c" }}>
            <BellRing className="w-5 h-5 flex-shrink-0" style={{ color: accent }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold" style={{ color: "#dae2fd" }}>{t("notif.push_enable")}</p>
              <p className="text-xs" style={{ color: "#859397" }}>{t("notif.push_enable_sub")}</p>
            </div>
            <button onClick={handleEnablePush}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 flex-shrink-0"
              style={{ background: accent, color: "#00363e" }}>
              Activer
            </button>
            <button onClick={() => setShowPushBanner(false)} className="p-1 flex-shrink-0" style={{ color: "#859397" }} title={t("notif.later")}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2" style={{ borderColor: accent }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <p className="text-lg font-semibold mb-1" style={{ color: "#dae2fd" }}>{t("notif.empty")}</p>
            <p className="text-sm">Aucune notification dans « {TABS.find((t) => t.key === activeTab)?.label} ».</p>
          </div>
        ) : (
          <div>
            {filtered.map((notif, i) => {
              const label = dayLabel(notif.created_at);
              const showHeader = i === 0 || dayLabel(filtered[i - 1].created_at) !== label;
              const isFollow = ["follow", "follow_accepted"].includes(notif.type);
              const canReply = ["comment", "comment_reply", "mention"].includes(notif.type);
              return (
                <div key={notif.id}>
                  {showHeader && (
                    <div className="px-4 py-1.5 text-xs font-bold uppercase tracking-wide sticky top-[42px] z-10 backdrop-blur-xl"
                      style={{ color: "#859397", background: "rgba(11,19,38,0.85)" }}>
                      {label}
                    </div>
                  )}
                  <div
                    data-testid={`notification-${notif.id}`}
                    onClick={() => handleNotificationClick(notif)}
                    className="group flex items-start gap-3 px-4 py-3 border-b cursor-pointer transition-colors"
                    style={{
                      borderColor: "rgba(255,255,255,0.05)",
                      background: !notif.read ? "rgba(34,211,238,0.06)" : "transparent",
                      borderLeft: !notif.read ? `3px solid ${accent}` : "3px solid transparent",
                    }}
                  >
                    <div className="relative flex-shrink-0">
                      <Avatar className="w-11 h-11">
                        <AvatarImage src={notif.from_profile_pic} />
                        <AvatarFallback className="bg-slate-700 text-slate-200">
                          {notif.from_username?.[0]?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#0b1326" }}>
                        {getIcon(notif.type)}
                      </span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug" style={{ color: "#dae2fd" }}>
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/profil/${notif.from_user_id}`); }}
                          className="font-bold hover:underline"
                        >
                          {notif.from_username}
                        </button>{" "}
                        <span style={{ color: "#bbc9cd" }}>{getText(notif)}</span>
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "#5c6b73" }}>{timeLabel(notif.created_at)}</p>

                      {/* Demande d'abonnement : accepter / refuser */}
                      {notif.type === "follow_request" && (
                        <div className="flex gap-2 mt-2">
                          <button onClick={(e) => handleAcceptRequest(e, notif)}
                            className="px-3 py-1 rounded-full text-xs font-bold hover:opacity-90" style={{ background: accent, color: "#00363e" }}>
                            Accepter
                          </button>
                          <button onClick={(e) => handleRejectRequest(e, notif)}
                            className="px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-300 hover:bg-slate-700">
                            Refuser
                          </button>
                        </div>
                      )}

                      {/* Actions rapides : suivre en retour / répondre */}
                      {isFollow && (
                        <div className="flex gap-2 mt-2">
                          {followedBack.has(notif.from_user_id) ? (
                            <span className="px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-400">{t("notif.followed")}</span>
                          ) : (
                            <button onClick={(e) => handleFollowBack(e, notif)}
                              className="px-3 py-1 rounded-full text-xs font-bold hover:opacity-90 flex items-center gap-1" style={{ background: accent, color: "#00363e" }}>
                              <UserPlus className="w-3.5 h-3.5" /> Suivre en retour
                            </button>
                          )}
                        </div>
                      )}
                      {canReply && (
                        <div className="flex gap-2 mt-2">
                          <button onClick={(e) => handleReply(e, notif)}
                            className="px-3 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1">
                            <Reply className="w-3.5 h-3.5" /> Répondre
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Supprimer (visible au survol sur PC). */}
                    <button
                      onClick={(e) => handleDelete(e, notif.id)}
                      className="flex-shrink-0 text-slate-600 hover:text-red-400 transition-all p-1 lg:opacity-0 lg:group-hover:opacity-100"
                      title={t("notif.delete")}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Sentinelle de scroll infini. */}
            <div ref={sentinelRef} className="h-10 flex items-center justify-center">
              {loadingMore && <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: accent }} />}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
