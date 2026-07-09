import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { BrandLoader } from "@/components/BrandLoader";

// The marketing landing page has been removed. The app now opens directly
// into either the dashboard (if signed in) or the auth screen.
export default function Landing() {
  const { user, loading } = useAuth();
  if (loading) return <BrandLoader label="Loading..." />;
  return <Navigate to={user ? "/dashboard" : "/auth"} replace />;
}
