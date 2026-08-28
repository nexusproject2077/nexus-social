// Métadonnées des guides/articles de Nexus Social. Le TEXTE (titre, extrait et
// corps HTML de confiance) vit dans les traductions i18n, sous le namespace
// « guides » : guides.<slug>_title / _excerpt / _html, et les libellés de
// catégorie sous guides.cat_<clé>. Cela permet de traduire tout le contenu
// éditorial dans toutes les langues via le pipeline de traduction.

// Ordre d'affichage des catégories dans l'index des guides.
export const CATEGORY_KEYS = [
  "demarrage",
  "fonctionnalites",
  "securite",
  "communaute",
];

// Un article = ses métadonnées. Le contenu rédactionnel est dans i18n (voir plus haut).
export const ARTICLES = [
  {
    slug: "bien-utiliser-les-stories",
    category: "fonctionnalites",
    date: "2026-08-09",
    readMins: 6,
  },
  {
    slug: "securite-proteger-son-compte",
    category: "securite",
    date: "2026-08-09",
    readMins: 7,
  },
  {
    slug: "reussir-ses-nexus-clips",
    category: "fonctionnalites",
    date: "2026-08-09",
    readMins: 7,
  },
  {
    slug: "publier-son-premier-post",
    category: "demarrage",
    date: "2026-08-09",
    readMins: 6,
  },
  {
    slug: "confidentialite-maitriser-son-audience",
    category: "securite",
    date: "2026-08-09",
    readMins: 6,
  },
  {
    slug: "regles-de-la-communaute",
    category: "communaute",
    date: "2026-08-09",
    readMins: 6,
  },
  {
    slug: "notifications-et-temps-decran",
    category: "demarrage",
    date: "2026-08-09",
    readMins: 5,
  },
  {
    slug: "messagerie-et-instantanes",
    category: "fonctionnalites",
    date: "2026-08-09",
    readMins: 6,
  },
];

export const getArticle = (slug) =>
  ARTICLES.find((a) => a.slug === slug) || null;
export const getRelated = (slug, n = 3) =>
  ARTICLES.filter((a) => a.slug !== slug).slice(0, n);
