// AdminMetrics.jsx — Tableau de bord SANTÉ de l'app (réservé aux admins).
// Métriques business simples et fiables : total utilisateurs, nouveaux inscrits,
// utilisateurs actifs quotidiens (DAU), rétention J+1 / J+7 / J+30.
// Données déjà disponibles côté serveur (inscriptions + activité de session).

import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Users, UserPlus, Activity, Repeat, ShieldAlert, TrendingUp } from "lucide-react";

export default function AdminMetrics({ user, setUser }) {
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [data, setData] = useState(null);

  const load = async () => {
    try {
      const r = await axios.get(`${API}/admin/metrics`);
      setData(r.data);
      setDenied(false);
    } catch (e) {
      if (e?.response?.status === 403) setDenied(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000); // rafraîchit toutes les minutes
    return () => clearInterval(t);
  }, []);

  // "YYYY-MM-DD" → "DD/MM" pour l'axe des graphiques.
  const shortDay = (d) => (d ? d.slice(8, 10) + "/" + d.slice(5, 7) : "");
  const pct = (v) => (v === null || v === undefined ? "n/d" : `${v}%`);

  if (loading) {
    return (
      <Layout user={user} setUser={setUser} compact>
        <div className="flex items-center justify-center h-screen">
          <Activity className="h-10 w-10 text-cyan-500 animate-pulse" />
        </div>
      </Layout>
    );
  }

  if (denied) {
    return (
      <Layout user={user} setUser={setUser} compact>
        <div className="flex flex-col items-center justify-center h-screen gap-3 text-center px-6">
          <ShieldAlert className="h-12 w-12 text-slate-500" />
          <h1 className="text-lg font-bold text-white">Accès réservé</h1>
          <p className="text-sm text-slate-400">Ce tableau de bord est réservé aux administrateurs.</p>
        </div>
      </Layout>
    );
  }

  const kpis = [
    { icon: Users, color: "text-cyan-400", label: "Utilisateurs (total)", value: data?.total_users },
    { icon: UserPlus, color: "text-blue-400", label: "Nouveaux (7 jours)", value: data?.new_signups_7d },
    { icon: UserPlus, color: "text-green-400", label: "Nouveaux (aujourd'hui)", value: data?.new_signups_today },
    { icon: Activity, color: "text-fuchsia-400", label: "Actifs aujourd'hui (DAU)", value: data?.dau_today },
  ];

  const ret = data?.retention || {};
  const retItems = [
    { label: "Rétention J+1", key: "j1" },
    { label: "Rétention J+7", key: "j7" },
    { label: "Rétention J+30", key: "j30" },
  ];

  return (
    <Layout user={user} setUser={setUser} compact>
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 sm:py-4 pb-24">
        {/* Header */}
        <div className="mb-4 sm:mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white mb-0.5" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
              Santé de l'app
            </h1>
            <p className="text-slate-400 text-xs sm:text-sm">Métriques clés, réservé aux administrateurs</p>
          </div>
          <span className="text-[10px] text-slate-500 flex items-center gap-1 flex-shrink-0 mt-1">
            <TrendingUp className="h-3 w-3" /> maj auto
          </span>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-3 sm:mb-4">
          {kpis.map((k) => (
            <Card key={k.label} className="bg-slate-900 border-slate-800">
              <CardContent className="p-3 sm:p-4">
                <k.icon className={`h-4 w-4 sm:h-5 sm:w-5 ${k.color} mb-1.5 sm:mb-2`} />
                <p className="text-[11px] sm:text-sm text-slate-400 leading-tight">{k.label}</p>
                <p className="text-xl sm:text-3xl font-black text-white">{(k.value ?? 0).toLocaleString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Rétention */}
        <Card className="bg-slate-900 border-slate-800 mb-3 sm:mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <Repeat className="h-4 w-4 text-cyan-400" /> Rétention
            </CardTitle>
            <CardDescription className="text-xs">
              Part des inscrits encore actifs N jours après leur inscription
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              {retItems.map(({ label, key }) => {
                const r = ret[key] || {};
                return (
                  <div key={key} className="rounded-xl bg-slate-800/50 p-3 text-center">
                    <p className="text-[10px] sm:text-xs text-slate-400 mb-1">{label}</p>
                    <p className="text-2xl sm:text-4xl font-black text-cyan-400 leading-none">{pct(r.rate)}</p>
                    <p className="text-[10px] text-slate-500 mt-1.5">
                      {r.cohort ? `${r.retained}/${r.cohort} inscrits` : "pas assez de recul"}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Nouveaux inscrits (14 j) */}
        <Card className="bg-slate-900 border-slate-800 mb-3 sm:mb-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base sm:text-lg">Nouveaux inscrits</CardTitle>
            <CardDescription className="text-xs">14 derniers jours</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={(data?.signups_series || []).map((d) => ({ ...d, label: shortDay(d.day) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" stroke="#94a3b8" style={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} stroke="#94a3b8" style={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }} labelStyle={{ color: "#e2e8f0" }} />
                <Bar dataKey="count" fill="#3b82f6" name="Inscrits" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* DAU (14 j) */}
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base sm:text-lg">Utilisateurs actifs / jour (DAU)</CardTitle>
            <CardDescription className="text-xs">14 derniers jours</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={(data?.dau_series || []).map((d) => ({ ...d, label: shortDay(d.day) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="label" stroke="#94a3b8" style={{ fontSize: 10 }} />
                <YAxis allowDecimals={false} stroke="#94a3b8" style={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155" }} labelStyle={{ color: "#e2e8f0" }} />
                <Bar dataKey="dau" fill="#22d3ee" name="DAU" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <p className="text-[10px] text-slate-600 mt-3 text-center">
          DAU et rétention excluent les comptes en Mode Confidentialité stricte (non suivis).
        </p>
      </div>
    </Layout>
  );
}
