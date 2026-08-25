// AnalyticsDashboard.jsx - Tableau de bord personnel du créateur
// Chaque utilisateur voit uniquement les statistiques de SON PROPRE compte.

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
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
import { useTranslation, Trans } from "react-i18next";

export default function AnalyticsDashboard({ user, setUser }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("overview");

  const [stats, setStats] = useState(null);
  const [trends, setTrends] = useState([]);
  const [topPosts, setTopPosts] = useState([]);
  const [hourlyActivity, setHourlyActivity] = useState([]);
  // Défaut non-null → la section revenus reste TOUJOURS visible (même si le
  // chargement échoue lors d'un réveil serveur, on affiche 0 € au lieu de rien).
  const [tips, setTips] = useState({ total_amount: 0, count: 0, tips: [] });

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
            <p className="text-slate-400">{t("analytics.loading")}</p>
          </div>
        </div>
      </Layout>
    );
  }

  const kpis = [
    { icon: FileText, color: "text-blue-500", label: t("analytics.kpi_posts"), value: stats?.total_posts, badge: stats?.posts_today ? `+${stats.posts_today}` : null },
    { icon: Heart, color: "text-red-500", label: t("analytics.kpi_likes"), value: stats?.total_likes, badge: null },
    { icon: MessageSquare, color: "text-purple-500", label: t("analytics.kpi_comments"), value: stats?.total_comments, badge: null },
    { icon: Users, color: "text-cyan-500", label: t("analytics.kpi_followers"), value: stats?.followers_count, badge: stats?.new_followers_today ? `+${stats.new_followers_today}` : null },
    { icon: Eye, color: "text-green-500", label: t("analytics.kpi_views"), value: stats?.total_views, badge: null },
  ];

  // Formatage montants (centimes → « X,XX € ») et dates (relatif court).
  const eur = (cents) => (Number(cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  const fmtDate = (iso) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      const days = Math.floor((Date.now() - d.getTime()) / 86400000);
      if (days <= 0) return t("analytics.today");
      if (days === 1) return t("analytics.yesterday");
      if (days < 7) return t("analytics.days_ago", { days });
      return d.toLocaleDateString();
    } catch { return ""; }
  };

  return (
    <Layout user={user} setUser={setUser} compact>
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4 pb-20">
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          <h1
            className="text-xl sm:text-2xl font-bold text-white mb-0.5"
            style={{ fontFamily: "Space Grotesk, sans-serif" }}
          >
            {t("analytics.title")}
          </h1>
          <p className="text-slate-400 text-xs sm:text-sm">
            {t("analytics.subtitle", { username: user?.username })}
          </p>
          {/* Accès admin : tableau de bord « santé de l'app » (DAU, rétention…). */}
          {user?.is_admin && (
            <Link
              to="/admin"
              className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-90"
              style={{ background: "rgba(34,211,238,0.12)", color: "#22d3ee" }}
            >
              <span className="material-symbols-outlined text-sm">monitoring</span>
              {t("analytics.admin_health")}
            </Link>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3 mb-4 sm:mb-6 h-auto">
            <TabsTrigger value="overview" className="text-[11px] sm:text-sm py-2">
              <BarChart3 className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              {t("analytics.tab_overview")}
            </TabsTrigger>
            <TabsTrigger value="trends" className="text-[11px] sm:text-sm py-2">
              <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              {t("analytics.tab_trends")}
            </TabsTrigger>
            <TabsTrigger value="top" className="text-[11px] sm:text-sm py-2">
              <Activity className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
              {t("analytics.tab_top")}
            </TabsTrigger>
          </TabsList>

          {/* Vue d'ensemble */}
          <TabsContent value="overview" className="space-y-3 sm:space-y-4">
            {/* Revenus créateur — pourboires MIS EN AVANT (tout en haut, la
                première chose visible). Toujours affiché (défaut 0 €). */}
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="material-symbols-outlined text-cyan-400 text-lg">volunteer_activism</span>
                      <p className="text-sm font-semibold text-slate-300">{t("analytics.tips_received")}</p>
                    </div>
                    <p className="text-4xl sm:text-5xl font-black text-white leading-none tracking-tight">{eur(tips.total_amount)}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-[11px] sm:text-xs text-slate-400">
                      <span><Trans i18nKey="analytics.tips_count" count={tips.count} values={{ count: tips.count }} components={{ b: <b className="text-slate-200" /> }} /></span>
                      {tips.count > 0 && <span>{t("analytics.average")} <b className="text-slate-200">{eur(tips.total_amount / tips.count)}</b></span>}
                    </div>
                  </div>
                  <div className="w-11 h-11 rounded-2xl bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-cyan-400 text-2xl">payments</span>
                  </div>
                </div>

                {/* Liste des derniers pourboires (qui / date / montant) */}
                {tips.tips?.length > 0 ? (
                  <div className="mt-4 pt-4 border-t border-slate-800">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{t("analytics.latest_tips")}</p>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {tips.tips.map((t) => (
                        <div key={t.id} className="flex items-center gap-3 py-2 px-2.5 rounded-xl bg-slate-800/50">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-slate-900 flex-shrink-0"
                            style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)" }}>
                            {(t.from_username || "?")[0].toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-white truncate">@{t.from_username}</p>
                            <p className="text-[11px] text-slate-500">{fmtDate(t.created_at)}</p>
                          </div>
                          <span className="font-bold text-cyan-400 flex-shrink-0">+{eur(t.amount_total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 mt-4 pt-4 border-t border-slate-800">{t("analytics.no_tips")}</p>
                )}

                {/* Raccourci utile : gérer ses moyens de pourboire */}
                <Link
                  to="/settings"
                  className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">settings</span>
                  {t("analytics.manage_tips")}
                </Link>
              </CardContent>
            </Card>

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

            {/* Bandeau engagement */}
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-4 flex items-center gap-3">
                <Activity className="h-5 w-5 text-green-500" />
                <div>
                  <p className="text-xs sm:text-sm text-slate-400">{t("analytics.avg_engagement")}</p>
                  <p className="text-lg sm:text-xl font-bold text-white">
                    {t("analytics.interactions_per_post", { count: stats?.engagement_rate ?? 0 })}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Activité de l'audience par heure */}
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">{t("analytics.audience_activity")}</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  {t("analytics.audience_activity_sub")}
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
                    <Bar dataKey="likes" fill="#ec4899" name={t("analytics.chart_likes")} />
                    <Bar dataKey="comments" fill="#8b5cf6" name={t("analytics.chart_comments")} />
                    <Bar dataKey="posts" fill="#06b6d4" name={t("analytics.chart_my_posts")} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Croissance */}
          <TabsContent value="trends" className="space-y-3 sm:space-y-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">{t("analytics.growth_title")}</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  {t("analytics.growth_sub")}
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
                    <Line type="monotone" dataKey="followers" stroke="#06b6d4" name={t("analytics.chart_new_followers")} strokeWidth={2} />
                    <Line type="monotone" dataKey="posts" stroke="#3b82f6" name={t("analytics.chart_posts")} strokeWidth={2} />
                    <Line type="monotone" dataKey="likes" stroke="#ec4899" name={t("analytics.chart_likes")} strokeWidth={2} />
                    <Line type="monotone" dataKey="comments" stroke="#f59e0b" name={t("analytics.chart_comments")} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Top posts */}
          <TabsContent value="top" className="space-y-3 sm:space-y-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardHeader>
                <CardTitle className="text-base sm:text-lg">{t("analytics.top_title")}</CardTitle>
                <CardDescription className="text-xs sm:text-sm">{t("analytics.top_sub")}</CardDescription>
              </CardHeader>
              <CardContent>
                {topPosts.length === 0 ? (
                  <div className="text-center py-6 sm:py-8">
                    <FileText className="h-10 w-10 sm:h-12 sm:w-12 text-slate-600 mx-auto mb-2 sm:mb-3" />
                    <p className="text-slate-400 text-xs sm:text-sm">
                      {t("analytics.top_empty")}
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
                            {post.content || t("analytics.no_text")}
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
                            {t("analytics.pts", { count: Math.round(post.engagement_score) })}
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
                  <Trans i18nKey="analytics.following_line" values={{ following: stats?.following_count ?? 0, followers: stats?.followers_count ?? 0 }} components={{ a: <span className="text-white font-semibold" />, b: <span className="text-white font-semibold" /> }} />
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
