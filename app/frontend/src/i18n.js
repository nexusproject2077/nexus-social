import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Langues TOUJOURS embarquées dans le bundle principal : repli instantané, aucun
// « flash » de texte non traduit au premier rendu. Tout le RESTE est chargé À LA
// DEMANDE (un chunk webpack par langue) → on peut viser 240+ langues sans alourdir
// le bundle. Ajouter une langue = déposer ./locales/<code>/common.json (via le
// script de traduction) puis, pour l'afficher dans le sélecteur, l'ajouter ci-dessous.
import en from './locales/en/common.json';
import fr from './locales/fr/common.json';

// Catalogue proposé dans le sélecteur (nom natif). N'importe quelle langue listée
// ici et disposant d'un fichier de locale est chargée dynamiquement à la sélection.
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

// Langues écrites de droite à gauche (prévu pour l'expansion : hébreu, persan, ourdou…).
const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'ug'];

// Backend « lazy » : importe dynamiquement ./locales/<lng>/common.json. Webpack
// crée un chunk séparé par langue (rien n'est embarqué hormis en/fr). Si le fichier
// est absent ou illisible → objet vide → i18next retombe sur `fallbackLng` (en).
const lazyBackend = {
  type: 'backend',
  init() {},
  read(lng, ns, callback) {
    const base = (lng || 'en').split('-')[0];
    if (base === 'en') return callback(null, en);
    if (base === 'fr') return callback(null, fr);
    import(
      /* webpackChunkName: "locale-[request]" */
      `./locales/${base}/common.json`
    )
      .then((m) => callback(null, m.default || m))
      .catch(() => callback(null, {}));
  },
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
  .use(lazyBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // en/fr embarqués + reste via le backend lazy (combinaison autorisée par i18next).
    partialBundledLanguages: true,
    resources: { en: { common: en }, fr: { common: fr } },
    fallbackLng: 'en',
    // On autorise N'IMPORTE QUEL code (catalogue mondial) : le backend gère l'absence.
    supportedLngs: false,
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',   // 'fr-CA' → 'fr'
    defaultNS: 'common',
    ns: ['common'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'nexus_lang',
    },
  });

applyDirection(i18n.resolvedLanguage || i18n.language);
i18n.on('languageChanged', applyDirection);

// A-t-on un choix de langue EXPLICITE de l'utilisateur ? (sinon on peut affiner
// automatiquement via le pays). Utilisé par GeoContext pour combiner les signaux.
export function hasExplicitLanguageChoice() {
  try { return !!localStorage.getItem('nexus_lang'); } catch { return false; }
}

export default i18n;
