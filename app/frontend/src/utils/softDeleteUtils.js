/**
 * Système de suppression douce (Soft Delete)
 * Les éléments supprimés sont marqués comme "deleted" au lieu d'être vraiment supprimés
 * Ils peuvent être restaurés pendant 30 jours
 */

import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";

/**
 * Supprimer un post (soft delete)
 */
export async function softDeletePost(postId) {
  try {
    await axios.post(`${API}/posts/${postId}/soft-delete`);
    toast.success("Publication déplacée dans la corbeille");
    return true;
  } catch (error) {
    console.error("Erreur soft delete post:", error);
    toast.error("Erreur lors de la suppression");
    return false;
  }
}

/**
 * Supprimer un commentaire (soft delete)
 */
export async function softDeleteComment(postId, commentId) {
  try {
    await axios.post(`${API}/posts/${postId}/comments/${commentId}/soft-delete`);
    toast.success("Commentaire déplacé dans la corbeille");
    return true;
  } catch (error) {
    console.error("Erreur soft delete comment:", error);
    toast.error("Erreur lors de la suppression");
    return false;
  }
}

/**
 * Restaurer un élément supprimé
 */
export async function restoreItem(itemId, itemType) {
  try {
    await axios.post(`${API}/users/me/restore/${itemType}/${itemId}`);
    toast.success("Élément restauré avec succès");
    return true;
  } catch (error) {
    console.error("Erreur restauration:", error);
    toast.error("Erreur lors de la restauration");
    return false;
  }
}

/**
 * Supprimer définitivement un élément
 */
export async function permanentDelete(itemId, itemType) {
  try {
    await axios.delete(`${API}/users/me/deleted/${itemType}/${itemId}`);
    toast.success("Élément supprimé définitivement");
    return true;
  } catch (error) {
    console.error("Erreur suppression permanente:", error);
    toast.error("Erreur lors de la suppression");
    return false;
  }
}

/**
 * Vider la corbeille (supprimer tout définitivement)
 */
export async function emptyTrash() {
  if (!window.confirm("Supprimer définitivement tous les éléments de la corbeille ?")) {
    return false;
  }

  try {
    await axios.delete(`${API}/users/me/deleted/all`);
    toast.success("Corbeille vidée");
    return true;
  } catch (error) {
    console.error("Erreur vider corbeille:", error);
    toast.error("Erreur lors de la suppression");
    return false;
  }
}
