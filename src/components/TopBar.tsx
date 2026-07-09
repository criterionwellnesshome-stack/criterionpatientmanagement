import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { LogOut, Shield, Settings as SettingsIcon, Users, LayoutDashboard, Activity } from "lucide-react";
import brandLogo from "@/assets/brand-logo.png";

interface TopBarProps {
  showSettings?: boolean;
}

export const TopBar = ({ showSettings }: TopBarProps) => {
  const { signOut, isAdmin, isSupport, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const onDashboard = location.pathname === "/dashboard";
  const showGoToDashboard = (isAdmin || isSupport) && !onDashboard;
  return (
    <header className="border-b border-border/60 bg-card/80 backdrop-blur-md sticky top-0 z-30">
      <div className="container flex items-center justify-between h-16">
        <Link to="/" className="flex items-center gap-2 min-w-0">
          <img
            src={brandLogo}
            alt="Criterion Wellness Home"
            className="h-8 sm:h-10 w-auto object-contain"
          />
          <span className="font-display font-semibold text-sm sm:text-base text-foreground hidden sm:inline truncate">
            Criterion Wellness Home
          </span>
        </Link>
        <div className="flex items-center gap-2">
          {showGoToDashboard && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/dashboard"><LayoutDashboard className="w-4 h-4 mr-1.5" />Go to Dashboard</Link>
            </Button>
          )}
          {isAdmin && (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link to="/activity"><Activity className="w-4 h-4 mr-1.5" />Today's Activity</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to="/staff"><Users className="w-4 h-4 mr-1.5" />Staff</Link>
              </Button>
            </>
          )}
          {isAdmin && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin"><Shield className="w-4 h-4 mr-1.5" />Admin</Link>
            </Button>
          )}
          {user && showSettings && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings"><SettingsIcon className="w-4 h-4 mr-1.5" />Settings</Link>
            </Button>
          )}
          {user && (
            <Button variant="ghost" size="sm" onClick={async () => { await signOut(); navigate("/"); }}>
              <LogOut className="w-4 h-4 mr-1.5" />Sign out
            </Button>
          )}
        </div>
      </div>
    </header>
  );
};
