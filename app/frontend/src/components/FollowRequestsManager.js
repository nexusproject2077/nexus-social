import { useState, useEffect } from "react";
import axios from "axios";
import { API } from "@/App";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserPlus, UserCheck, UserX, Clock } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

/**
 * Composant pour gérer les demandes d'abonnement (comptes privés)
 */
export default function FollowRequestsManager({ user }) {
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPendingRequests();
  }, []);

  const fetchPendingRequests = async () => {
    try {
      const response = await axios.get(`${API}/users/me/follow-requests`);
      setPendingRequests(response.data);
    } catch (error) {
      console.error("Erreur chargement demandes:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (requestId, username) => {
    try {
      await axios.post(`${API}/users/me/follow-requests/${requestId}/accept`);
      setPendingRequests(pendingRequests.filter((r) => r.id !== requestId));
      toast.success(`${username} peut maintenant vous suivre`);
    } catch (error) {
      console.error("Erreur acceptation:", error);
      toast.error("Erreur lors de l'acceptation");
    }
  };

  const handleReject = async (requestId, username) => {
    try {
      await axios.post(`${API}/users/me/follow-requests/${requestId}/reject`);
      setPendingRequests(pendingRequests.filter((r) => r.id !== requestId));
      toast.success(`Demande de ${username} refusée`);
    } catch (error) {
      console.error("Erreur rejet:", error);
      toast.error("Erreur lors du rejet");
    }
  };

  const getInitials = (username) => {
    return username ? username.substring(0, 2).toUpperCase() : "??";
  };

  if (loading) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="py-8">
          <div className="flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (pendingRequests.length === 0) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Clock className="h-5 w-5 text-cyan-500" />
            Demandes d'abonnement
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <UserPlus className="h-12 w-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">Aucune demande en attente</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-slate-900 border-slate-800">
      <CardHeader>
        <CardTitle className="text-white flex items-center gap-2">
          <Clock className="h-5 w-5 text-cyan-500" />
          Demandes d'abonnement ({pendingRequests.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {pendingRequests.map((request) => (
            <div
              key={request.id}
              className="flex items-center justify-between p-4 bg-slate-800/50 rounded-lg border border-slate-700"
            >
              <Link
                to={`/profile/${request.requester_id}`}
                className="flex items-center gap-3 hover:opacity-80 transition-opacity"
              >
                <Avatar className="h-12 w-12">
                  {request.requester_profile_pic ? (
                    <AvatarImage
                      src={request.requester_profile_pic}
                      alt={request.requester_username}
                    />
                  ) : (
                    <AvatarFallback className="bg-gradient-to-r from-purple-500 to-pink-500">
                      {getInitials(request.requester_username)}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div>
                  <p className="font-semibold text-white">{request.requester_username}</p>
                  <p className="text-xs text-slate-400">
                    Demande envoyée il y a{" "}
                    {Math.floor((Date.now() - new Date(request.created_at)) / 1000 / 60 / 60)}h
                  </p>
                </div>
              </Link>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleAccept(request.id, request.requester_username)}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <UserCheck className="h-4 w-4 mr-1" />
                  Accepter
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReject(request.id, request.requester_username)}
                  className="border-red-700 text-red-500 hover:bg-red-950"
                >
                  <UserX className="h-4 w-4 mr-1" />
                  Refuser
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Hook pour gérer le statut de follow d'un compte privé
 */
export function useFollowRequest(userId, isPrivate) {
  const [status, setStatus] = useState("none"); // none, pending, following
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkFollowStatus();
  }, [userId]);

  const checkFollowStatus = async () => {
    try {
      const response = await axios.get(`${API}/users/${userId}/follow-status`);
      setStatus(response.data.status);
    } catch (error) {
      console.error("Erreur vérification statut:", error);
    }
  };

  const sendFollowRequest = async () => {
    setLoading(true);
    try {
      if (isPrivate) {
        await axios.post(`${API}/users/${userId}/follow-request`);
        setStatus("pending");
        toast.success("Demande envoyée");
      } else {
        await axios.post(`${API}/users/${userId}/follow`);
        setStatus("following");
        toast.success("Vous suivez maintenant cet utilisateur");
      }
    } catch (error) {
      console.error("Erreur follow:", error);
      toast.error("Erreur lors de l'envoi de la demande");
    } finally {
      setLoading(false);
    }
  };

  const cancelFollowRequest = async () => {
    setLoading(true);
    try {
      await axios.delete(`${API}/users/${userId}/follow-request`);
      setStatus("none");
      toast.success("Demande annulée");
    } catch (error) {
      console.error("Erreur annulation:", error);
      toast.error("Erreur lors de l'annulation");
    } finally {
      setLoading(false);
    }
  };

  const unfollow = async () => {
    setLoading(true);
    try {
      await axios.post(`${API}/users/${userId}/follow`);
      setStatus("none");
      toast.success("Vous ne suivez plus cet utilisateur");
    } catch (error) {
      console.error("Erreur unfollow:", error);
      toast.error("Erreur lors du désabonnement");
    } finally {
      setLoading(false);
    }
  };

  return {
    status,
    loading,
    sendFollowRequest,
    cancelFollowRequest,
    unfollow,
  };
}
