// Page « Vérifier mon identité » (3 niveaux : email/téléphone, pièce d'identité,
// monétisation). Aucune donnée sensible n'est conservée côté client ; la pièce
// est envoyée au backend qui la chiffre puis la met en revue.
import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import IdCameraCapture from "@/components/IdCameraCapture";

const ACCENT = (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee";
const CARD = { background: "#171f33", border: "1px solid rgba(255,255,255,0.05)" };

function Row({ children }) {
  return <div className="rounded-2xl p-4 mb-4" style={CARD}>{children}</div>;
}

function CheckPill({ ok, label }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full"
      style={{ background: ok ? "rgba(34,211,238,0.15)" : "rgba(255,255,255,0.06)", color: ok ? ACCENT : "#859397" }}>
      <span className="material-symbols-outlined text-[15px]">{ok ? "check_circle" : "radio_button_unchecked"}</span>
      {label}
    </span>
  );
}

export default function IdentityVerification() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);

  const [emailSent, setEmailSent] = useState(false);
  const [emailCode, setEmailCode] = useState("");

  const [phone, setPhone] = useState("");
  const [phoneSent, setPhoneSent] = useState(false);
  const [phoneCode, setPhoneCode] = useState("");

  const [docType, setDocType] = useState("id_card");
  const [idFile, setIdFile] = useState(null);
  const [selfieFile, setSelfieFile] = useState(null);

  const load = () => axios.get(`${API}/verify/status`).then((r) => setSt(r.data)).catch(() => setSt({}));
  useEffect(() => { load(); }, []);

  // --- Email OTP ---
  const sendEmail = async () => {
    setBusy(true);
    try {
      const r = await axios.post(`${API}/verify/email/send`);
      setEmailSent(true);
      if (r.data?.dev_code) toast.message(`Code (démo) : ${r.data.dev_code}`, { description: "Configure Brevo pour l'envoyer par email en prod." });
      else toast.success("Code envoyé par email.");
    } catch (e) { toast.error(e.response?.data?.detail || "Échec de l'envoi."); }
    finally { setBusy(false); }
  };
  const confirmEmail = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/verify/email/confirm`, { code: emailCode.trim() });
      toast.success("Email vérifié ✓"); setEmailSent(false); setEmailCode(""); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Code invalide."); }
    finally { setBusy(false); }
  };

  // --- Phone OTP ---
  const sendPhone = async () => {
    if (phone.trim().length < 6) return toast.error("Numéro invalide.");
    setBusy(true);
    try {
      const r = await axios.post(`${API}/verify/phone/send`, { phone: phone.trim() });
      setPhoneSent(true);
      if (r.data?.dev_code) toast.message(`Code (démo) : ${r.data.dev_code}`, { description: "Configure un fournisseur SMS pour l'envoyer en prod." });
      else toast.success("Code envoyé par SMS.");
    } catch (e) { toast.error(e.response?.data?.detail || "Échec de l'envoi."); }
    finally { setBusy(false); }
  };
  const confirmPhone = async () => {
    setBusy(true);
    try {
      await axios.post(`${API}/verify/phone/confirm`, { code: phoneCode.trim() });
      toast.success("Téléphone vérifié ✓"); setPhoneSent(false); setPhoneCode(""); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Code invalide."); }
    finally { setBusy(false); }
  };

  // --- Pièce d'identité ---
  const submitDoc = async () => {
    if (!idFile) return toast.error("Prends la photo de ta pièce.");
    if (!selfieFile) return toast.error("Prends ton selfie.");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", idFile);
      fd.append("selfie", selfieFile);
      fd.append("doc_type", docType);
      await axios.post(`${API}/verify/identity/submit`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success("Pièce + selfie envoyés. Vérification en cours.");
      setIdFile(null); setSelfieFile(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Envoi impossible."); }
    finally { setBusy(false); }
  };

  if (!st) {
    return <div className="flex justify-center py-10"><div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: ACCENT }} /></div>;
  }

  const status = st.status || "unverified";
  const banner = {
    verified: { txt: "Identité vérifiée", sub: "Ton compte affiche le badge « Vérifié ».", icon: "verified", color: ACCENT },
    pending:  { txt: "Vérification en cours", sub: "Ta pièce d'identité est en cours d'examen (24-72 h).", icon: "hourglass_top", color: "#f0b429" },
    rejected: { txt: "Vérification refusée", sub: st.rejection_reason || "Document non conforme. Tu peux re-soumettre.", icon: "error", color: "#f87171" },
    unverified: { txt: "Non vérifié", sub: "Vérifie ton identité pour obtenir le badge et débloquer la monétisation.", icon: "gpp_maybe", color: "#859397" },
  }[status];

  return (
    <div>
      {/* Bandeau statut global */}
      <Row>
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-3xl" style={{ color: banner.color, fontVariationSettings: "'FILL' 1" }}>{banner.icon}</span>
          <div className="flex-1 min-w-0">
            <p className="font-black" style={{ color: "#dae2fd" }}>{banner.txt}</p>
            <p className="text-xs mt-0.5" style={{ color: "#859397" }}>{banner.sub}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <CheckPill ok={st.age_verified} label="Âge ≥ 15" />
          <CheckPill ok={st.email_verified} label="Email" />
          <CheckPill ok={st.phone_verified} label="Téléphone" />
          <CheckPill ok={st.identity_verified} label="Pièce d'identité" />
        </div>
      </Row>

      {/* Niveau 1 — Email */}
      <p className="text-[11px] font-bold uppercase tracking-widest mb-2 px-1" style={{ color: "#859397" }}>Vérification basique</p>
      <Row>
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-sm font-medium" style={{ color: "#dae2fd" }}>Adresse email</p>
            <p className="text-xs" style={{ color: "#859397" }}>Confirme ton email avec un code.</p></div>
          {st.email_verified ? <CheckPill ok label="Vérifié" /> : (
            !emailSent
              ? <button disabled={busy} onClick={sendEmail} className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40" style={{ background: ACCENT, color: "#00363e" }}>Envoyer le code</button>
              : null
          )}
        </div>
        {!st.email_verified && emailSent && (
          <div className="flex gap-2 mt-3">
            <input value={emailCode} onChange={(e) => setEmailCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="Code à 6 chiffres"
              className="flex-1 text-sm px-3 py-2 rounded-xl outline-none" style={{ background: "#0b1326", color: "#dae2fd", border: "1px solid #2a3550" }} />
            <button disabled={busy} onClick={confirmEmail} className="px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-40" style={{ background: ACCENT, color: "#00363e" }}>Valider</button>
          </div>
        )}
      </Row>

      {/* Niveau 1 — Téléphone */}
      <Row>
        <div className="flex items-center justify-between gap-3">
          <div><p className="text-sm font-medium" style={{ color: "#dae2fd" }}>Numéro de téléphone</p>
            <p className="text-xs" style={{ color: "#859397" }}>Reçois un code par SMS.</p></div>
          {st.phone_verified && <CheckPill ok label="Vérifié" />}
        </div>
        {!st.phone_verified && (
          <div className="mt-3 space-y-2">
            {!phoneSent ? (
              <div className="flex gap-2">
                <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="+33 6 12 34 56 78"
                  className="flex-1 text-sm px-3 py-2 rounded-xl outline-none" style={{ background: "#0b1326", color: "#dae2fd", border: "1px solid #2a3550" }} />
                <button disabled={busy} onClick={sendPhone} className="px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-40" style={{ background: ACCENT, color: "#00363e" }}>Envoyer</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input value={phoneCode} onChange={(e) => setPhoneCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder="Code à 6 chiffres"
                  className="flex-1 text-sm px-3 py-2 rounded-xl outline-none" style={{ background: "#0b1326", color: "#dae2fd", border: "1px solid #2a3550" }} />
                <button disabled={busy} onClick={confirmPhone} className="px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-40" style={{ background: ACCENT, color: "#00363e" }}>Valider</button>
              </div>
            )}
          </div>
        )}
      </Row>

      {/* Niveau 2 — Pièce d'identité */}
      <p className="text-[11px] font-bold uppercase tracking-widest mb-2 mt-5 px-1" style={{ color: "#859397" }}>Vérification renforcée (badge)</p>
      <Row>
        {st.identity_verified ? (
          <div className="flex items-center gap-2"><span className="material-symbols-outlined" style={{ color: ACCENT }}>verified</span>
            <p className="text-sm" style={{ color: "#dae2fd" }}>Ta pièce a été validée. Badge « Vérifié » actif.</p></div>
        ) : status === "pending" ? (
          <div className="flex items-center gap-2"><span className="material-symbols-outlined" style={{ color: "#f0b429" }}>hourglass_top</span>
            <p className="text-sm" style={{ color: "#dae2fd" }}>Examen en cours — tu recevras une notification.</p></div>
        ) : (
          <div className="space-y-3">
            {status === "rejected" && (
              <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(248,113,113,0.12)", color: "#f87171" }}>
                Refusé : {st.rejection_reason || "document non conforme"}. Tu peux re-soumettre.
              </p>
            )}
            <p className="text-xs" style={{ color: "#859397" }}>
              Prends une photo <b>en direct</b> de ta pièce (carte d'identité, passeport ou titre de séjour) — pas
              d'import de fichier, pour éviter les images retouchées. Le document est <b>chiffré</b>, jamais public,
              et supprimé après vérification.
            </p>
            <div className="flex flex-wrap gap-2">
              {[["id_card", "Carte d'identité"], ["passport", "Passeport"], ["residence_permit", "Titre de séjour"]].map(([v, l]) => (
                <button key={v} onClick={() => setDocType(v)} className="px-3 py-1.5 rounded-lg text-xs font-bold"
                  style={{ background: docType === v ? ACCENT : "#0b1326", color: docType === v ? "#00363e" : "#859397", border: "1px solid #2a3550" }}>{l}</button>
              ))}
            </div>
            <p className="text-[11px] font-bold" style={{ color: idFile ? ACCENT : "#bbc9cd" }}>1. Photo de ta pièce {idFile ? "✓" : ""}</p>
            <IdCameraCapture onCapture={setIdFile} facingMode="environment" />
            {idFile && (<>
              <p className="text-[11px] font-bold mt-2" style={{ color: selfieFile ? ACCENT : "#bbc9cd" }}>2. Selfie (visage) {selfieFile ? "✓" : ""}</p>
              <IdCameraCapture onCapture={setSelfieFile} facingMode="user" />
            </>)}
            <button disabled={busy || !idFile || !selfieFile} onClick={submitDoc} className="w-full py-2.5 rounded-xl text-sm font-black disabled:opacity-40"
              style={{ background: (idFile && selfieFile) ? ACCENT : "#0b1326", color: (idFile && selfieFile) ? "#00363e" : "#5b6b8c", border: "1px solid #2a3550" }}>{busy ? "Envoi…" : "Envoyer pour vérification"}</button>
          </div>
        )}
      </Row>

      {/* Niveau 3 — Monétisation */}
      <p className="text-[11px] font-bold uppercase tracking-widest mb-2 mt-5 px-1" style={{ color: "#859397" }}>Monétisation (créateurs)</p>
      <Row>
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined" style={{ color: st.identity_verified ? ACCENT : "#859397" }}>{st.identity_verified ? "lock_open" : "lock"}</span>
          <p className="text-xs" style={{ color: "#859397" }}>
            {st.identity_verified
              ? "Vérification d'identité OK : tu peux activer tips, abonnements et retraits (KYC Stripe requis en plus pour les paiements)."
              : "La vérification d'identité (pièce) est obligatoire pour activer les tips, abonnements et retraits."}
          </p>
        </div>
      </Row>

      <p className="text-center text-[11px] mt-1" style={{ color: "#5b6b8c" }}>
        Données conformes RGPD : documents chiffrés, jamais partagés, supprimés après vérification.
      </p>
    </div>
  );
}
