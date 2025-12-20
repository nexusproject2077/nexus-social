import { useEffect, useRef } from "react";
import axios from "axios";
import { API } from "@/App";

/**
 * Hook pour tracker le temps passé sur l'application
 * Enregistre automatiquement les sessions et envoie les stats au backend
 */
export function useTimeTracking(user) {
  const startTimeRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const sessionIdRef = useRef(null);
  const intervalIdRef = useRef(null);

  useEffect(() => {
    if (!user) return;

    // Démarrer une nouvelle session
    const startSession = async () => {
      try {
        const response = await axios.post(`${API}/users/me/sessions/start`);
        sessionIdRef.current = response.data.session_id;
        startTimeRef.current = Date.now();
        console.log("📊 Session démarrée:", sessionIdRef.current);
      } catch (error) {
        console.error("Erreur démarrage session:", error);
      }
    };

    // Mettre à jour l'activité
    const updateActivity = async () => {
      if (!sessionIdRef.current) return;

      const now = Date.now();
      const timeSinceLastActivity = now - lastActivityRef.current;

      // Si plus de 5 minutes d'inactivité, terminer la session
      if (timeSinceLastActivity > 5 * 60 * 1000) {
        await endSession();
        await startSession();
        return;
      }

      // Envoyer un ping toutes les 30 secondes
      try {
        await axios.post(`${API}/users/me/sessions/${sessionIdRef.current}/ping`);
      } catch (error) {
        console.error("Erreur ping session:", error);
      }
    };

    // Terminer la session
    const endSession = async () => {
      if (!sessionIdRef.current || !startTimeRef.current) return;

      const duration = Math.floor((Date.now() - startTimeRef.current) / 1000 / 60); // en minutes

      try {
        await axios.post(`${API}/users/me/sessions/${sessionIdRef.current}/end`, {
          duration,
        });
        console.log("📊 Session terminée:", duration, "minutes");
      } catch (error) {
        console.error("Erreur fin session:", error);
      }

      sessionIdRef.current = null;
      startTimeRef.current = null;
    };

    // Détecter l'activité utilisateur
    const handleActivity = () => {
      lastActivityRef.current = Date.now();
    };

    // Events pour détecter l'activité
    const events = ["mousedown", "keydown", "scroll", "touchstart", "click"];
    events.forEach((event) => {
      window.addEventListener(event, handleActivity);
    });

    // Démarrer la session
    startSession();

    // Ping toutes les 30 secondes
    intervalIdRef.current = setInterval(updateActivity, 30000);

    // Cleanup
    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });

      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
      }

      endSession();
    };
  }, [user]);

  // Gérer la fermeture de l'onglet/navigateur
  useEffect(() => {
    if (!user) return;

    const handleBeforeUnload = async () => {
      if (sessionIdRef.current && startTimeRef.current) {
        const duration = Math.floor((Date.now() - startTimeRef.current) / 1000 / 60);
        
        // Utiliser sendBeacon pour envoyer les données même si la page se ferme
        navigator.sendBeacon(
          `${API}/users/me/sessions/${sessionIdRef.current}/end`,
          JSON.stringify({ duration })
        );
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [user]);
}
