import { useEffect, useRef, useState } from "react";
import { useGeo } from "@/context/GeoContext";
import { isPrivacyStrict, onPrivacyStrictChange } from "@/lib/privacyStrict";
import axios from "axios";
import { API } from "../App";

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

const getAdTargeting = () => {
  try {
    return { personalized_ads: false, third_party_data: false, geo_targeting: false, ...JSON.parse(window.localStorage?.getItem("nexus_ad_targeting") || "{}") };
  } catch {
    return { personalized_ads: false, third_party_data: false, geo_targeting: false };
  }
};

export default function AdSense({ slot, format = "auto" }) {
  const initialized = useRef(false);
  const { restricted } = useGeo();
  const [strict, setStrict] = useState(isPrivacyStrict());
  const [targeting, setTargeting] = useState(getAdTargeting);

  // Réagit en direct au Mode Confidentialité stricte (les pubs disparaissent /
  // réapparaissent sans rechargement de page).
  useEffect(() => onPrivacyStrictChange(setStrict), []);
  useEffect(() => {
    const refresh = () => setTargeting(getAdTargeting());
    window.addEventListener("nexus:ad-targeting-change", refresh);
    return () => window.removeEventListener("nexus:ad-targeting-change", refresh);
  }, []);
  useEffect(() => {
    axios.get(`${API}/users/me/ad-targeting`).then((response) => {
      const saved = response.data || getAdTargeting();
      localStorage.setItem("nexus_ad_targeting", JSON.stringify(saved));
      setTargeting(saved);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    // Aucune pub pour les visiteurs restreints (UE), les membres Premium, ni en
    // Mode Confidentialité stricte (pas de pub ciblée sans consentement clair).
    if (strict || restricted || isPremiumUser() || !ADSENSE_CLIENT || !slot || !adsAllowed() || initialized.current) return;
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
      window.adsbygoogle.requestNonPersonalizedAds = NON_PERSONALIZED || !targeting.personalized_ads ? 1 : 0;
      window.adsbygoogle.push({});
    } catch {
      /* le script n'est pas encore prêt : AdSense réessaiera au chargement */
    }
  }, [slot, restricted, strict, targeting.personalized_ads]);

  // Rien n'est rendu si mode strict, restreint (UE), Premium, non configuré, ou non consenti.
  if (strict || restricted || isPremiumUser() || !ADSENSE_CLIENT || !slot || !adsAllowed()) return null;

  return (
    <ins
      className="adsbygoogle"
      style={{ display: "block" }}
      data-ad-client={ADSENSE_CLIENT}
      data-ad-slot={slot}
      data-ad-format={format}
      data-full-width-responsive="true"
      data-npa={NON_PERSONALIZED || !targeting.personalized_ads ? "1" : undefined}
    />
  );
}
