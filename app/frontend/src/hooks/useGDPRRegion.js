// useGDPRRegion.js - Hook pour détecter si l'utilisateur est en Europe (RGPD)

import { useState, useEffect } from 'react';

/**
 * Hook pour détecter si l'utilisateur est dans une région RGPD (UE/EEE)
 * Utilise l'API de géolocalisation IP gratuite
 */
export function useGDPRRegion() {
  const [isGDPRRegion, setIsGDPRRegion] = useState(null); // null = en cours de détection
  const [loading, setLoading] = useState(true);
  const [countryCode, setCountryCode] = useState(null);

  // Liste des pays de l'UE et EEE soumis au RGPD
  const GDPR_COUNTRIES = [
    // Union Européenne (27 pays)
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
    // Espace Économique Européen (EEE)
    'IS', 'LI', 'NO',
    // Royaume-Uni (UK GDPR)
    'GB',
    // Suisse (loi similaire)
    'CH'
  ];

  useEffect(() => {
    detectRegion();
  }, []);

  const detectRegion = async () => {
    try {
      // Vérifier d'abord le cache
      const cached = localStorage.getItem('gdpr_region_check');
      if (cached) {
        const { isGDPR, country, timestamp } = JSON.parse(cached);
        // Cache valide 24h
        if (Date.now() - timestamp < 24 * 60 * 60 * 1000) {
          setIsGDPRRegion(isGDPR);
          setCountryCode(country);
          setLoading(false);
          return;
        }
      }

      // API gratuite de géolocalisation IP
      // Alternatives : ipapi.co, ip-api.com, ipinfo.io
      const response = await fetch('https://ipapi.co/json/', {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Geolocation API failed');
      }

      const data = await response.json();
      const userCountry = data.country_code || data.country;
      const isInGDPRRegion = GDPR_COUNTRIES.includes(userCountry);

      // Sauvegarder dans le cache
      localStorage.setItem('gdpr_region_check', JSON.stringify({
        isGDPR: isInGDPRRegion,
        country: userCountry,
        timestamp: Date.now()
      }));

      setCountryCode(userCountry);
      setIsGDPRRegion(isInGDPRRegion);
      setLoading(false);

      console.log(`🌍 Région détectée: ${userCountry} - RGPD: ${isInGDPRRegion ? 'OUI' : 'NON'}`);

    } catch (error) {
      console.error('Erreur détection région:', error);
      
      // En cas d'erreur, par défaut on applique le RGPD (principe de précaution)
      setIsGDPRRegion(true);
      setLoading(false);
      
      console.warn('⚠️ Détection géographique échouée - Application du RGPD par défaut');
    }
  };

  const forceGDPRMode = (enabled) => {
    setIsGDPRRegion(enabled);
    localStorage.setItem('gdpr_region_check', JSON.stringify({
      isGDPR: enabled,
      country: 'FORCED',
      timestamp: Date.now()
    }));
  };

  return {
    isGDPRRegion,      // true/false/null
    loading,           // boolean
    countryCode,       // 'FR', 'US', etc.
    forceGDPRMode      // fonction pour forcer le mode
  };
}

/**
 * Composant wrapper pour afficher du contenu uniquement en région RGPD
 */
export function GDPROnly({ children, fallback = null }) {
  const { isGDPRRegion, loading } = useGDPRRegion();

  if (loading) {
    return fallback;
  }

  return isGDPRRegion ? children : fallback;
}

/**
 * Composant wrapper pour afficher du contenu en dehors de la région RGPD
 */
export function NonGDPROnly({ children, fallback = null }) {
  const { isGDPRRegion, loading } = useGDPRRegion();

  if (loading) {
    return fallback;
  }

  return !isGDPRRegion ? children : fallback;
}
