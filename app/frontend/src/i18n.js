import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en/common.json';
import fr from './locales/fr/common.json';
import es from './locales/es/common.json';
import de from './locales/de/common.json';
import it from './locales/it/common.json';
import pt from './locales/pt/common.json';
import nl from './locales/nl/common.json';
import pl from './locales/pl/common.json';
import tr from './locales/tr/common.json';
import ru from './locales/ru/common.json';
import uk from './locales/uk/common.json';
import ar from './locales/ar/common.json';
import hi from './locales/hi/common.json';
import zh from './locales/zh/common.json';
import ja from './locales/ja/common.json';
import ko from './locales/ko/common.json';

// Liste des langues proposées dans le sélecteur (nom affiché dans la langue elle-même).
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'ru', label: 'Русский' },
  { code: 'uk', label: 'Українська' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
];

// Langues écrites de droite à gauche.
const RTL_LANGUAGES = ['ar'];

const resources = {
  en: { common: en },
  fr: { common: fr },
  es: { common: es },
  de: { common: de },
  it: { common: it },
  pt: { common: pt },
  nl: { common: nl },
  pl: { common: pl },
  tr: { common: tr },
  ru: { common: ru },
  uk: { common: uk },
  ar: { common: ar },
  hi: { common: hi },
  zh: { common: zh },
  ja: { common: ja },
  ko: { common: ko },
};

// Applique la direction du texte (LTR/RTL) selon la langue active.
function applyDirection(lng) {
  if (typeof document === 'undefined') return;
  const base = (lng || 'en').split('-')[0];
  const dir = RTL_LANGUAGES.includes(base) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', base);
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true,
    defaultNS: 'common',
    ns: ['common'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'nexus_lang',
    },
  });

applyDirection(i18n.resolvedLanguage || i18n.language);
i18n.on('languageChanged', applyDirection);

export default i18n;
