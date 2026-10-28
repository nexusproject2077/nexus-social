#!/usr/bin/env node
/**
 * Pipeline de traduction automatique des locales i18next.
 *
 * Lit la locale SOURCE (en/common.json par defaut) et remplit
 * src/locales/<lang>/common.json pour chaque langue cible, via un moteur de
 * traduction au choix. Incremental : ne retraduit PAS les cles deja presentes
 * (sauf --force). Preserve les variables i18next {{comme_ceci}}.
 *
 * Utilisation :
 *   node scripts/translate-locales.mjs --langs=tr,es,de
 *   node scripts/translate-locales.mjs --all           # tout le catalogue
 *   node scripts/translate-locales.mjs --langs=tr --force
 *
 * Moteur (variable d'env TRANSLATE_PROVIDER) :
 *   libre  (defaut, gratuit, sans cle) - LIBRE_URL, LIBRE_API_KEY (optionnels)
 *   deepl  - DEEPL_API_KEY                (qualite elevee, ~30 langues)
 *   google - GOOGLE_API_KEY               (large couverture)
 *   openai - OPENAI_API_KEY, OPENAI_MODEL (defaut gpt-4o-mini)
 *
 * ATTENTION : la couverture ET la qualite dependent du moteur. Les langues a
 * faibles ressources (abkhaze, dioula, tamazight...) sont mal ou pas prises en
 * charge et doivent etre relues par des humains. Lancer sur les langues bien
 * supportees d'abord, elargir ensuite.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "../src/locales");
const SOURCE_LANG = process.env.SOURCE_LANG || "en";
const NS = "common";
const PROVIDER = (process.env.TRANSLATE_PROVIDER || "libre").toLowerCase();

// Catalogue cible etendu (codes ISO). A etoffer au besoin - le script n'ecrit que
// ce qu'on lui demande. Les codes non reconnus par le moteur seront ignores/echoueront.
const CATALOG = [
  "es", "de", "it", "pt", "nl", "pl", "tr", "ru", "uk", "ar", "hi", "zh", "ja",
  "ko", "id", "vi", "th", "fa", "he", "el", "cs", "ro", "hu", "sv", "da", "fi",
  "no", "sk", "bg", "hr", "sr", "sl", "lt", "lv", "et", "ms", "fil", "bn", "ur",
  "ta", "te", "ml", "mr", "gu", "kn", "pa", "sw", "am", "ha", "yo", "ig", "zu",
  "af", "sq", "hy", "az", "ka", "kk", "uz", "mn", "ne", "si", "km", "lo", "my",
];

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const FORCE = !!flag("force");
const ALL = !!flag("all");
const langsArg = flag("langs");
const TARGETS = ALL
  ? CATALOG
  : (langsArg ? langsArg.split("=")[1].split(",").map((s) => s.trim()).filter(Boolean) : []);

if (!TARGETS.length) {
  console.error("Aucune langue cible. Ex : --langs=tr,es  ou  --all");
  process.exit(1);
}

// ---- Protection des variables i18next {{var}} pendant la traduction ----
// Sentinelle a lettres (VAR0X, VAR1X...) : ne collisionne PAS avec de vrais
// chiffres du texte, et les moteurs de traduction la laissent generalement intacte.
function shield(text) {
  const vars = [];
  const shielded = String(text).replace(/{{\s*[\w.]+\s*}}/g, (m) => {
    vars.push(m);
    return `VAR${vars.length - 1}X`;
  });
  return { shielded, vars };
}
function unshield(text, vars) {
  return String(text).replace(/VAR(\d+)X/gi, (_, i) => vars[Number(i)] ?? "");
}

// ---- Moteurs de traduction ----
async function translateLibre(text, target) {
  const url = (process.env.LIBRE_URL || "https://libretranslate.com") + "/translate";
  const body = { q: text, source: SOURCE_LANG, target, format: "text" };
  if (process.env.LIBRE_API_KEY) body.api_key = process.env.LIBRE_API_KEY;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`LibreTranslate ${r.status}: ${await r.text()}`);
  return (await r.json()).translatedText;
}
async function translateDeepl(text, target) {
  const key = process.env.DEEPL_API_KEY;
  const host = key?.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  // La clé passe par l'en-tête Authorization (l'ancien paramètre auth_key est rejeté : 403).
  const params = new URLSearchParams({ text, source_lang: SOURCE_LANG.toUpperCase(), target_lang: target.toUpperCase() });
  const r = await fetch(`${host}/v2/translate`, {
    method: "POST",
    headers: { "Authorization": `DeepL-Auth-Key ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!r.ok) throw new Error(`DeepL ${r.status}: ${await r.text()}`);
  return (await r.json()).translations[0].text;
}
async function translateGoogle(text, target) {
  const key = process.env.GOOGLE_API_KEY;
  const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${key}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: text, source: SOURCE_LANG, target, format: "text" }),
  });
  if (!r.ok) throw new Error(`Google ${r.status}: ${await r.text()}`);
  return (await r.json()).data.translations[0].translatedText;
}
async function translateOpenai(text, target) {
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, temperature: 0,
      messages: [
        { role: "system", content: `Translate UI strings from ${SOURCE_LANG} to ${target}. Return ONLY the translation, no quotes. Keep any VARnX tokens (e.g. VAR0X) exactly as-is.` },
        { role: "user", content: text },
      ],
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${await r.text()}`);
  return (await r.json()).choices[0].message.content.trim();
}
const ENGINES = { libre: translateLibre, deepl: translateDeepl, google: translateGoogle, openai: translateOpenai };
const engine = ENGINES[PROVIDER];
if (!engine) { console.error(`Moteur inconnu : ${PROVIDER}`); process.exit(1); }

// Garde-fou clé DeepL : un en-tête HTTP n'accepte que l'ASCII. Détecte notamment
// le placeholder « … » (U+2026) collé par erreur à la place de la vraie clé, qui
// faisait planter fetch avec une erreur cryptique « ByteString … value 8230 ».
if (PROVIDER === "deepl") {
  const k = process.env.DEEPL_API_KEY || "";
  if (!k.trim()) {
    console.error("DEEPL_API_KEY manquante. Exporte ta vraie clé DeepL (ex. abcd-1234-…-efgh:fx pour l'offre Free).");
    process.exit(1);
  }
  if (/[^\x21-\x7e]/.test(k)) {
    console.error("DEEPL_API_KEY invalide : caractère non-ASCII détecté. As-tu bien remplacé le placeholder « … » par ta VRAIE clé DeepL ?");
    process.exit(1);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Traduction par LOTS (batch) : indispensable pour éviter les 429 ----
// DeepL accepte plusieurs `text` par requête → 1 appel pour ~40 chaînes au lieu
// de 40 appels. Les autres moteurs retombent sur des appels unitaires.
const BATCH_SIZE = PROVIDER === "deepl" ? 40 : (PROVIDER === "openai" ? 20 : 1);

async function deeplBatch(texts, target) {
  const key = process.env.DEEPL_API_KEY;
  const host = key?.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  // tag_handling=html : DeepL préserve les balises HTML (<p>, <h2>, <a>, <b>…)
  // des corps d'articles ET des chaînes riches (Trans) au lieu de les traduire.
  const params = new URLSearchParams({ source_lang: SOURCE_LANG.toUpperCase(), target_lang: target.toUpperCase(), tag_handling: "html" });
  for (const t of texts) params.append("text", t);
  const r = await fetch(`${host}/v2/translate`, {
    method: "POST",
    headers: { "Authorization": `DeepL-Auth-Key ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (r.status === 429) { const e = new Error("DeepL 429 (rate limit)"); e.retry = true; throw e; }
  if (!r.ok) throw new Error(`DeepL ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return (await r.json()).translations.map((x) => x.text);
}

// Un lot → tableau de traductions (même ordre). DeepL natif ; sinon séquentiel.
async function translateChunk(texts, target) {
  if (PROVIDER === "deepl") return deeplBatch(texts, target);
  const out = [];
  for (const t of texts) { out.push(await engine(t, target)); await sleep(120); }
  return out;
}

// Retry avec backoff exponentiel sur 429 / erreurs transitoires.
async function translateChunkRetry(texts, target, tries = 6) {
  let delay = 2000;
  for (let i = 0; i < tries; i++) {
    try { return await translateChunk(texts, target); }
    catch (e) {
      const transient = e.retry || /429|too many|timeout|ECONNRESET|ETIMEDOUT|fetch failed/i.test(e.message || "");
      if (i === tries - 1 || !transient) throw e;
      await sleep(delay); delay = Math.min(delay * 2, 30000);
    }
  }
}

// ---- Aplatissement / reconstruction (préserve la structure imbriquée) ----
function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; } }
function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, p, out);
    else out[p] = v;
  }
  return out;
}
const getPath = (obj, path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
function setPath(obj, path, val) {
  const parts = path.split("."); let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = cur[parts[i]] || {}; cur = cur[parts[i]]; }
  cur[parts[parts.length - 1]] = val;
}

const source = loadJson(path.join(LOCALES_DIR, SOURCE_LANG, `${NS}.json`));
if (!Object.keys(source).length) { console.error(`Source ${SOURCE_LANG}/${NS}.json vide/absente.`); process.exit(1); }
const srcFlat = flatten(source);
const allPaths = Object.keys(srcFlat).filter((p) => typeof srcFlat[p] === "string");

// ---- Boucle principale ----
console.log(`Moteur=${PROVIDER} (lots de ${BATCH_SIZE}) - source=${SOURCE_LANG} - cibles=${TARGETS.join(",")}`);
for (const target of TARGETS) {
  if (target === SOURCE_LANG) continue;
  const dir = path.join(LOCALES_DIR, target);
  const file = path.join(dir, `${NS}.json`);
  const existing = loadJson(file);
  const stats = { done: 0, kept: 0, failed: 0 };
  const result = {};
  const todo = [];

  for (const p of allPaths) {
    const cur = getPath(existing, p);
    if (!FORCE && typeof cur === "string" && cur.trim()) { setPath(result, p, cur); stats.kept++; }
    else todo.push(p);
  }

  process.stdout.write(`-> ${target} `);
  const shielded = todo.map((p) => shield(srcFlat[p]));
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const idx = todo.slice(i, i + BATCH_SIZE);
    const chunk = shielded.slice(i, i + BATCH_SIZE).map((s) => s.shielded);
    try {
      const outs = await translateChunkRetry(chunk, target);
      idx.forEach((p, j) => {
        const sh = shielded[i + j];
        if (outs && outs[j] != null) { setPath(result, p, unshield(outs[j], sh.vars)); stats.done++; }
        else { // pas de sortie → on garde l'existant si dispo, sinon clé omise (jamais le texte source)
          const cur = getPath(existing, p);
          if (typeof cur === "string" && cur.trim()) setPath(result, p, cur);
          stats.failed++;
        }
      });
    } catch (e) {
      idx.forEach((p) => { const cur = getPath(existing, p); if (typeof cur === "string" && cur.trim()) setPath(result, p, cur); stats.failed++; });
      if (stats.failed <= BATCH_SIZE) console.warn(`\n  ! lot ${target}: ${String(e.message).slice(0, 140)}`);
    }
    process.stdout.write(".");
    await sleep(300);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(` ok (${stats.done} traduites, ${stats.kept} conservees, ${stats.failed} echecs)`);
}
console.log("Termine. Ajoute les nouveaux codes a SUPPORTED_LANGUAGES (src/i18n.js) pour les afficher dans le selecteur.");
