import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Home, Search, Bell, Mail, User, LogOut, Menu, X, Settings } from "lucide-react";

export default function Layout({ children, user, setUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem("token");
    if (setUser) setUser(null);
    navigate("/auth");
  };

  const navItems = [
    { icon: Home, label: "Accueil", path: "/", testId: "nav-home" },
    { icon: Search, label: "Rechercher", path: "/search", testId: "nav-search" },
    { icon: Bell, label: "Notifications", path: "/notifications", testId: "nav-notifications" },
    { icon: Mail, label: "Messages", path: "/messages", testId: "nav-messages" },
    { icon: User, label: "Profil", path: `/profile/${user.id}`, testId: "nav-profile" },
    { icon: Settings, label: "Paramètres", path: "/settings", testId: "nav-settings" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-slate-950 border-b border-slate-800 p-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">Social</span>
        </h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowMobileMenu(!showMobileMenu)}
          data-testid="mobile-menu-toggle"
        >
          {showMobileMenu ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </Button>
      </div>

      {/* Mobile Menu */}
      {showMobileMenu && (
        <div className="lg:hidden fixed inset-0 z-40 bg-slate-950/95 backdrop-blur-xl pt-20">
          <div className="p-4 space-y-2">
            {navItems.map((item) => (
              <Button
                key={item.path}
                data-testid={item.testId}
                onClick={() => {
                  navigate(item.path);
                  setShowMobileMenu(false);
                }}
                variant="ghost"
                className={`w-full justify-start text-lg ${
                  location.pathname === item.path
                    ? "bg-slate-800 text-cyan-500"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <item.icon className="w-6 h-6 mr-4" />
                {item.label}
              </Button>
            ))}
            <Button
              data-testid="mobile-logout-button"
              onClick={handleLogout}
              variant="ghost"
              className="w-full justify-start text-lg text-red-400 hover:text-red-300"
            >
              <LogOut className="w-6 h-6 mr-4" />
              Déconnexion
            </Button>
          </div>
        </div>
      )}

      <div className="flex">
        {/* Desktop Sidebar */}
        <div className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:border-r lg:border-slate-800 lg:p-6">
          <h1 className="text-3xl font-bold mb-8" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">Social</span>
          </h1>

          <nav className="flex-1 space-y-2">
            {navItems.map((item) => (
              <Button
                key={item.path}
                data-testid={item.testId}
                onClick={() => navigate(item.path)}
                variant="ghost"
                className={`w-full justify-start text-base ${
                  location.pathname === item.path
                    ? "bg-slate-800 text-cyan-500"
                    : "text-slate-300 hover:text-white"
                }`}
              >
                <item.icon className="w-5 h-5 mr-3" />
                {item.label}
              </Button>
            ))}
          </nav>

          <div className="mt-auto space-y-4">
            <div className="flex items-center gap-3 p-3 bg-slate-900 rounded-lg">
              <Avatar>
                <AvatarImage src={user.profile_pic} />
                <AvatarFallback className="bg-slate-700">
                  {user.username[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{user.username}</p>
                <p className="text-xs text-slate-400 truncate">{user.email}</p>
              </div>
            </div>
            <Button
              data-testid="logout-button"
              onClick={handleLogout}
              variant="outline"
              className="w-full border-slate-700 text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Déconnexion
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <main className="flex-1 lg:ml-64 pt-16 lg:pt-0">
          {children}
        </main>
      </div>
    </div>
  );
}
