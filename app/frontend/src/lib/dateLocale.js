/**
 * Mappe la langue i18n active vers une locale date-fns.
 * Utilisé pour formatDistanceToNow, toLocaleDateString, etc.
 */
import { fr, enUS, es, de, it, pt, nl, pl, tr, ru, uk, ar, hi, zhCN, ja, ko } from "date-fns/locale";

const MAP = {
  en: enUS,
  fr,
  es,
  de,
  it,
  pt,
  nl,
  pl,
  tr,
  ru,
  uk,
  ar,
  hi,
  zh: zhCN,
  ja,
  ko,
};

/** BCP-47 tag for native Date.toLocale* */
const BCP47 = {
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-PT",
  nl: "nl-NL",
  pl: "pl-PL",
  tr: "tr-TR",
  ru: "ru-RU",
  uk: "uk-UA",
  ar: "ar-SA",
  hi: "hi-IN",
  zh: "zh-CN",
  ja: "ja-JP",
  ko: "ko-KR",
};

export function getDateFnsLocale(lang) {
  const base = (lang || "en").split("-")[0];
  return MAP[base] || enUS;
}

export function getBcp47(lang) {
  const base = (lang || "en").split("-")[0];
  return BCP47[base] || "en-US";
}

/**
 * Relative time with correct locale (e.g. "il y a 24 jours" / "24 days ago" / "24 gün önce")
 */
export function formatRelative(date, lang, formatDistanceToNow) {
  try {
    return formatDistanceToNow(new Date(date), {
      addSuffix: true,
      locale: getDateFnsLocale(lang),
    });
  } catch {
    return "";
  }
}
