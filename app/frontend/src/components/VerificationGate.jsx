// Gate de vérification BLOQUANT (obligatoire pour TOUS les comptes) :
//   Étape 1 — âge (loi FR >= 15 ans)
//   Étape 2 — pièce d'identité (obligatoire : tant qu'aucune pièce n'est soumise,
//             l'accès est bloqué). Une fois soumise (en cours de revue) ou
//             validée, l'accès est débloqué.
// Les admins sont exemptés (ils doivent pouvoir traiter les demandes).
import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import IdCameraCapture from "@/components/IdCameraCapture";

const ACCENT = (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee";
const IN = { background: "#131b2e", color: "#dae2fd", border: "1px solid #2a3550" };

export default function VerificationGate({ user, setUser }) {
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  // Étape âge
  const [birthdate, setBirthdate] = useState("");
  // Étape pièce + selfie
  const [docType, setDocType] = useState("id_card");
  const [idFile, setIdFile] = useState(null);
  const [selfieFile, setSelfieFile] = useState(null);

  const needAge = user?.age_verified !== true;
  const status = user?.verification_status || "unverified";
  const waiting = !needAge && status === "pending";  // soumis → en attente de validation
  const needId = !needAge && (status === "unverified" || status === "rejected");

  // Motif du refus (pour l'afficher précisément dans le pop-up).
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (status === "rejected") {
      axios.get(`${API}/verify/status`).then((r) => setReason(r.data?.rejection_reason || "")).catch(() => {});
    }
  }, [status]);

  const refresh = async () => {
    try { const me = await axios.get(`${API}/auth/me`); setUser && setUser(me.data); }
    catch { window.location.reload(); }
  };
  const logout = () => {
    try { localStorage.removeItem("token"); localStorage.removeItem("nexus_user"); } catch { /* ignore */ }
    window.location.href = "/auth";
  };

  const submitAge = async () => {
    if (!birthdate) return toast.error("Indique ta date de naissance.");
    setBusy(true);
    try {
      await axios.post(`${API}/verify/age`, { birthdate });
      await refresh();
      toast.success("Âge confirmé.");
    } catch (e) {
      if (e.response?.status === 403) setBlocked(true);
      else toast.error(e.response?.data?.detail || "Impossible d'enregistrer.");
    } finally { setBusy(false); }
  };

  const submitId = async () => {
    if (!idFile) return toast.error("Prends d'abord la photo de ta pièce.");
    if (!selfieFile) return toast.error("Prends ton selfie pour valider.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", idFile); fd.append("selfie", selfieFile); fd.append("doc_type", docType);
      await axios.post(`${API}/verify/identity/submit`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      await refresh();
      toast.success("Pièce + selfie envoyés. Vérification en cours.");
    } catch (e) { toast.error(e.response?.data?.detail || "Envoi impossible."); }
    finally { setBusy(false); }
  };

  const Wrap = ({ children }) => (
    <div className="fixed inset-0 z-[999] flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      style={{ background: "rgba(3,7,18,0.94)", backdropFilter: "blur(6px)" }}>
      <div className="w-full max-w-sm rounded-3xl p-6 my-auto max-h-[92vh] overflow-y-auto"
        style={{ background: "#0b1326", border: "1px solid rgba(255,255,255,0.08)", WebkitOverflowScrolling: "touch" }}>
        {children}
      </div>
    </div>
  );

  if (blocked) {
    return (
      <Wrap>
        <div className="text-center">
          <span className="material-symbols-outlined text-5xl mb-2" style={{ color: "#f87171" }}>block</span>
          <h2 className="font-black text-lg mb-2" style={{ color: "#dae2fd" }}>Accès non autorisé</h2>
          <p className="text-sm mb-5" style={{ color: "#859397" }}>
            La loi française interdit l'accès aux réseaux sociaux avant 15 ans. Ton compte a été suspendu.
          </p>
          <button onClick={logout} className="w-full py-3 rounded-2xl font-bold" style={{ background: "#171f33", color: "#dae2fd" }}>Se déconnecter</button>
        </div>
      </Wrap>
    );
  }

  // Étape 1 — âge
  if (needAge) {
    return (
      <Wrap>
        <div className="text-center mb-4">
          <span className="material-symbols-outlined text-4xl mb-1" style={{ color: ACCENT }}>cake</span>
          <h2 className="font-black text-lg" style={{ color: "#dae2fd" }}>Confirme ton âge</h2>
          <p className="text-sm mt-1" style={{ color: "#859397" }}>
            Obligation légale : indique ta date de naissance pour continuer (âge minimum : 15 ans).
          </p>
        </div>
        <input type="date" value={birthdate} max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setBirthdate(e.target.value)}
          className="w-full mb-4 px-4 py-3 rounded-2xl outline-none text-sm" style={{ ...IN, colorScheme: "dark" }} />
        <button disabled={busy} onClick={submitAge} className="w-full py-3 rounded-2xl font-black disabled:opacity-40"
          style={{ background: ACCENT, color: "#00363e" }}>{busy ? "Vérification…" : "Confirmer"}</button>
        <p className="text-center text-[11px] mt-3" style={{ color: "#5b6b8c" }}>Date chiffrée, jamais publique (RGPD).</p>
      </Wrap>
    );
  }

  // En attente de validation — l'utilisateur NE PEUT PAS utiliser l'app tant que
  // l'admin n'a pas validé (règle : mise en attente après soumission).
  if (waiting) {
    return (
      <Wrap>
        <div className="text-center">
          <span className="material-symbols-outlined text-5xl mb-2" style={{ color: "#f0b429" }}>hourglass_top</span>
          <h2 className="font-black text-lg mb-2" style={{ color: "#dae2fd" }}>Compte en attente de validation</h2>
          <p className="text-sm mb-4" style={{ color: "#859397" }}>
            Ta pièce d'identité et ton selfie ont bien été reçus. Un administrateur les vérifie
            (généralement sous 24–72 h). Tu pourras accéder à Nexus Social dès la validation —
            tu recevras une notification.
          </p>
          <button onClick={() => refresh()} className="w-full py-3 rounded-2xl font-bold mb-2" style={{ background: ACCENT, color: "#00363e" }}>
            Actualiser
          </button>
          <button onClick={logout} className="w-full py-2 text-xs" style={{ color: "#5b6b8c" }}>Se déconnecter</button>
        </div>
      </Wrap>
    );
  }

  // Étape 2 — pièce d'identité (obligatoire)
  if (needId) {
    return (
      <Wrap>
        <div className="text-center mb-4">
          <span className="material-symbols-outlined text-4xl mb-1" style={{ color: ACCENT }}>badge</span>
          <h2 className="font-black text-lg" style={{ color: "#dae2fd" }}>Vérifie ton identité</h2>
          <p className="text-sm mt-1" style={{ color: "#859397" }}>
            Nexus Social exige une vérification d'identité pour tous les comptes (anti-faux comptes, sécurité).
            Envoie une photo nette de ta pièce pour continuer.
          </p>
        </div>
        {status === "rejected" && (
          <div className="px-3 py-2 rounded-lg mb-3" style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)" }}>
            <p className="text-xs font-bold" style={{ color: "#f87171" }}>Vérification refusée</p>
            <p className="text-xs mt-0.5" style={{ color: "#f8b4b4" }}>
              Motif : {reason || "document non conforme"}. Merci de recommencer avec une photo nette et lisible.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-2 mb-3">
          {[["id_card", "Carte d'identité"], ["passport", "Passeport"], ["residence_permit", "Titre de séjour"]].map(([v, l]) => (
            <button key={v} onClick={() => setDocType(v)} className="px-3 py-1.5 rounded-lg text-xs font-bold"
              style={{ background: docType === v ? ACCENT : "#131b2e", color: docType === v ? "#00363e" : "#859397", border: "1px solid #2a3550" }}>{l}</button>
          ))}
        </div>
        {/* Étape A : pièce (caméra arrière) */}
        <p className="text-[11px] font-bold mb-1 mt-1" style={{ color: idFile ? ACCENT : "#bbc9cd" }}>
          1. Photo de ta pièce {idFile ? "✓" : ""}
        </p>
        <IdCameraCapture onCapture={setIdFile} facingMode="environment" />

        {/* Étape B : selfie (caméra avant) — apparaît une fois la pièce prise */}
        {idFile && (
          <div className="mt-4">
            <p className="text-[11px] font-bold mb-1" style={{ color: selfieFile ? ACCENT : "#bbc9cd" }}>
              2. Selfie (visage) {selfieFile ? "✓" : ""}
            </p>
            <IdCameraCapture onCapture={setSelfieFile} facingMode="user" />
          </div>
        )}

        <button disabled={busy || !idFile || !selfieFile} onClick={submitId} className="w-full mt-4 py-3 rounded-2xl font-black disabled:opacity-40"
          style={{ background: (idFile && selfieFile) ? ACCENT : "#171f33", color: (idFile && selfieFile) ? "#00363e" : "#5b6b8c" }}>{busy ? "Envoi…" : "Envoyer pour vérification"}</button>
        <p className="text-center text-[11px] mt-3" style={{ color: "#5b6b8c" }}>
          Photos prises en direct, chiffrées, jamais publiques, supprimées après vérification (RGPD).
        </p>
        <button onClick={logout} className="w-full mt-2 py-2 text-xs" style={{ color: "#5b6b8c" }}>Se déconnecter</button>
      </Wrap>
    );
  }

  return null;
}
