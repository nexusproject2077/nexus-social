// Interface admin — validation des pièces d'identité soumises.
// Accès réservé aux administrateurs (le backend renvoie 403 sinon).
// Le document est récupéré en blob AUTHENTIFIÉ (jamais une URL publique) puis
// affiché le temps de la revue.
import { useEffect, useState } from "react";
import axios from "axios";
import { API } from "@/App";
import Layout from "@/components/Layout";
import { toast } from "sonner";

const ACCENT = (typeof window !== "undefined" && window.localStorage.getItem("nexus_accent")) || "#22d3ee";
const CARD = { background: "#171f33", border: "1px solid rgba(255,255,255,0.06)" };
const DOC_LABEL = { id_card: "Carte d'identité", passport: "Passeport", residence_permit: "Titre de séjour" };

function DocPreview({ subId, kind = "document", label, emptyMsg = "Indisponible" }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let obj;
    axios.get(`${API}/admin/verifications/${subId}/document`, { params: { kind }, responseType: "blob" })
      .then((r) => { obj = URL.createObjectURL(r.data); setUrl(obj); })
      .catch(() => setErr(true));
    return () => { if (obj) URL.revokeObjectURL(obj); };
  }, [subId, kind]);
  return (
    <div className="flex-1 min-w-0">
      <p className="text-[11px] font-bold mb-1 text-center" style={{ color: "#859397" }}>{label}</p>
      {err ? <p className="text-xs text-center py-6" style={{ color: "#5b6b8c" }}>{emptyMsg}</p>
        : !url ? <div className="flex justify-center py-6"><div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{ borderColor: ACCENT }} /></div>
        : <img src={url} alt={label} className="w-full max-h-64 object-contain rounded-xl border" style={{ borderColor: "#2a3550" }} />}
    </div>
  );
}

export default function AdminVerifications({ user, setUser }) {
  const [items, setItems] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    axios.get(`${API}/admin/verifications`, { params: { status: "pending" } })
      .then((r) => setItems(r.data || []))
      .catch((e) => { if (e.response?.status === 403) setForbidden(true); setItems([]); });
  };
  useEffect(() => { load(); }, []);

  const approve = async (id) => {
    setBusyId(id);
    try { await axios.post(`${API}/admin/verifications/${id}/approve`); toast.success("Vérifié ✓"); setItems((p) => p.filter((x) => x.id !== id)); }
    catch (e) { toast.error(e.response?.data?.detail || "Échec."); }
    finally { setBusyId(null); }
  };
  const reject = async (id, reason) => {
    if (!reason) return;
    setBusyId(id);
    try { await axios.post(`${API}/admin/verifications/${id}/reject`, { reason }); toast.success("Refusé — l'utilisateur est prévenu."); setItems((p) => p.filter((x) => x.id !== id)); }
    catch (e) { toast.error(e.response?.data?.detail || "Échec."); }
    finally { setBusyId(null); }
  };

  return (
    <Layout user={user} setUser={setUser}>
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="font-black text-xl mb-1" style={{ color: "#dae2fd" }}>Vérifications d'identité</h1>
        <p className="text-sm mb-5" style={{ color: "#859397" }}>Demandes en attente de validation.</p>

        {forbidden ? (
          <div className="rounded-2xl p-6 text-center" style={CARD}>
            <span className="material-symbols-outlined text-4xl mb-2" style={{ color: "#f87171" }}>lock</span>
            <p style={{ color: "#dae2fd" }}>Accès réservé aux administrateurs.</p>
          </div>
        ) : !items ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: ACCENT }} /></div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl p-8 text-center" style={CARD}>
            <span className="material-symbols-outlined text-4xl mb-2" style={{ color: ACCENT }}>task_alt</span>
            <p style={{ color: "#dae2fd" }}>Aucune demande en attente 🎉</p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map((it) => (
              <div key={it.id} className="rounded-2xl p-4" style={CARD}>
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="font-bold" style={{ color: "#dae2fd" }}>@{it.username || it.user_id}</p>
                    <p className="text-xs" style={{ color: "#859397" }}>
                      {DOC_LABEL[it.doc_type] || it.doc_type} · {new Date(it.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 mb-3 rounded-xl p-2" style={{ background: "#0b1326" }}>
                  <DocPreview subId={it.id} kind="document" label="Pièce d'identité" />
                  <DocPreview subId={it.id} kind="selfie" label="Selfie" emptyMsg="Aucun selfie fourni" />
                </div>
                <button disabled={busyId === it.id} onClick={() => approve(it.id)}
                  className="w-full py-2.5 rounded-xl text-sm font-black disabled:opacity-40 mb-2" style={{ background: ACCENT, color: "#00363e" }}>
                  ✓ Valider
                </button>
                <p className="text-[11px] font-bold mb-1" style={{ color: "#859397" }}>Refuser avec un motif (l'utilisateur devra recommencer) :</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    "Document illisible",
                    "Document non conforme",
                    "Selfie ne correspond pas",
                    "Pièce périmée",
                    "Photo floue / reflets",
                  ].map((r) => (
                    <button key={r} disabled={busyId === it.id} onClick={() => reject(it.id, r)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
                      style={{ background: "rgba(248,113,113,0.12)", color: "#f87171", border: "1px solid rgba(248,113,113,0.25)" }}>
                      {r}
                    </button>
                  ))}
                  <button disabled={busyId === it.id}
                    onClick={() => { const r = window.prompt("Autre motif (visible par l'utilisateur) :", ""); if (r) reject(it.id, r); }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
                    style={{ background: "#131b2e", color: "#859397", border: "1px solid #2a3550" }}>
                    Autre motif…
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
