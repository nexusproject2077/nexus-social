import { useEffect, useRef } from "react";

// Identifiant éditeur AdSense (ex. "ca-pub-XXXXXXXXXXXX"), fourni via l'env.
// Vide par défaut => aucune publicité, aucun script chargé.
const ADSENSE_CLIENT = process.env.REACT_APP_ADSENSE_CLIENT || "";

// Les publicités ne se chargent QUE si l'utilisateur a accepté les cookies.
// (Obligation RGPD : pas de tracking publicitaire avant consentement.)
const adsAllowed = () =>
  typeof window !== "undefined" &&
  window.localStorage?.getItem("cookie_consent") === "accepted";

export default function AdSense({ slot, format = "auto" }) {
  const initialized = useRef(false);

  useEffect(() => {
    if (!ADSENSE_CLIENT || !slot || !adsAllowed() || initialized.current) return;
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
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* le script n'est pas encore prêt : AdSense réessaiera au chargement */
    }
  }, [slot]);

  // Rien n'est rendu tant qu'AdSense n'est pas configuré + consenti.
  if (!ADSENSE_CLIENT || !slot || !adsAllowed()) return null;

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
