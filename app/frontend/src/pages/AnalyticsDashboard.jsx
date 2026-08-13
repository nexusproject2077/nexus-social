// AnalyticsDashboard.jsx - Tableau de bord personnel du créateur
// Chaque utilisateur voit uniquement les statistiques de SON PROPRE compte.

import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Users,
  UserPlus,
  FileText,
  MessageSquare,
  Heart,
  Eye,
  TrendingUp,
  Activity,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";

export default function AnalyticsDashboard({ user, setUser }) {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");

  const [stats, setStats] = useState(null);
  const [trends, setTrends] = useState([]);
  const [topPosts, setTopPosts] = useState([]);
  const [hourlyActivity, setHourlyActivity] = useState([]);
  const [tips, setTips] = useState(null); // { total_amount, count, tips: [...] }

  useEffect(() => {
    loadAllData();
    const interval = setInterval(loadAllData, 30000); // Rafraîchir toutes les 30s
    return () => clearInterval(interval);
  }, []);

  const loadAllData = async () => {
    try {
      setLoading(true);
      const [statsRes, trendsRes, postsRes, activityRes] = await Promise.all([
        axios.get(`${API}/analytics/me/stats`),
        axios.get(`${API}/analytics/me/trends?days=30`),
        axios.get(`${API}/analytics/me/top-posts?limit=10`),
        axios.get(`${API}/analytics/me/activity/hourly?days=30`),
      ]);

      setStats(statsRes.data);
      setTrends(trendsRes.data);
      setTopPosts(postsRes.data);

      // Transforme l'activité horaire en {hour, posts, comments, likes}
      const byHour = {};
      activityRes.data.forEach((item) => {
        if (!byHour[item.hour]) {
          byHour[item.hour] = { hour: item.hour, posts: 0, comments: 0, likes: 0 };
        }
        byHour[item.hour][item.type] = item.activity_count;
      });
      setHourlyActivity(Object.values(byHour));

      // Pourboires reçus (facultatif : ne bloque pas le tableau de bord).
      axios.get(`${API}/users/me/tips`).then((r) => setTips(r.data)).catch(() => {});
    } catch (error) {
      console.error("Erreur chargement données:", error);
      toast.error("Erreur de chargement des données");
    } finally {
      setLoading(false);
    }
  };

  if (loading && !stats) {
    return (
      <Layout user={user} setUser={setUser} compact>
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <Activity className="h-12 w-12 text-cyan-500 animate-pulse mx-auto mb-4" />
            <p className="text-slate-400">Chargement de vos statistiques...</p>
          </div>
        </div>
      </Layout>
    );
  }

  const kpis = [
    { icon: FileText, color: "text-blue-500", label: "Publications", value: stats?.total_posts, badge: stats?.posts_today ? `+${stats.posts_today}` : null },
    { icon: Heart, color: "text-red-500", label: "Likes reçus", value: stats?.total_likes, badge: null },
    { icon: MessageSquare, color: "text-purple-500", label: "Commentaires", value: stats?.total_comments, badge: null },
    { icon: Users, color: "text-cyan-500", label: "Abonnés", value: stats?.followers_count, badge: stats?.new_followers_today ? `+${stats.new_followers_today}` : null },
    { icon: Eye, color: "text-green-500", label: "Vues", value: stats?.total_views, badge: null },
  ];

  return (
    <Layout user={user} setUser={setUser} compact>
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4 pb-20">
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <h1
            className="text-xl sm:text-2xl font-bold text-white mb-0.5"
            style={{ fontFamily: "Space Grotesk, sans-serif" }}
          >
            Mes statistiques
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm">
            Les performances de votre compte @{user?.username}
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 mb-4 sm:mb-6 h-auto">
            <TabsTrigger value="overview" className="text-[11px] sm:text-sm py-2">
              <BarChart3 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              Vue d'ensemble
            </TabsTrigger>
            <TabsTrigger value="trends" className="text-[11px] sm:text-sm py-2">
              <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              Croissance
            </TabsTrigger>
            <TabsTrigger value="top" className="text-[11px] sm:text-sm py-2">
              <Activity className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              Top posts
            </TabsTrigger>
          </TabsList>

          {/* Vue d'ensemble */}
          <TabsContent value="overview" className="space-y-3 sm:space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-4">
              {kpis.map((kpi) => (
                <Card key={kpi.label} className="bg-slate-900 border-slate-800">
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-center justify-between mb-1 sm:mb-2">
                      <kpi.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${kpi.color}`} />
                      {kpi.badge && (
                        <Badge variant="secondary" className="text-[9px] sm:text-xs">{kpi.badge}</Badge>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-slate-400">{kpi.label}</p>
                    <p className="text-lg sm:text-2xl font-bold text-white">
                      {(kpi.value ?? 0).toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Pourboires reçus */}
            {tips && (
              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-cyan-400">volunteer_activism</span>
                      <p className="text-sm font-semibold text-white">Pourboires reçus</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg sm:text-2xl font-bold text-white">
                        {(tips.total_amount / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                      </p>
                      <p className="text-[11px] text-slate-400">{tips.count} pourboire{tips.count > 1 ? "s" : ""}</p>
                    </div>
                  </div>
                  {tips.tips?.length > 0 ? (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto">
                      {tips.tips.map((t) => (
                        <div key={t.id} className="flex items-center justify-between text-sm py-1.5 px-2 rounded-lg bg-slate-800/50">
                          <span className="text-slate-300 truncate">@{t.from_username}</span>
                          <span className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-[11px] text-slate-500">
                              {t.created_at ? new Date(t.created_at).toLocaleDateString() : ""}
                            </span>
                            <span className="font-bold text-cyan-400">
                              {(t.amount_total / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">Aucun pourboire reçu pour l'instant. Activez les pourboires dans les Paramètres pour en recevoir.</p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Bandeau engagement */}
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4 flex items-center gap-3">
                <Activity className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-xs sm:text-sm text-slate-400">Taux d'engagement moyen</p>
                  <p className="text-lg sm:text-xl font-bold text-white">
                    {stats?.engagement_rate ?? 0} interactions / publication
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Activité de l'audience par heure */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">Activité de votre audience par heure</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Quand votre contenu reçoit des likes et commentaires (30 derniers jours)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={hourlyActivity}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="hour" stroke="#94a3b8" style={{ fontSize: "11px" }} />
                    <YAxis stroke="#94a3b8" style={{ fontSize: "11px" }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
                      labelStyle={{ color: "#e2e8f0" }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar dataKey="likes" fill="#ec4899" name="Likes reçus" />
                    <Bar dataKey="comments" fill="#8b5cf6" name="Commentaires" />
                    <Bar dataKey="posts" fill="#06b6d4" name="Mes posts" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Croissance */}
          <TabsContent value="trends" className="space-y-3 sm:space-y-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">Votre croissance (30 derniers jours)</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Publications, likes et commentaires reçus, nouveaux abonnés
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" stroke="#94a3b8" style={{ fontSize: "10px" }} />
                    <YAxis stroke="#94a3b8" style={{ fontSize: "10px" }} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }}
                      labelStyle={{ color: "#e2e8f0" }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Line type="monotone" dataKey="followers" stroke="#06b6d4" name="Nouveaux abonnés" strokeWidth={2} />
                    <Line type="monotone" dataKey="posts" stroke="#3b82f6" name="Publications" strokeWidth={2} />
                    <Line type="monotone" dataKey="likes" stroke="#ec4899" name="Likes reçus" strokeWidth={2} />
                    <Line type="monotone" dataKey="comments" stroke="#f59e0b" name="Commentaires" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Top posts */}
          <TabsContent value="top" className="space-y-3 sm:space-y-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">Vos meilleures publications</CardTitle>
                <CardDescription className="text-xs sm:text-sm">Classées par engagement</CardDescription>
              </CardHeader>
              <CardContent>
                {topPosts.length === 0 ? (
                  <div className="text-center py-6 sm:py-8">
                    <FileText className="h-10 w-10 sm:h-12 sm:w-12 text-slate-600 mx-auto mb-2 sm:mb-3" />
                    <p className="text-slate-400 text-xs sm:text-sm">
                      Publiez du contenu pour voir vos meilleures performances ici
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 sm:space-y-3">
                    {topPosts.map((post, index) => (
                      <div key={post.post_id} className="p-2 sm:p-3 bg-slate-800/50 rounded-lg">
                        <div className="flex items-start gap-2 sm:gap-3 mb-1.5 sm:mb-2">
                          <div className="flex-shrink-0 w-6 h-6 sm:w-8 sm:h-8 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-full flex items-center justify-center text-white font-bold text-xs sm:text-sm">
                            {index + 1}
                          </div>
                          <p className="flex-1 min-w-0 text-xs sm:text-sm text-slate-200 line-clamp-2">
                            {post.content || "(sans texte)"}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 sm:gap-4 text-[10px] sm:text-xs text-slate-400 ml-8 sm:ml-11">
                          <span className="flex items-center gap-1">
                            <Heart className="h-3 w-3" /> {post.likes_count}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" /> {post.comments_count}
                          </span>
                          <span className="flex items-center gap-1">
                            <Eye className="h-3 w-3" /> {post.views}
                          </span>
                          <Badge variant="secondary" className="text-[9px] sm:text-xs ml-auto">
                            {Math.round(post.engagement_score)} pts
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Rappel abonnements */}
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4 flex items-center gap-3">
                <UserPlus className="h-5 w-5 text-cyan-500" />
                <p className="text-xs sm:text-sm text-slate-400">
                  Vous suivez <span className="text-white font-semibold">{stats?.following_count ?? 0}</span> comptes ·{" "}
                  <span className="text-white font-semibold">{stats?.followers_count ?? 0}</span> abonnés
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
