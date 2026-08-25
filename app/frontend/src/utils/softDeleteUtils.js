/**
 * Système de suppression douce (Soft Delete)
 * Les éléments supprimés sont marqués comme "deleted" au lieu d'être vraiment supprimés
 * Ils peuvent être restaurés pendant 30 jours
 */

import axios from "axios";
import { API } from "@/App";
import { toast } from "sonner";
import i18n from "@/i18n";

/**
 * Supprimer un post (soft delete)
 */
export async function softDeletePost(postId) {
  try {
    await axios.post(`${API}/posts/${postId}/soft-delete`);
    toast.success(i18n.t("trash.post_trashed"));
    return true;
  } catch (error) {
    console.error("Erreur soft delete post:", error);
    toast.error(i18n.t("trash.err_delete"));
    return false;
  }
}

/**
 * Supprimer un commentaire (soft delete)
 */
export async function softDeleteComment(postId, commentId) {
  try {
    await axios.post(`${API}/posts/${postId}/comments/${commentId}/soft-delete`);
    toast.success(i18n.t("trash.comment_trashed"));
    return true;
  } catch (error) {
    console.error("Erreur soft delete comment:", error);
    toast.error(i18n.t("trash.err_delete"));
    return false;
  }
}

/**
 * Restaurer un élément supprimé
 */
export async function restoreItem(itemId, itemType) {
  try {
    await axios.post(`${API}/users/me/restore/${itemType}/${itemId}`);
    toast.success(i18n.t("trash.restored"));
    return true;
  } catch (error) {
    console.error("Erreur restauration:", error);
    toast.error(i18n.t("trash.err_restore"));
    return false;
  }
}

/**
 * Supprimer définitivement un élément
 */
export async function permanentDelete(itemId, itemType) {
  try {
    await axios.delete(`${API}/users/me/deleted/${itemType}/${itemId}`);
    toast.success(i18n.t("trash.perm_deleted"));
    return true;
  } catch (error) {
    console.error("Erreur suppression permanente:", error);
    toast.error(i18n.t("trash.err_delete"));
    return false;
  }
}

/**
 * Vider la corbeille (supprimer tout définitivement)
 */
export async function emptyTrash() {
  if (!window.confirm(i18n.t("trash.empty_confirm"))) {
    return false;
  }

  try {
    await axios.delete(`${API}/users/me/deleted/all`);
    toast.success(i18n.t("trash.trash_emptied"));
    return true;
  } catch (error) {
    console.error("Erreur vider corbeille:", error);
    toast.error(i18n.t("trash.err_delete"));
    return false;
  }
}
