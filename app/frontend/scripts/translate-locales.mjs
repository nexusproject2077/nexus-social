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

async function translate(text, target) {
  if (!text || !String(text).trim()) return text;
  const { shielded, vars } = shield(text);
  const out = await engine(shielded, target);
  return unshield(out, vars);
}

// ---- Parcours recursif de l'objet de locale ----
function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; } }
const source = loadJson(path.join(LOCALES_DIR, SOURCE_LANG, `${NS}.json`));
if (!Object.keys(source).length) { console.error(`Source ${SOURCE_LANG}/${NS}.json vide/absente.`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function translateTree(src, existing, target, stats) {
  const out = Array.isArray(src) ? [] : {};
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object") {
      out[k] = await translateTree(v, existing?.[k] || {}, target, stats);
    } else if (!FORCE && existing && typeof existing[k] === "string" && existing[k].trim()) {
      out[k] = existing[k]; stats.kept++;
    } else {
      try { out[k] = await translate(v, target); stats.done++; await sleep(120); }
      catch (e) {
        // En cas d'échec : on garde une éventuelle traduction existante, sinon on
        // N'ÉCRIT PAS la clé (elle reste « à traduire » au prochain run ; i18next
        // retombe sur `fallbackLng`). Surtout PAS le texte source, sinon les runs
        // suivants la croiraient déjà traduite et la conserveraient à tort.
        if (existing && typeof existing[k] === "string" && existing[k].trim()) out[k] = existing[k];
        stats.failed++; if (stats.failed <= 3) console.warn(`  ! ${k}: ${e.message}`);
      }
    }
  }
  return out;
}

// ---- Boucle principale ----
console.log(`Moteur=${PROVIDER} - source=${SOURCE_LANG} - cibles=${TARGETS.join(",")}`);
for (const target of TARGETS) {
  if (target === SOURCE_LANG) continue;
  const dir = path.join(LOCALES_DIR, target);
  const file = path.join(dir, `${NS}.json`);
  const existing = loadJson(file);
  const stats = { done: 0, kept: 0, failed: 0 };
  process.stdout.write(`-> ${target} ... `);
  const result = await translateTree(source, existing, target, stats);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`ok (${stats.done} traduites, ${stats.kept} conservees, ${stats.failed} echecs)`);
}
console.log("Termine. Ajoute les nouveaux codes a SUPPORTED_LANGUAGES (src/i18n.js) pour les afficher dans le selecteur.");
