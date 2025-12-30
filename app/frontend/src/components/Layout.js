import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { User, LogOut, Menu, X } from "lucide-react";
import CustomLogo from "@/components/CustomLogo";
import CustomMessagingIcon from "@/components/CustomMessagingIcon";
import CustomSearchIcon from "@/components/CustomSearchIcon";
import CustomNotificationIcon from "@/components/CustomNotificationIcon";
import CustomSettingsIcon from "@/components/CustomSettingsIcon";
import CustomAccountIcon from "@/components/CustomAccountIcon";

export default function Layout({ children, user, setUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem("token");
    if (setUser) setUser(null);
    navigate("/auth");
  };

  // Navigation principale (visible en bas sur mobile, sidebar sur desktop)
  const mainNavItems = [
    { icon: CustomLogo, label: "Accueil", path: "/", testId: "nav-home" },
    { icon: CustomSearchIcon, label: "Rechercher", path: "/search", testId: "nav-search" },
    { icon: CustomNotificationIcon, label: "Notifications", path: "/notifications", testId: "nav-notifications" },
    { icon: CustomMessagingIcon, label: "Messages", path: "/messages", testId: "nav-messages" },
    { icon: CustomAccountIcon, label: "Profil", path: `/profile/${user.id}`, testId: "nav-profile" },
  ];

  // Navigation secondaire (UNIQUEMENT dans le menu burger - juste Paramètres)
  const secondaryNavItems = [
    { icon: CustomSettingsIcon, label: "Paramètres", path: "/settings", testId: "nav-settings" },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-xl border-b border-slate-800 px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">Social</span>
        </h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowMobileMenu(!showMobileMenu)}
          data-testid="mobile-menu-toggle"
          className="h-9 w-9"
        >
          {showMobileMenu ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>

      {/* Mobile Menu (Paramètres et Déconnexion uniquement) */}
      {showMobileMenu && (
        <div className="lg:hidden fixed inset-0 z-40 bg-slate-950/98 backdrop-blur-xl pt-16">
          <div className="p-4 space-y-2">
            {/* Profil utilisateur en haut */}
            <div className="flex items-center gap-3 p-4 bg-slate-900/50 rounded-xl mb-4 border border-slate-800">
              <Avatar className="h-12 w-12">
                <AvatarImage src={user.profile_pic} />
                <AvatarFallback className="bg-gradient-to-br from-cyan-500 to-blue-500 text-white font-bold">
                  {user.username[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">@{user.username}</p>
                <p className="text-xs text-slate-400 truncate">{user.email}</p>
              </div>
            </div>

            {/* Paramètres */}
            {secondaryNavItems.map((item) => (
              <Button
                key={item.path}
                data-testid={item.testId}
                onClick={() => {
                  navigate(item.path);
                  setShowMobileMenu(false);
                }}
                variant="ghost"
                className={`w-full justify-start text-base h-12 ${
                  location.pathname === item.path
                    ? "bg-slate-800 text-cyan-500"
                    : "text-slate-300 hover:text-white hover:bg-slate-800/50"
                }`}
              >
                <item.icon className="w-5 h-5 mr-3" />
                {item.label}
              </Button>
            ))}

            {/* Séparateur */}
            <div className="h-px bg-slate-800 my-4"></div>

            {/* Déconnexion */}
            <Button
              data-testid="mobile-logout-button"
              onClick={handleLogout}
              variant="ghost"
              className="w-full justify-start text-base h-12 text-red-400 hover:text-red-300 hover:bg-red-950/20"
            >
              <LogOut className="w-5 h-5 mr-3" />
              Déconnexion
            </Button>
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-64 bg-slate-950 border-r border-slate-800 flex-col z-50">
        {/* Logo - SANS icône à côté */}
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">Social</span>
          </h1>
        </div>

        {/* Navigation - UNIQUEMENT les 5 principales + Paramètres */}
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {mainNavItems.map((item) => (
            <Button
              key={item.path}
              data-testid={item.testId}
              onClick={() => navigate(item.path)}
              variant="ghost"
              className={`w-full justify-start text-base h-12 ${
                location.pathname === item.path
                  ? "bg-slate-800 text-cyan-500"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/50"
              }`}
            >
              <item.icon className="w-5 h-5 mr-3" />
              {item.label}
            </Button>
          ))}

          {/* Séparateur */}
          <div className="h-px bg-slate-800 my-2"></div>

          {/* Paramètres */}
          {secondaryNavItems.map((item) => (
            <Button
              key={item.path}
              data-testid={item.testId}
              onClick={() => navigate(item.path)}
              variant="ghost"
              className={`w-full justify-start text-base h-12 ${
                location.pathname === item.path
                  ? "bg-slate-800 text-cyan-500"
                  : "text-slate-300 hover:text-white hover:bg-slate-800/50"
              }`}
            >
              <item.icon className="w-5 h-5 mr-3" />
              {item.label}
            </Button>
          ))}
        </nav>

        {/* User Profile */}
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={user.profile_pic} />
              <AvatarFallback className="bg-gradient-to-br from-cyan-500 to-blue-500 text-white font-bold">
                {user.username[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">@{user.username}</p>
              <p className="text-xs text-slate-400 truncate">{user.email}</p>
            </div>
          </div>
          <Button
            data-testid="desktop-logout-button"
            onClick={handleLogout}
            variant="ghost"
            className="w-full justify-start text-sm h-10 text-red-400 hover:text-red-300 hover:bg-red-950/20"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Déconnexion
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="lg:ml-64 pt-16 lg:pt-0 pb-20 lg:pb-0">
        <div className="container mx-auto max-w-7xl">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Navigation - 5 icônes uniquement */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950/95 backdrop-blur-xl border-t border-slate-800">
        <div className="flex justify-around items-center h-16 px-2">
          {mainNavItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                data-testid={item.testId}
                onClick={() => navigate(item.path)}
                className={`flex flex-col items-center justify-center min-w-0 flex-1 h-full transition-colors ${
                  isActive ? "text-cyan-500" : "text-slate-400"
                }`}
              >
                <item.icon className={`w-6 h-6 mb-1 ${isActive ? "text-cyan-500" : ""}`} />
                <span className="text-[10px] font-medium truncate max-w-full px-1">
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
