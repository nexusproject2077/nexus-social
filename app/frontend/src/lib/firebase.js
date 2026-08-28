// Firebase Storage — upload direct navigateur → Firebase (les vidéos ne
// transitent plus par le backend Render, ce qui lève la limite de taille/durée
// et autorise les longues vidéos). L'upload est « resumable » : il reprend tout
// seul si la connexion coupe (indispensable sur mobile pour une vidéo de 59 min).
//
// La config Firebase « web » est PUBLIQUE (apiKey incluse) : elle peut être
// exposée côté client sans risque. La sécurité réelle vient des règles de
// sécurité Firebase Storage (voir les instructions de configuration).
import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";

// Config Firebase du projet « nexus-social ». Ces valeurs « web » sont PUBLIQUES
// par conception (elles sont livrées au navigateur) : les inclure dans le code
// ne présente aucun risque. La sécurité réelle vient des règles Storage.
// Les variables d'environnement, si présentes, restent prioritaires (utile pour
// pointer vers un autre projet sans toucher au code).
const config = {
  apiKey:
    process.env.REACT_APP_FIREBASE_API_KEY ||
    "AIzaSyDU8t0OEpveu5154NJIn5D6l-jU3yBdjL4",
  authDomain:
    process.env.REACT_APP_FIREBASE_AUTH_DOMAIN ||
    "nexus-social-733af.firebaseapp.com",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "nexus-social-733af",
  storageBucket:
    process.env.REACT_APP_FIREBASE_STORAGE_BUCKET ||
    "nexus-social-733af.firebasestorage.app",
  messagingSenderId:
    process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "858336748678",
  appId:
    process.env.REACT_APP_FIREBASE_APP_ID ||
    "1:858336748678:web:f1a694555f610594025d07",
};

// Firebase est utilisable seulement si le bucket + la clé sont fournis.
export const isFirebaseConfigured = Boolean(
  config.apiKey && config.storageBucket,
);

let _app = null;
function app() {
  if (!isFirebaseConfigured) return null;
  if (!_app) _app = getApps().length ? getApps()[0] : initializeApp(config);
  return _app;
}

/**
 * Téléverse un fichier vidéo vers Firebase Storage avec reprise + progression.
 * @param {File} file        Fichier à envoyer.
 * @param {string} userId    Id de l'utilisateur (rangement par dossier).
 * @param {(pct:number)=>void} onProgress  Callback 0..100.
 * @returns {Promise<string>} URL de téléchargement publique de la vidéo.
 */
export async function uploadVideoResumable(file, userId, onProgress) {
  if (!isFirebaseConfigured) throw new Error("Firebase non configuré");
  const a = app();
  // Authentification anonyme : donne une identité Firebase pour satisfaire les
  // règles de sécurité (write réservé aux utilisateurs authentifiés).
  const auth = getAuth(a);
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
    } catch {
      /* règles publiques éventuelles */
    }
  }
  const storage = getStorage(a);
  const safeExt =
    (file.name.split(".").pop() || "mp4")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "mp4";
  const path = `clips/${userId || "anon"}/${Date.now()}-${Math.random().toString(36).slice(2)}.${safeExt}`;
  const task = uploadBytesResumable(ref(storage, path), file, {
    contentType: file.type || "video/mp4",
  });

  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        if (onProgress && snap.totalBytes) {
          onProgress(
            Math.round((snap.bytesTransferred * 100) / snap.totalBytes),
          );
        }
      },
      (err) => reject(err),
      async () => {
        try {
          resolve(await getDownloadURL(task.snapshot.ref));
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}
