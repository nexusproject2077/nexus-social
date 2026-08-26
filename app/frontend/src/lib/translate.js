/**
 * Traduit un texte vers la langue cible via MyMemory (gratuit, sans clé pour usage léger).
 * Langues supportées = celles de l'app (codes ISO 639-1).
 */

const cache = new Map();

export async function translateText(text, targetLang, sourceLang = "auto") {
  if (!text || !text.trim()) return text;
  const target = (targetLang || "en").split("-")[0];
  const source = (sourceLang || "auto").split("-")[0];
  if (source !== "auto" && source === target) return text;

  const key = `${source}|${target}|${text}`;
  if (cache.has(key)) return cache.get(key);

  // MyMemory limite ~500 caractères par requête → découper si besoin
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= 450) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf(" ", 450);
    if (cut < 100) cut = 450;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }

  const translated = [];
  for (const chunk of chunks) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${source}|${target}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Translate HTTP ${res.status}`);
    const data = await res.json();
    const out = data?.responseData?.translatedText;
    if (!out || data?.responseStatus !== 200) {
      throw new Error(data?.responseDetails || "Translation failed");
    }
    // MyMemory renvoie parfois le texte d'origine si quota
    translated.push(out);
  }

  const result = translated.join(" ");
  cache.set(key, result);
  return result;
}
