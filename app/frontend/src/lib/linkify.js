import React from "react";

// Détecte les URLs http(s). Le token est capturé sans la ponctuation finale.
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]}'"])/gi;

/**
 * Transforme les URLs d'un texte en liens cliquables (nœuds React).
 * @param {string} text
 * @param {{color?:string, underline?:boolean}} opts
 */
export function linkify(text, opts = {}) {
  const { color, underline = false } = opts;
  if (!text || typeof text !== "string") return text;
  const nodes = [];
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const href = m[0];
    nodes.push(
      <a
        key={m.index}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{
          color: color || "#60a5fa",
          textDecoration: underline ? "underline" : "none",
          wordBreak: "break-word",
        }}
      >
        {href}
      </a>,
    );
    last = m.index + href.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length ? nodes : text;
}

/** Renvoie la première URL http(s) d'un texte, ou null. */
export function extractFirstUrl(text) {
  if (!text || typeof text !== "string") return null;
  URL_RE.lastIndex = 0;
  const m = URL_RE.exec(text);
  return m ? m[0] : null;
}
