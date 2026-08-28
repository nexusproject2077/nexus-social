import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { getCloseFriends, setCloseFriends, toggleCloseFriend } from "@/lib/closeFriends";

export default function CloseFriendsPanel() {
  const { t } = useTranslation();
  const [ids, setIds] = useState(() => getCloseFriends());
  const [following, setFollowing] = useState([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    axios
      .get(`${API}/users/me/following`, { params: { limit: 100 } })
      .then((r) => setFollowing(r.data?.users || r.data || []))
      .catch(() => setFollowing([]));
    // sync server if available
    axios.get(`${API}/users/me/close-friends`).then((r) => {
      const serverIds = (r.data?.ids || r.data || []).map(String);
      if (serverIds.length) {
        setIds(serverIds);
        setCloseFriends(serverIds);
      }
    }).catch(() => {});
  }, []);

  const toggle = async (uid) => {
    const next = toggleCloseFriend(uid);
    setIds([...next]);
    try {
      await axios.put(`${API}/users/me/close-friends`, { ids: next });
    } catch { /* local ok */ }
    toast.success(t("close_friends.updated"));
  };

  const filtered = following.filter(
    (u) =>
      !q ||
      (u.username || "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="rounded-2xl p-4" style={{ background: "#131b2e", border: "1px solid rgba(255,255,255,0.06)" }}>
      <h3 className="text-sm font-bold text-white mb-1">{t("close_friends.title")}</h3>
      <p className="text-[11px] mb-3" style={{ color: "#859397" }}>{t("close_friends.sub")}</p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("close_friends.search")}
        className="w-full mb-3 rounded-xl px-3 py-2 text-sm outline-none text-white"
        style={{ background: "#0b1326", border: "1px solid rgba(255,255,255,0.08)" }}
      />
      <div className="max-h-56 overflow-y-auto space-y-1">
        {filtered.length === 0 && (
          <p className="text-xs text-center py-4" style={{ color: "#859397" }}>{t("close_friends.empty")}</p>
        )}
        {filtered.map((u) => {
          const on = ids.includes(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(u.id)}
              className="w-full flex items-center gap-3 py-2 px-2 rounded-xl"
              style={{ background: on ? "rgba(34,211,238,0.1)" : "transparent" }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: "linear-gradient(135deg,#22d3ee,#3b82f6)", color: "#00363e" }}
              >
                {(u.username || "?")[0]?.toUpperCase()}
              </div>
              <span className="flex-1 text-left text-sm text-white">@{u.username}</span>
              <span className="material-symbols-outlined text-[20px]" style={{ color: on ? "#22d3ee" : "#859397" }}>
                {on ? "star" : "star_outline"}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] mt-2" style={{ color: "#859397" }}>
        {ids.length} {t("close_friends.count")}
      </p>
    </div>
  );
}
