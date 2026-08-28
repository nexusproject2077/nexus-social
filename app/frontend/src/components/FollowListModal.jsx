import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { API } from "@/App";
import { X, BadgeCheck } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

const C = {
  surface: "#0b1326",
  surfaceHigh: "#171f33",
  outline: "#859397",
  onSurface: "#dae2fd",
  accent: "var(--nexus-accent)",
};

// Liste gérable des abonnés / abonnements d'un profil.
// - kind : "followers" | "following"
// - manageFollowers : true si on regarde nos propres abonnés (bouton Retirer)
export default function FollowListModal({
  userId,
  kind,
  title,
  currentUserId,
  manageFollowers = false,
  onClose,
  onCountChange,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState({});

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await axios.get(`${API}/users/${userId}/${kind}`);
      setItems(r.data || []);
    } catch (err) {
      toast.error(err.response?.data?.detail || t("cannot_load_list"));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [userId, kind]);

  useEffect(() => {
    load();
  }, [load]);

  const go = (id) => {
    onClose?.();
    navigate(`/profile/${id}`);
  };

  const toggleFollow = async (target) => {
    setBusy((b) => ({ ...b, [target.id]: true }));
    try {
      if (target.is_following) {
        await axios.delete(`${API}/users/${target.id}/follow`);
        setItems((prev) =>
          prev.map((u) =>
            u.id === target.id ? { ...u, is_following: false } : u,
          ),
        );
      } else {
        const res = await axios.post(`${API}/users/${target.id}/follow`);
        // Compte privé → demande en attente : on ne marque pas "abonné".
        const nowFollowing = res.data?.status === "following";
        setItems((prev) =>
          prev.map((u) =>
            u.id === target.id ? { ...u, is_following: nowFollowing } : u,
          ),
        );
        if (res.data?.status === "pending") toast.success(t("request_sent"));
      }
    } catch (err) {
      toast.error(err.response?.data?.detail || t("error"));
    } finally {
      setBusy((b) => ({ ...b, [target.id]: false }));
    }
  };

  const removeFollower = async (target) => {
    setBusy((b) => ({ ...b, [target.id]: true }));
    try {
      await axios.delete(`${API}/users/me/followers/${target.id}`);
      setItems((prev) => prev.filter((u) => u.id !== target.id));
      onCountChange?.(-1);
      toast.success(`@${target.username} retiré de vos abonnés`);
    } catch (err) {
      toast.error(err.response?.data?.detail || t("error"));
    } finally {
      setBusy((b) => ({ ...b, [target.id]: false }));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
        style={{
          background: C.surface,
          border: `1px solid ${C.outline}22`,
          maxHeight: "80vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: `${C.outline}22` }}
        >
          <h2
            className="text-lg font-black text-white"
            style={{ fontFamily: "Space Grotesk, sans-serif" }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: C.surfaceHigh }}
          >
            <X size={18} color={C.onSurface} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {loading ? (
            <div className="flex justify-center py-12">
              <div
                className="w-6 h-6 rounded-full border-2 animate-spin"
                style={{
                  borderColor: `${C.accent}33`,
                  borderTopColor: C.accent,
                }}
              />
            </div>
          ) : items.length === 0 ? (
            <p
              className="text-center py-12 text-sm"
              style={{ color: C.outline }}
            >
              {kind === "followers"
                ? t("no_followers_yet")
                : t("no_following_yet")}
            </p>
          ) : (
            items.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-3 px-5 py-3 hover:bg-white/5"
              >
                <button
                  onClick={() => go(u.id)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  {u.profile_pic ? (
                    <img
                      src={u.profile_pic}
                      alt={u.username}
                      className="w-11 h-11 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center font-bold flex-shrink-0"
                      style={{
                        background: "linear-gradient(135deg,#22d3ee,#3b82f6)",
                        color: "#00363e",
                      }}
                    >
                      {(u.username || "?")[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white flex items-center gap-1 truncate">
                      @{u.username}
                      {u.is_verified && (
                        <BadgeCheck size={14} color={C.accent} />
                      )}
                    </p>
                    {u.bio && (
                      <p
                        className="text-xs truncate"
                        style={{ color: C.outline }}
                      >
                        {u.bio}
                      </p>
                    )}
                  </div>
                </button>

                {/* Actions */}
                {!u.is_self && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      disabled={busy[u.id]}
                      onClick={() => toggleFollow(u)}
                      className="px-3.5 py-1.5 rounded-full text-xs font-bold transition-all disabled:opacity-50"
                      style={
                        u.is_following
                          ? { background: C.surfaceHigh, color: C.onSurface }
                          : { background: C.accent, color: "#00363e" }
                      }
                    >
                      {u.is_following ? t("follower_singular") : t("follow")}
                    </button>
                    {manageFollowers && (
                      <button
                        disabled={busy[u.id]}
                        onClick={() => removeFollower(u)}
                        className="px-3 py-1.5 rounded-full text-xs font-bold disabled:opacity-50"
                        style={{
                          background: "transparent",
                          color: "#f87171",
                          border: "1px solid #f8717155",
                        }}
                      >
                        Retirer
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
