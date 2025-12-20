import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Home, Search, Bell, Mail, User, LogOut, Menu, X, Settings, PlusSquare } from "lucide-react";

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
    { icon: Home, label: "Accueil", path: "/", testId: "nav-home" },
    { icon: Search, label: "Rechercher", path: "/search", testId: "nav-search" },
    { icon: Bell, label: "Notifications", path: "/notifications", testId: "nav-notifications" },
    { icon: Mail, label: "Messages", path: "/messages", testId: "nav-messages" },
    { icon: User, label: "Profil", path: `/profile/${user.id}`, testId: "nav-profile" },
  ];

  // Navigation secondaire (dans le menu burger sur mobile, sidebar sur desktop)
  const secondaryNavItems = [
    { icon: Settings, label: "Paramètres", path: "/settings", testId: "nav-settings" },
  ];

  const allNavItems = [...mainNavItems, ...secondaryNavItems];

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

            {/* Navigation secondaire */}
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

      {/* Mobile Bottom Navigation (Style Instagram) */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-slate-950/98 backdrop-blur-xl border-t border-slate-800">
        <div className="flex items-center justify-around px-2 py-2">
          {mainNavItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            
            return (
              <button
                key={item.path}
                data-testid={item.testId}
                onClick={() => navigate(item.path)}
                className="flex flex-col items-center justify-center flex-1 py-2 px-1 relative"
              >
                <div className={`flex items-center justify-center w-12 h-10 rounded-lg transition-all ${
                  isActive 
                    ? "bg-slate-800" 
                    : "hover:bg-slate-800/50"
                }`}>
                  {item.label === "Profil" ? (
                    <Avatar className={`h-6 w-6 ${isActive ? "ring-2 ring-cyan-500" : ""}`}>
                      <AvatarImage src={user.profile_pic} />
                      <AvatarFallback className={`text-[10px] ${
                        isActive 
                          ? "bg-gradient-to-br from-cyan-500 to-blue-500 text-white" 
                          : "bg-slate-700"
                      }`}>
                        {user.username[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ) : (
                    <Icon className={`w-5 h-5 ${
                      isActive 
                        ? "text-cyan-500" 
                        : "text-slate-400"
                    }`} />
                  )}
                </div>
                {isActive && (
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 bg-cyan-500 rounded-full"></div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex">
        {/* Desktop Sidebar */}
        <div className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:border-r lg:border-slate-800 lg:p-6">
          <h1 className="text-3xl font-bold mb-8" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">Social</span>
          </h1>

          <nav className="flex-1 space-y-2">
            {allNavItems.map((item) => (
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
                <AvatarFallback className="bg-gradient-to-br from-cyan-500 to-blue-500 text-white font-bold">
                  {user.username[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">@{user.username}</p>
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
        <main className="flex-1 lg:ml-64 pt-14 pb-16 lg:pt-0 lg:pb-0">
          {children}
        </main>
      </div>
    </div>
  );
}
