import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Eye, EyeOff, ArrowLeft } from "lucide-react";
import brandLogo from "@/assets/brand-logo.png";

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(72),
});

const forgotSchema = z.object({
  email: z.string().trim().email("Invalid email").max(255),
});

export default function Auth() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });

  useEffect(() => { if (!loading && user) navigate("/dashboard"); }, [user, loading, navigate]);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "login") {
        const parsed = loginSchema.safeParse(form);
        if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
        const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email, password: parsed.data.password });
        if (error) { toast.error(error.message); return; }
        navigate("/dashboard");
      } else {
        const parsed = forgotSchema.safeParse({ email: form.email });
        if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
        const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) { toast.error(error.message); return; }
        toast.success("Password reset link sent to your email");
        setMode("login");
      }
    } finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-soft">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center justify-center gap-3 mb-8">
          <img
            src={brandLogo}
            alt="Criterion Wellness Home"
            className="h-20 w-auto object-contain"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
          <span className="font-display font-bold text-2xl text-center text-foreground">
            Criterion Wellness Home
          </span>
          <Button variant="outline" className="relative cursor-pointer mb-4 w-full">
            Bypass & Upload JSON Dump Here
            <input type="file" accept=".json" className="absolute inset-0 opacity-0 cursor-pointer" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = async (e) => {
                try {
                  const data = JSON.parse(e.target?.result as string);
                  
                  // Fetch the new clinic ID
                  const { data: clinicData, error: clinicErr } = await supabase.from('clinics').select('id').limit(1).maybeSingle();
                  if (clinicErr) throw new Error("Clinic fetch error: " + clinicErr.message);
                  if (!clinicData) throw new Error("Could not find a clinic in the database. Please ensure you ran the SQL script from Step 2.");
                  
                  // Clean foreign keys
                  const cleanedData = data.map((p: any) => {
                    const cleanP = { ...p, clinic_id: clinicData.id, assigned_to: null };
                    return cleanP;
                  });

                  const { error } = await supabase.from('patients').insert(cleanedData);
                  if (error) throw new Error("Insert error: " + error.message);
                  alert("Data Imported! Now you can log in.");
                } catch (err: any) {
                  alert("Import failed: " + err.message);
                }
              };
              reader.readAsText(file);
            }} />
          </Button>
        </div>

        <Card className="p-6 sm:p-8 shadow-elegant border-border/60">
          {mode === "forgot" && (
            <>
              <button type="button" onClick={() => setMode("login")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </button>
              <div className="mb-4">
                <h2 className="font-display text-xl font-semibold">Reset your password</h2>
                <p className="text-sm text-muted-foreground mt-1">Enter your email and we'll send you a reset link.</p>
              </div>
            </>
          )}

          <form onSubmit={handle} className="space-y-4" autoComplete="on">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" required />
            </div>
            {mode !== "forgot" && (
              <div>
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    placeholder="••••••••"
                    className="pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex items-center justify-center w-10 text-muted-foreground hover:text-foreground touch-manipulation"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setMode("forgot")}
                  className="mt-2 text-sm text-primary hover:underline"
                >
                  Forgot password?
                </button>
              </div>
            )}
            <Button type="submit" className="w-full bg-gradient-primary hover:opacity-90 transition" size="lg" disabled={submitting}>
              {submitting ? "Please wait..." : mode === "login" ? "Sign in" : "Send reset link"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
