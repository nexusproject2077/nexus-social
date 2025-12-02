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

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// Axios interceptor for auth token
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const token = localStorage.getItem("token");
    if (token) {
      try {
        const response = await axios.get(`${API}/auth/me`);
        setUser(response.data);
      } catch (error) {
        localStorage.removeItem("token");
      }
    }
    setLoading(false);
  };

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
