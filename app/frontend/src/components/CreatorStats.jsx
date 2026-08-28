import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { useTranslation } from "react-i18next";

export default function CreatorStats({ userId, isOwn }) {
  const { t } = useTranslation();
  const [s, setS] = useState(null);

  useEffect(() => {
    if (!userId) return;
    axios
      .get(`${API}/users/${userId}/creator-stats`)
      .then((r) => setS(r.data))
      .catch(async () => {
        // fallback: derive from clips list if endpoint missing
        try {
          const r = await axios.get(`${API}/users/${userId}/posts`, { params: { type: "clip", limit: 50 } });
          const posts = r.data?.posts || r.data || [];
          const clips = posts.filter((p) => p.media_type === "video" || p.is_clip);
          const views = clips.reduce((a, p) => a + (p.views || p.views_count || 0), 0);
          const likes = clips.reduce((a, p) => a + (p.likes_count || 0), 0);
          setS({ clips: clips.length, views, likes, avg_views: clips.length ? Math.round(views / clips.length) : 0 });
        } catch {
          setS(null);
        }
      });
  }, [userId]);

  if (!s || (!isOwn && s.clips === 0)) return null;

  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n || 0));

  return (
    <div className="mx-4 mb-3 grid grid-cols-3 gap-2">
      {[
        { label: t("creator.clips"), value: fmt(s.clips) },
        { label: t("creator.views"), value: fmt(s.views) },
        { label: t("creator.likes"), value: fmt(s.likes) },
      ].map((x) => (
        <div
          key={x.label}
          className="rounded-xl py-2.5 text-center"
          style={{ background: "#131b2e", border: "1px solid rgba(34,211,238,0.1)" }}
        >
          <p className="text-sm font-black text-white">{x.value}</p>
          <p className="text-[10px]" style={{ color: "#859397" }}>{x.label}</p>
        </div>
      ))}
    </div>
  );
}
