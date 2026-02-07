import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Globe, ArrowLeft, ArrowRight, RefreshCw, Home, Share2,
  Bookmark, History, Search, X, TrendingUp, BookMarked,
  ExternalLink, MessageSquare
} from "lucide-react";
import { toast } from "sonner";
import axios from "axios";
import { API } from "@/App";

export default function BrowserPage({ user }) {
  const navigate = useNavigate();
  const iframeRef = useRef(null);

  const [url, setUrl] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [history, setHistory] = useState([]);
  const [bookmarks, setBookmarks] = useState([]);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareCaption, setShareCaption] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(-1);

  // Sites suggérés populaires
  const suggestedSites = [
    { name: "YouTube", url: "https://www.youtube.com", icon: "🎥", category: "Vidéo" },
    { name: "Wikipedia", url: "https://www.wikipedia.org", icon: "📚", category: "Savoir" },
    { name: "GitHub", url: "https://github.com", icon: "💻", category: "Code" },
    { name: "Medium", url: "https://medium.com", icon: "✍️", category: "Articles" },
    { name: "Twitter/X", url: "https://x.com", icon: "🐦", category: "Social" },
    { name: "Reddit", url: "https://www.reddit.com", icon: "🤖", category: "Forum" },
    { name: "Stack Overflow", url: "https://stackoverflow.com", icon: "💡", category: "Dev" },
    { name: "Dribbble", url: "https://dribbble.com", icon: "🎨", category: "Design" },
  ];

  useEffect(() => {
    // Charger les signets depuis localStorage
    const savedBookmarks = localStorage.getItem("browser_bookmarks");
    if (savedBookmarks) {
      setBookmarks(JSON.parse(savedBookmarks));
    }

    const savedHistory = localStorage.getItem("browser_history");
    if (savedHistory) {
      setHistory(JSON.parse(savedHistory));
    }
  }, []);

  const isValidUrl = (string) => {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  };

  const handleNavigate = (targetUrl) => {
    let finalUrl = targetUrl;

    // Si ce n'est pas une URL complète, ajouter https://
    if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
      // Si ça ressemble à un domaine, ajouter https://
      if (finalUrl.includes(".") || finalUrl.startsWith("localhost")) {
        finalUrl = "https://" + finalUrl;
      } else {
        // Sinon, rechercher sur Google
        finalUrl = `https://www.google.com/search?q=${encodeURIComponent(finalUrl)}`;
      }
    }

    // Ajouter à l'historique
    const newHistoryItem = {
      url: finalUrl,
      title: finalUrl,
      timestamp: new Date().toISOString()
    };

    const updatedHistory = [newHistoryItem, ...history.slice(0, 99)]; // Garder les 100 derniers
    setHistory(updatedHistory);
    localStorage.setItem("browser_history", JSON.stringify(updatedHistory));

    setCurrentUrl(finalUrl);
    setUrl(finalUrl);
    setCurrentIndex(currentIndex + 1);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      handleNavigate(searchQuery);
    }
  };

  const handleBack = () => {
    if (currentIndex > 0) {
      const prevUrl = history[currentIndex - 1]?.url;
      if (prevUrl) {
        setCurrentUrl(prevUrl);
        setUrl(prevUrl);
        setCurrentIndex(currentIndex - 1);
      }
    }
  };

  const handleForward = () => {
    if (currentIndex < history.length - 1) {
      const nextUrl = history[currentIndex + 1]?.url;
      if (nextUrl) {
        setCurrentUrl(nextUrl);
        setUrl(nextUrl);
        setCurrentIndex(currentIndex + 1);
      }
    }
  };

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const handleHome = () => {
    setCurrentUrl("");
    setUrl("");
    setSearchQuery("");
  };

  const handleAddBookmark = () => {
    if (!currentUrl) {
      toast.error("Aucune page à ajouter aux favoris");
      return;
    }

    const bookmark = {
      url: currentUrl,
      title: currentUrl,
      timestamp: new Date().toISOString()
    };

    const updatedBookmarks = [bookmark, ...bookmarks];
    setBookmarks(updatedBookmarks);
    localStorage.setItem("browser_bookmarks", JSON.stringify(updatedBookmarks));
    toast.success("Ajouté aux favoris !");
  };

  const handleRemoveBookmark = (index) => {
    const updatedBookmarks = bookmarks.filter((_, i) => i !== index);
    setBookmarks(updatedBookmarks);
    localStorage.setItem("browser_bookmarks", JSON.stringify(updatedBookmarks));
    toast.success("Retiré des favoris");
  };

  const handleShareToFeed = async () => {
    if (!currentUrl) {
      toast.error("Aucune page à partager");
      return;
    }

    try {
      setLoading(true);
      await axios.post(`${API}/posts`, {
        content: shareCaption || `Découvrez cette page : ${currentUrl}`,
        link_url: currentUrl,
        link_preview: {
          url: currentUrl,
          title: currentUrl,
          description: "Partagé depuis le navigateur intégré"
        }
      });

      toast.success("Partagé sur votre fil !");
      setShowShareModal(false);
      setShareCaption("");
    } catch (error) {
      console.error("Erreur partage:", error);
      toast.error("Erreur lors du partage");
    } finally {
      setLoading(false);
    }
  };

  const handleClearHistory = () => {
    setHistory([]);
    localStorage.removeItem("browser_history");
    toast.success("Historique effacé");
    setShowHistory(false);
  };

  return (
    <Layout user={user}>
      <div className="flex flex-col h-[calc(100vh-64px)] lg:h-screen bg-slate-950">
        {/* Barre de navigation */}
        <div className="bg-slate-900 border-b border-slate-800 p-4">
          <div className="max-w-7xl mx-auto space-y-3">
            {/* Boutons de navigation */}
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="ghost"
                onClick={handleBack}
                disabled={currentIndex <= 0}
                className="hover:bg-slate-800"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleForward}
                disabled={currentIndex >= history.length - 1}
                className="hover:bg-slate-800"
              >
                <ArrowRight className="w-5 h-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleRefresh}
                disabled={!currentUrl}
                className="hover:bg-slate-800"
              >
                <RefreshCw className="w-5 h-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleHome}
                className="hover:bg-slate-800"
              >
                <Home className="w-5 h-5" />
              </Button>

              {/* Barre d'adresse */}
              <form onSubmit={handleSearch} className="flex-1 flex gap-2">
                <div className="relative flex-1">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Rechercher ou entrer une URL..."
                    className="bg-slate-800 border-slate-700 text-white pl-10 pr-4"
                  />
                </div>
                <Button
                  type="submit"
                  className="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
                >
                  <Search className="w-4 h-4" />
                </Button>
              </form>

              {/* Actions */}
              <Button
                size="icon"
                variant="ghost"
                onClick={handleAddBookmark}
                disabled={!currentUrl}
                className="hover:bg-slate-800"
                title="Ajouter aux favoris"
              >
                <Bookmark className="w-5 h-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowBookmarks(true)}
                className="hover:bg-slate-800"
                title="Favoris"
              >
                <BookMarked className="w-5 h-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowHistory(true)}
                className="hover:bg-slate-800"
                title="Historique"
              >
                <History className="w-5 h-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowShareModal(true)}
                disabled={!currentUrl}
                className="hover:bg-slate-800 text-cyan-400"
                title="Partager sur le réseau"
              >
                <Share2 className="w-5 h-5" />
              </Button>
            </div>

            {/* URL actuelle */}
            {currentUrl && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <ExternalLink className="w-3 h-3" />
                <span className="truncate">{currentUrl}</span>
              </div>
            )}
          </div>
        </div>

        {/* Contenu */}
        <div className="flex-1 overflow-hidden">
          {currentUrl ? (
            <iframe
              ref={iframeRef}
              src={currentUrl}
              className="w-full h-full bg-white"
              title="Browser"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            />
          ) : (
            <div className="h-full overflow-y-auto p-8">
              <div className="max-w-6xl mx-auto space-y-8">
                {/* Header */}
                <div className="text-center space-y-4">
                  <div className="flex items-center justify-center gap-3">
                    <Globe className="w-12 h-12 text-cyan-500" />
                    <h1 className="text-4xl font-bold bg-gradient-to-r from-cyan-500 to-blue-500 bg-clip-text text-transparent">
                      Navigateur Social
                    </h1>
                  </div>
                  <p className="text-slate-400">
                    Naviguez sur le web et partagez vos découvertes sans quitter le réseau
                  </p>
                </div>

                {/* Sites suggérés */}
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <TrendingUp className="w-5 h-5 text-cyan-500" />
                    <h2 className="text-xl font-bold">Sites populaires</h2>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {suggestedSites.map((site) => (
                      <button
                        key={site.url}
                        onClick={() => handleNavigate(site.url)}
                        className="bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl p-4 transition group"
                      >
                        <div className="text-3xl mb-2">{site.icon}</div>
                        <div className="font-semibold text-left">{site.name}</div>
                        <div className="text-xs text-slate-400 text-left">{site.category}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Signets rapides */}
                {bookmarks.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-4">
                      <BookMarked className="w-5 h-5 text-purple-500" />
                      <h2 className="text-xl font-bold">Vos favoris</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {bookmarks.slice(0, 6).map((bookmark, index) => (
                        <div
                          key={index}
                          className="bg-slate-900 border border-slate-800 rounded-lg p-3 flex items-center gap-3 hover:bg-slate-800 transition group cursor-pointer"
                          onClick={() => handleNavigate(bookmark.url)}
                        >
                          <Bookmark className="w-4 h-4 text-purple-500" />
                          <span className="flex-1 truncate text-sm">{bookmark.title}</span>
                          <ExternalLink className="w-4 h-4 text-slate-400 opacity-0 group-hover:opacity-100 transition" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fonctionnalités uniques */}
                <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <MessageSquare className="w-5 h-5 text-cyan-500" />
                    <h3 className="font-bold">Fonctionnalités uniques</h3>
                  </div>
                  <ul className="space-y-2 text-sm text-slate-300">
                    <li className="flex items-center gap-2">
                      <Share2 className="w-4 h-4 text-cyan-400" />
                      Partagez n'importe quelle page web directement sur votre fil
                    </li>
                    <li className="flex items-center gap-2">
                      <Bookmark className="w-4 h-4 text-purple-400" />
                      Sauvegardez vos sites favoris et accédez-y rapidement
                    </li>
                    <li className="flex items-center gap-2">
                      <History className="w-4 h-4 text-blue-400" />
                      Consultez votre historique de navigation
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal Favoris */}
      <Dialog open={showBookmarks} onOpenChange={setShowBookmarks}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <BookMarked className="w-5 h-5 text-purple-500" />
              Favoris
            </DialogTitle>
          </DialogHeader>

          {bookmarks.length > 0 ? (
            <div className="mt-4 space-y-2">
              {bookmarks.map((bookmark, index) => (
                <div
                  key={index}
                  className="bg-slate-800 rounded-lg p-4 flex items-center gap-3"
                >
                  <Bookmark className="w-4 h-4 text-purple-500" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{bookmark.title}</p>
                    <p className="text-xs text-slate-400 truncate">{bookmark.url}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      handleNavigate(bookmark.url);
                      setShowBookmarks(false);
                    }}
                    className="text-cyan-400 hover:text-cyan-300"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveBookmark(index)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400">
              <BookMarked className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Aucun favori pour le moment</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Historique */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-blue-500" />
                Historique
              </div>
              {history.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClearHistory}
                  className="text-red-400 hover:text-red-300"
                >
                  Effacer tout
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>

          {history.length > 0 ? (
            <div className="mt-4 space-y-2">
              {history.map((item, index) => (
                <div
                  key={index}
                  onClick={() => {
                    handleNavigate(item.url);
                    setShowHistory(false);
                  }}
                  className="bg-slate-800 rounded-lg p-4 flex items-center gap-3 cursor-pointer hover:bg-slate-700 transition"
                >
                  <Globe className="w-4 h-4 text-blue-500" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{item.title}</p>
                    <p className="text-xs text-slate-400 truncate">{item.url}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(item.timestamp).toLocaleString('fr-FR')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400">
              <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>Aucun historique</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Partage */}
      <Dialog open={showShareModal} onOpenChange={setShowShareModal}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Share2 className="w-5 h-5 text-cyan-500" />
              Partager sur le réseau
            </DialogTitle>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="bg-slate-800 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Page à partager :</p>
              <p className="text-sm truncate">{currentUrl}</p>
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-2 block">
                Ajouter un commentaire (optionnel)
              </label>
              <Input
                value={shareCaption}
                onChange={(e) => setShareCaption(e.target.value)}
                placeholder="Qu'en pensez-vous ?"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => setShowShareModal(false)}
                className="flex-1"
              >
                Annuler
              </Button>
              <Button
                onClick={handleShareToFeed}
                disabled={loading}
                className="flex-1 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600"
              >
                {loading ? "Partage..." : "Partager"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
