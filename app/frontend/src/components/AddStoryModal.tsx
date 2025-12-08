// src/components/AddStoryModal.tsx
// ... (imports) ...

export default function AddStoryModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  // ... (states) ...

  const handleUpload = async () => {
    // ... (validation file) ...

    const token = localStorage.getItem('token');
    if (!token) {
      toast.error("Vous devez être connecté pour publier une story.");
      onClose();
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${API}/stories/`, {
        method: "POST",
        headers: {
          'Authorization': `Bearer ${token}` // AJOUT DE L'EN-TÊTE D'AUTHENTIFICATION
        },
        // credentials: "include" est supprimé
        body: formData,
      });

      // ... (gestion de la réponse) ...
    } catch (err) {
      // ...
    } finally {
      setUploading(false);
    }
  };

  // ... (return JSX) ...
}
