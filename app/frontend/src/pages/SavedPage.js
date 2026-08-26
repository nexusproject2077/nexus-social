import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API } from "../App";
import Layout from "../components/Layout";
import PostCard from "../components/PostCard";
import { Skeleton } from "../components/ui/skeleton";
import PullToRefresh from "../components/PullToRefresh";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

/**
 * Page « Enregistrés » : les publications ET clips que l'utilisateur a
 * enregistrés (bouton signet), du plus récent au plus ancien. Filtre
 * Tout / Publications / Vidéos.
 */
export default function SavedPage({ user, setUser }) {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | posts | videos

  const fetchSaved = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/posts/saved`);
      setItems(res.data || []);
    } catch {
      toast.error(t("error_loading_saved"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSaved(); }, [fetchSaved]);

  // Retirer localement un élément désenregistré (le bouton signet renvoie l'état).
  const handleUpdate = (updated) => {
    setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };
  const handleDelete = (postId) => {
    setItems((prev) => prev.filter((p) => p.id !== postId));
  };

  const filtered = items.filter((p) => {
    if (filter === "videos") return p.media_type === "video";
    if (filter === "posts") return p.media_type !== "video";
    return true;
  });

  const TABS = [
    { key: "all", label: "Tout" },
    { key: "posts", label: t("posts_label") },
    { key: "videos", label: t("videos") },
  ];

  return (
    <Layout user={user} setUser={setUser}>
      <PullToRefresh onRefresh={fetchSaved} />
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <header
          className="sticky top-0 z-30 h-16 flex items-center gap-2 px-4 lg:px-8"
          style={{ backgroundColor: "rgba(11,19,38,0.7)", backdropFilter: "blur(20px)" }}
        >
          <span className="material-symbols-outlined" style={{ color: "var(--nexus-accent)" }}>bookmark</span>
          <h1 className="font-headline font-bold text-xl tracking-tight" style={{ color: "#dae2fd" }}>{
            t("saved")
          }</h1>
        </header>

        {/* Filtres */}
        <div className="flex items-center gap-2 px-4 mt-3">
          {TABS.map(({ key, label }) => {
            const active = filter === key;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className="flex-1 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
                style={{
                  backgroundColor: active ? "var(--nexus-accent)" : "#171f33",
                  color: active ? "#00363e" : "#859397",
                  border: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Liste */}
        <div className="px-4 py-4 lg:py-6 space-y-4 lg:space-y-6">
          {loading ? (
            <div className="space-y-4 lg:space-y-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl border p-4 lg:p-5"
                  style={{ backgroundColor: "#171f33", borderColor: "rgba(255,255,255,0.05)" }}>
                  <div className="flex items-center gap-3 mb-4">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-32" />
                      <Skeleton className="h-2.5 w-20" />
                    </div>
                  </div>
                  <Skeleton className="h-40 w-full rounded-xl" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16" style={{ color: "#859397" }}>
              <span className="material-symbols-outlined text-5xl mb-3 block" style={{ color: "#334155" }}>bookmark_border</span>
              <p className="text-lg">Rien d'enregistré pour le moment</p>
              <p className="text-sm mt-2">
                Appuyez sur l'icône signet d'une publication ou d'un clip pour le retrouver ici.
              </p>
            </div>
          ) : (
            filtered.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUser={user}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </div>
    </Layout>
  );
}
