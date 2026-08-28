import { useEffect, useRef } from "react";
import { useGeo } from "@/context/GeoContext";
import { useTranslation } from "react-i18next";

// Identifiant éditeur AdSense (ex. "ca-pub-XXXXXXXXXXXX").
// La valeur peut être surchargée via l'env ; à défaut on utilise l'ID du site
// (déjà public via la balise google-adsense-account dans index.html).
const ADSENSE_CLIENT =
  process.env.REACT_APP_ADSENSE_CLIENT || "ca-pub-5825303311354202";

// Pubs non personnalisées par défaut (moins risqué RGPD).
// Mettre REACT_APP_ADSENSE_NPA="false" pour autoriser la personnalisation.
const NON_PERSONALIZED = process.env.REACT_APP_ADSENSE_NPA !== "false";

// Les publicités ne se chargent QUE si l'utilisateur a accepté les cookies.
// (Obligation RGPD : pas de tracking publicitaire avant consentement.)
const adsAllowed = () =>
  typeof window !== "undefined" &&
  window.localStorage?.getItem("cookie_consent") === "accepted";

// Avantage Premium RÉEL : les membres Premium ne voient aucune publicité.
const isPremiumUser = () => {
  try {
    const u = JSON.parse(window.localStorage?.getItem("nexus_user") || "null");
    return !!u?.is_premium;
  } catch {
    return false;
  }
};

export default function AdSense({ slot, format = "auto" }) {
  const { t } = useTranslation();
  const initialized = useRef(false);
  const { restricted } = useGeo();

  useEffect(() => {
    // Aucune pub pour les visiteurs restreints (UE) ni pour les membres Premium.
    if (
      restricted ||
      isPremiumUser() ||
      !ADSENSE_CLIENT ||
      !slot ||
      !adsAllowed() ||
      initialized.current
    )
      return;
    initialized.current = true;

    // Charge le script AdSense une seule fois, uniquement après consentement.
    if (!document.querySelector("script[data-adsbygoogle]")) {
      const script = document.createElement("script");
      script.async = true;
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`;
      script.crossOrigin = "anonymous";
      script.setAttribute("data-adsbygoogle", "1");
      document.head.appendChild(script);
    }

    try {
      window.adsbygoogle = window.adsbygoogle || [];
      // Hors-UE : pubs personnalisées (accès complet) sauf si NPA forcé par l'env.
      if (NON_PERSONALIZED) {
        window.adsbygoogle.requestNonPersonalizedAds = 1;
      }
      window.adsbygoogle.push({});
    } catch {
      /* le script n'est pas encore prêt : AdSense réessaiera au chargement */
    }
  }, [slot, restricted]);

  // Rien n'est rendu si restreint (UE), Premium, non configuré, ou non consenti.
  if (
    restricted ||
    isPremiumUser() ||
    !ADSENSE_CLIENT ||
    !slot ||
    !adsAllowed()
  )
    return null;

  return (
    <ins
      className="adsbygoogle"
      style={{ display: "block" }}
      data-ad-client={ADSENSE_CLIENT}
      data-ad-slot={slot}
      data-ad-format={format}
      data-full-width-responsive="true"
    />
  );
}
