import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en/common.json';
import fr from './locales/fr/common.json';
import tr from './locales/tr/common.json';
import ru from './locales/ru/common.json';
import uk from './locales/uk/common.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'ru', label: 'Русский' },
  { code: 'uk', label: 'Українська' },
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: en },
      fr: { common: fr },
      tr: { common: tr },
      ru: { common: ru },
      uk: { common: uk },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr', 'tr', 'ru', 'uk'],
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

export default i18n;
