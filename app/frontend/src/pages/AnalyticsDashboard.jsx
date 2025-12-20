// AnalyticsDashboard.jsx - Dashboard d'analytics et automatisation

import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Users,
  FileText,
  MessageSquare,
  Heart,
  UserPlus,
  TrendingUp,
  Activity,
  Shield,
  Bell,
  Download,
  Play,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  Ban,
  Send,
  BarChart3,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";

const COLORS = ['#06b6d4', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];

export default function AnalyticsDashboard({ user, setUser }) {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");
  
  // Stats
  const [globalStats, setGlobalStats] = useState(null);
  const [trends, setTrends] = useState([]);
  const [topUsers, setTopUsers] = useState([]);
  const [topPosts, setTopPosts] = useState([]);
  const [hourlyActivity, setHourlyActivity] = useState([]);
  const [suspiciousAccounts, setSuspiciousAccounts] = useState([]);
  
  // Notification modal
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [notifTitle, setNotifTitle] = useState("");
  const [notifMessage, setNotifMessage] = useState("");
  const [notifType, setNotifType] = useState("info");
  const [sendingNotif, setSendingNotif] = useState(false);

  useEffect(() => {
    loadAllData();
    const interval = setInterval(loadAllData, 30000); // Rafraîchir toutes les 30s
    return () => clearInterval(interval);
  }, []);

  const loadAllData = async () => {
    try {
      setLoading(true);
      
      // Charger toutes les données en parallèle
      const [
        statsRes,
        trendsRes,
        usersRes,
        postsRes,
        activityRes,
        suspiciousRes,
      ] = await Promise.all([
        axios.get(`${API}/analytics/stats/global`),
        axios.get(`${API}/analytics/trends?days=30`),
        axios.get(`${API}/analytics/top/users?limit=10`),
        axios.get(`${API}/analytics/top/posts?limit=10&days=7`),
        axios.get(`${API}/analytics/activity/hourly?days=7`),
        axios.get(`${API}/analytics/suspicious/accounts?status=pending`),
      ]);

      setGlobalStats(statsRes.data);
      setTrends(trendsRes.data);
      setTopUsers(usersRes.data);
      setTopPosts(postsRes.data);
      
      // Transformer les données d'activité horaire
      const activityByHour = {};
      activityRes.data.forEach(item => {
        if (!activityByHour[item.hour]) {
          activityByHour[item.hour] = { hour: item.hour, posts: 0, comments: 0, likes: 0 };
        }
        activityByHour[item.hour][item.type] = item.activity_count;
      });
      setHourlyActivity(Object.values(activityByHour));
      
      setSuspiciousAccounts(suspiciousRes.data);
      
    } catch (error) {
      console.error("Erreur chargement données:", error);
      toast.error("Erreur de chargement des données");
    } finally {
      setLoading(false);
    }
  };

  const runAutomation = async () => {
    try {
      await axios.post(`${API}/analytics/automation/run`);
      toast.success("Tâches d'automatisation lancées !");
      setTimeout(loadAllData, 3000);
    } catch (error) {
      toast.error("Erreur lancement automatisation");
    }
  };

  const blockAccount = async (userId) => {
    try {
      await axios.post(`${API}/analytics/suspicious/block/${userId}`);
      toast.success("Compte bloqué");
      loadAllData();
    } catch (error) {
      toast.error("Erreur blocage compte");
    }
  };

  const clearAccount = async (userId) => {
    try {
      await axios.post(`${API}/analytics/suspicious/clear/${userId}`);
      toast.success("Compte marqué comme sûr");
      loadAllData();
    } catch (error) {
      toast.error("Erreur");
    }
  };

  const sendNotification = async () => {
    if (!notifTitle || !notifMessage) {
      toast.error("Remplissez tous les champs");
      return;
    }

    setSendingNotif(true);
    try {
      await axios.post(`${API}/analytics/notifications/send`, {
        title: notifTitle,
        message: notifMessage,
        type: notifType,
      });
      toast.success("Notifications envoyées !");
      setShowNotifModal(false);
      setNotifTitle("");
      setNotifMessage("");
    } catch (error) {
      toast.error("Erreur envoi notifications");
    } finally {
      setSendingNotif(false);
    }
  };

  const exportData = async (type) => {
    try {
      const response = await axios.get(`${API}/analytics/export/${type}`);
      const dataStr = JSON.stringify(response.data, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });
      const url = window.URL.createObjectURL(dataBlob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${type}_export_${new Date().toISOString().split('T')[0]}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success("Export téléchargé !");
    } catch (error) {
      toast.error("Erreur export");
    }
  };

  if (loading && !globalStats) {
    return (
      <Layout user={user} setUser={setUser}>
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <Activity className="h-12 w-12 text-cyan-500 animate-pulse mx-auto mb-4" />
            <p className="text-slate-400">Chargement des analytics...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout user={user} setUser={setUser}>
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4 pb-20">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div>
            <h1
              className="text-xl sm:text-2xl font-bold text-white mb-0.5"
              style={{ fontFamily: "Space Grotesk, sans-serif" }}
            >
              Analytics & Automatisation
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm">
              Tableau de bord complet de votre réseau social
            </p>
          </div>
          
          <div className="flex gap-2 w-full sm:w-auto">
            <Button
              onClick={runAutomation}
              size="sm"
              className="flex-1 sm:flex-initial bg-gradient-to-r from-purple-500 to-pink-500 h-8 sm:h-9 text-xs sm:text-sm"
            >
              <Play className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
              Auto
            </Button>
            <Button
              onClick={() => setShowNotifModal(true)}
              size="sm"
              className="flex-1 sm:flex-initial bg-gradient-to-r from-cyan-500 to-blue-500 h-8 sm:h-9 text-xs sm:text-sm"
            >
              <Bell className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
              Notifs
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4 mb-4 sm:mb-6 h-auto">
            <TabsTrigger value="overview" className="text-[10px] sm:text-sm py-2">
              <BarChart3 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Vue d'ensemble</span>
              <span className="sm:hidden">Vue</span>
            </TabsTrigger>
            <TabsTrigger value="trends" className="text-[10px] sm:text-sm py-2">
              <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Tendances</span>
              <span className="sm:hidden">Trend</span>
            </TabsTrigger>
            <TabsTrigger value="top" className="text-[10px] sm:text-sm py-2">
              <Activity className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Top</span>
              <span className="sm:hidden">Top</span>
            </TabsTrigger>
            <TabsTrigger value="security" className="text-[10px] sm:text-sm py-2">
              <Shield className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              <span className="hidden sm:inline">Sécurité</span>
              <span className="sm:hidden">Sécu</span>
            </TabsTrigger>
          </TabsList>

          {/* Vue d'ensemble */}
          <TabsContent value="overview" className="space-y-3 sm:space-y-4">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-4">
              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-1 sm:mb-2">
                    <Users className="h-4 w-4 sm:h-5 sm:w-5 text-cyan-500" />
                    <Badge variant="secondary" className="text-[9px] sm:text-xs">+{globalStats?.new_users_today}</Badge>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-400">Utilisateurs</p>
                  <p className="text-lg sm:text-2xl font-bold text-white">{globalStats?.total_users?.toLocaleString()}</p>
                </CardContent>
              </Card>

              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-1 sm:mb-2">
                    <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-blue-500" />
                    <Badge variant="secondary" className="text-[9px] sm:text-xs">+{globalStats?.posts_today}</Badge>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-400">Posts</p>
                  <p className="text-lg sm:text-2xl font-bold text-white">{globalStats?.total_posts?.toLocaleString()}</p>
                </CardContent>
              </Card>

              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-1 sm:mb-2">
                    <MessageSquare className="h-4 w-4 sm:h-5 sm:w-5 text-purple-500" />
                  </div>
                  <p className="text-xs sm:text-sm text-slate-400">Commentaires</p>
                  <p className="text-lg sm:text-2xl font-bold text-white">{globalStats?.total_comments?.toLocaleString()}</p>
                </CardContent>
              </Card>

              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-1 sm:mb-2">
                    <Heart className="h-4 w-4 sm:h-5 sm:w-5 text-red-500" />
                  </div>
                  <p className="text-xs sm:text-sm text-slate-400">Likes</p>
                  <p className="text-lg sm:text-2xl font-bold text-white">{globalStats?.total_likes?.toLocaleString()}</p>
                </CardContent>
              </Card>

              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-1 sm:mb-2">
                    <Activity className="h-4 w-4 sm:h-5 sm:w-5 text-green-500" />
                  </div>
                  <p className="text-xs sm:text-sm text-slate-400">Engagement</p>
                  <p className="text-lg sm:text-2xl font-bold text-white">{globalStats?.engagement_rate}%</p>
                </CardContent>
              </Card>
            </div>

            {/* Activité par heure */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">Activité par heure (7 derniers jours)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={hourlyActivity}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="hour" stroke="#94a3b8" style={{ fontSize: '11px' }} />
                    <YAxis stroke="#94a3b8" style={{ fontSize: '11px' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                      labelStyle={{ color: '#e2e8f0' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="posts" fill="#06b6d4" name="Posts" />
                    <Bar dataKey="comments" fill="#8b5cf6" name="Commentaires" />
                    <Bar dataKey="likes" fill="#ec4899" name="Likes" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Export */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">Export de données</CardTitle>
                <CardDescription className="text-xs sm:text-sm">Télécharger vos données</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button onClick={() => exportData('users')} size="sm" variant="outline" className="text-xs sm:text-sm">
                  <Download className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
                  Utilisateurs
                </Button>
                <Button onClick={() => exportData('posts')} size="sm" variant="outline" className="text-xs sm:text-sm">
                  <Download className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
                  Publications
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tendances */}
          <TabsContent value="trends" className="space-y-3 sm:space-y-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">Croissance (30 derniers jours)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" stroke="#94a3b8" style={{ fontSize: '10px' }} />
                    <YAxis stroke="#94a3b8" style={{ fontSize: '10px' }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                      labelStyle={{ color: '#e2e8f0' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line type="monotone" dataKey="users" stroke="#06b6d4" name="Nouveaux users" strokeWidth={2} />
                    <Line type="monotone" dataKey="posts" stroke="#8b5cf6" name="Posts" strokeWidth={2} />
                    <Line type="monotone" dataKey="comments" stroke="#ec4899" name="Commentaires" strokeWidth={2} />
                    <Line type="monotone" dataKey="likes" stroke="#f59e0b" name="Likes" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Top */}
          <TabsContent value="top" className="space-y-3 sm:space-y-4">
            {/* Top Users */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">Top Utilisateurs</CardTitle>
                <CardDescription className="text-xs sm:text-sm">Meilleur engagement</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 sm:space-y-3">
                  {topUsers.map((user, index) => (
                    <div
                      key={user.user_id}
                      className="flex items-center justify-between p-2 sm:p-3 bg-slate-800/50 rounded-lg"
                    >
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                        <div className="flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-full flex items-center justify-center text-white font-bold text-xs sm:text-sm">
                          {index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs sm:text-sm font-medium text-white truncate">@{user.username}</p>
                          <p className="text-[10px] sm:text-xs text-slate-400">
                            {user.posts_count} posts · {user.followers_count} abonnés
                          </p>
                        </div>
                      </div>
                      <Badge className="text-[9px] sm:text-xs">{Math.round(user.engagement_score)} pts</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Top Posts */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">Top Publications (7 jours)</CardTitle>
                <CardDescription className="text-xs sm:text-sm">Plus d'engagement</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 sm:space-y-3">
                  {topPosts.map((post, index) => (
                    <div
                      key={post.post_id}
                      className="p-2 sm:p-3 bg-slate-800/50 rounded-lg"
                    >
                      <div className="flex items-start gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                        <div className="flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-xs sm:text-sm">
                          {index + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs sm:text-sm font-medium text-white">@{post.author}</p>
                          <p className="text-[10px] sm:text-xs text-slate-400 line-clamp-2">{post.content}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 sm:gap-4 text-[10px] sm:text-xs text-slate-400 ml-8 sm:ml-11">
                        <span className="flex items-center gap-1">
                          <Heart className="h-3 w-3" /> {post.likes_count}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" /> {post.comments_count}
                        </span>
                        <Badge variant="secondary" className="text-[9px] sm:text-xs ml-auto">{Math.round(post.engagement_score)} pts</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Sécurité */}
          <TabsContent value="security" className="space-y-3 sm:space-y-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-orange-500" />
                  Comptes suspects détectés ({suspiciousAccounts.length})
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Comptes avec comportement anormal
                </CardDescription>
              </CardHeader>
              <CardContent>
                {suspiciousAccounts.length === 0 ? (
                  <div className="text-center py-6 sm:py-8">
                    <CheckCircle className="h-10 w-10 sm:h-12 sm:w-12 text-green-500 mx-auto mb-2 sm:mb-3" />
                    <p className="text-slate-400 text-xs sm:text-sm">Aucun compte suspect détecté</p>
                  </div>
                ) : (
                  <div className="space-y-2 sm:space-y-3">
                    {suspiciousAccounts.map((account) => (
                      <div
                        key={account.user_id}
                        className="p-2 sm:p-3 bg-orange-950/20 border border-orange-900/50 rounded-lg"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5 sm:mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs sm:text-sm font-medium text-white">@{account.username}</p>
                            <p className="text-[10px] sm:text-xs text-orange-400">{account.reason}</p>
                            <p className="text-[10px] sm:text-xs text-slate-500 mt-1">
                              Score: {account.score} · {new Date(account.detected_at).toLocaleString('fr-FR')}
                            </p>
                          </div>
                          <Badge variant="destructive" className="text-[9px] sm:text-xs">{account.status}</Badge>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={() => blockAccount(account.user_id)}
                            size="sm"
                            variant="destructive"
                            className="flex-1 h-7 sm:h-8 text-[10px] sm:text-xs"
                          >
                            <Ban className="h-3 w-3 mr-1" />
                            Bloquer
                          </Button>
                          <Button
                            onClick={() => clearAccount(account.user_id)}
                            size="sm"
                            variant="outline"
                            className="flex-1 h-7 sm:h-8 text-[10px] sm:text-xs"
                          >
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Marquer OK
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Modal Notifications */}
        <Dialog open={showNotifModal} onOpenChange={setShowNotifModal}>
          <DialogContent className="bg-slate-900 border-slate-800 text-white w-[92vw] sm:w-[95vw] max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base sm:text-lg">Envoyer des notifications</DialogTitle>
              <DialogDescription className="text-xs sm:text-sm">
                Sera envoyé à tous les utilisateurs actifs
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 sm:space-y-4">
              <div>
                <Label className="text-xs sm:text-sm">Titre</Label>
                <Input
                  value={notifTitle}
                  onChange={(e) => setNotifTitle(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white mt-1.5 h-9 sm:h-10 text-xs sm:text-sm"
                  placeholder="Titre de la notification"
                />
              </div>
              <div>
                <Label className="text-xs sm:text-sm">Message</Label>
                <Textarea
                  value={notifMessage}
                  onChange={(e) => setNotifMessage(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white mt-1.5 text-xs sm:text-sm"
                  placeholder="Votre message..."
                  rows={3}
                />
              </div>
              <div>
                <Label className="text-xs sm:text-sm">Type</Label>
                <Select value={notifType} onValueChange={setNotifType}>
                  <SelectTrigger className="bg-slate-800 border-slate-700 text-white mt-1.5 h-9 sm:h-10 text-xs sm:text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    <SelectItem value="info" className="text-xs sm:text-sm">Info</SelectItem>
                    <SelectItem value="success" className="text-xs sm:text-sm">Succès</SelectItem>
                    <SelectItem value="warning" className="text-xs sm:text-sm">Attention</SelectItem>
                    <SelectItem value="promo" className="text-xs sm:text-sm">Promo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button
                variant="outline"
                onClick={() => setShowNotifModal(false)}
                className="w-full flex-1 h-9 sm:h-10 text-xs sm:text-sm"
              >
                Annuler
              </Button>
              <Button
                onClick={sendNotification}
                disabled={sendingNotif}
                className="w-full flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 h-9 sm:h-10 text-xs sm:text-sm"
              >
                <Send className="h-3 w-3 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
                {sendingNotif ? "Envoi..." : "Envoyer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
