import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";

// Cache mémoire partagé entre toutes les instances (évite de re-fetcher un lien).
const _cache = new Map();

/**
 * Carte d'aperçu Open Graph d'un lien (façon iMessage/WhatsApp), pour la
 * messagerie. Best-effort : n'affiche rien si le lien n'a pas de métadonnées.
 */
export default function LinkPreview({ url, accent = "#22d3ee" }) {
  const [data, setData] = useState(() => _cache.get(url) || null);

  useEffect(() => {
    if (!url || _cache.has(url)) return;
    let cancelled = false;
    axios
      .get(`${API}/link-preview`, { params: { url } })
      .then((r) => {
        _cache.set(url, r.data || { url });
        if (!cancelled) setData(r.data || { url });
      })
      .catch(() => {
        _cache.set(url, { url });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Rien à montrer tant qu'on n'a ni titre ni image.
  if (!data || (!data.title && !data.image)) return null;

  let host = data.site_name;
  try {
    host = host || new URL(url).hostname;
  } catch {
    /* ignore */
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="block mt-1 rounded-2xl overflow-hidden max-w-[280px] transition-opacity hover:opacity-90"
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {data.image && (
        <img
          src={data.image}
          alt=""
          loading="lazy"
          className="w-full h-36 object-cover"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      )}
      <div className="p-2.5">
        {host && (
          <p
            className="text-[10px] uppercase tracking-wide mb-0.5"
            style={{ color: accent }}
          >
            {host}
          </p>
        )}
        {data.title && (
          <p
            className="text-[13px] font-bold leading-snug line-clamp-2"
            style={{ color: "#dae2fd" }}
          >
            {data.title}
          </p>
        )}
        {data.description && (
          <p
            className="text-[11px] mt-0.5 line-clamp-2"
            style={{ color: "#bbc9cd" }}
          >
            {data.description}
          </p>
        )}
      </div>
    </a>
  );
}
