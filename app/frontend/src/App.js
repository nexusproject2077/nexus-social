import { useEffect, useState } from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";
import { Toaster } from "./components/ui/sonner";
import AuthPage from "./pages/AuthPage";
import HomePage from "./pages/HomePage";
import ProfilePage from "./pages/ProfilePage";
import MessagesPage from "./pages/MessagesPage";
import NotificationsPage from "./pages/NotificationsPage";
import SearchPage from "./pages/SearchPage";
import PostDetailPage from "./pages/PostDetailPage";

// URL du backend (NE CHANGE PLUS JAMAIS)
const BACKEND_URL = "https://nexus-social-4k3v.onrender.com";
export const API = `${BACKEND_URL}/api`;

// INTERCEPTOR AXIOS – ENVOIE LE TOKEN À CHAQUE REQUÊTE (LA CLÉ DE LA VICTOIRE)
axios.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Intercepteur de réponse pour gérer les 401 (session expirée)
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/auth";
    }
    return Promise.reject(error);
  }
);

function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const response = await axios.get(`${API}/auth/me`);
      setUser(response.data);
    } catch (error) {
      localStorage.removeItem("token");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <div className="App">
      <Toaster position="top-center" richColors />
      <BrowserRouter>
        <Routes>
          <Route
            path="/auth"
            element={!user ? <AuthPage setUser={setUser} /> : <Navigate to="/" />}
          />
          <Route
            path="/"
            element={user ? <HomePage user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/profile/:userId"
            element={user ? <ProfilePage user={user} setUser={setUser} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/messages"
            element={user ? <MessagesPage user={user} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/messages/:userId"
            element={user ? <MessagesPage user={user} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/notifications"
            element={user ? <NotificationsPage user={user} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/search"
            element={user ? <SearchPage user={user} /> : <Navigate to="/auth" />}
          />
          <Route
            path="/post/:postId"
            element={user ? <PostDetailPage user={user} /> : <Navigate to="/auth" />}
          />
        </Routes>
      </BrowserRouter>
    </div>
  );
}

export default App;
