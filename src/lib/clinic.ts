import { supabase } from "@/integrations/supabase/client";

export type Clinic = {
  id: string;
  user_id: string;
  clinic_name: string;
  email: string;
  plan: "basic_free" | "Basic" | "Growth" | "Scale" | "Pro";
  status: "trial" | "active" | "expired";
  expiry_date: string;
  patient_limit: number;
  logo_url?: string | null;
};

export type Patient = {
  id: string;
  patient_id?: string | null;
  patient_number: string;
  clinic_id: string;
  name: string;
  phone_number: string;
  contact_method: "WhatsApp" | "Call";
  diagnosis: string | null;
  treatment_duration: string | null;
  treatment_notes: string | null;
  follow_up_type: "checkup" | "medication" | "feedback" | "custom";
  next_follow_up_date: string;
  status: "active" | "completed" | "lost";
  total_cost: number;
  amount_paid: number;
  balance: number;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  // New operational fields
  gender: "Male" | "Female" | null;
  age: number | null;
  call_status: "responded" | "no_response" | null;
  usage_habit: "frequent" | "not_frequent" | null;
  notes: string | null;
  extra_fields: Record<string, unknown> | null;
  medication_due_date?: string | null;
  medication_renewal_status?: "active" | "due" | null;
};

export type StaffMember = {
  user_id: string;
  email: string;
  full_name?: string | null;
  role: "admin" | "support" | "clinic";
  status?: "invited" | "active" | "deactivated";
  created_at?: string;
};

// UI label for a role. The stored value remains "support" for stability.
export const roleLabel = (role: StaffMember["role"]) => {
  switch (role) {
    case "admin":
      return "Admin";
    case "support":
      return "Wellness Support";
    case "clinic":
      return "Clinic";
    default:
      return role;
  }
};

// Best display label for a staff member: name if present, otherwise email.
export const staffDisplayName = (s: Pick<StaffMember, "full_name" | "email">) =>
  (s.full_name && s.full_name.trim()) || s.email;

export const isExpired = (clinic: Clinic | null) => {
  if (!clinic) return false;
  if (clinic.status === "expired") return true;
  return new Date(clinic.expiry_date) < new Date(new Date().toDateString());
};

// Display label for a plan. Legacy values are mapped to their new names so
// existing users see the new branding without any data migration required
// in the UI layer.
export const planLabel = (plan: Clinic["plan"]) => {
  switch (plan) {
    case "Pro":
    case "Basic":
      return "Pro";
    case "Scale":
    case "Growth":
      return "Scale";
    case "basic_free":
      return "Free";
    default:
      return plan;
  }
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const buildWhatsAppLink = (phone: string, message: string) => {
  const clean = phone.replace(/[^\d]/g, "");
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
};
