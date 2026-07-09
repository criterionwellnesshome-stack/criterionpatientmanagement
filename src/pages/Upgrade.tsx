import { Navigate } from "react-router-dom";

// The upgrade/pricing page has been removed. Any leftover links redirect
// users back to the dashboard.
export default function Upgrade() {
  return <Navigate to="/dashboard" replace />;
}
