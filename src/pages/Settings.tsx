import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Clinic } from "@/lib/clinic";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Upload, ArrowLeft, Trash2 } from "lucide-react";
import { BrandLoader } from "@/components/BrandLoader";

export default function Settings() {
  const { user, loading, isAdmin, isSupport } = useAuth();
  const navigate = useNavigate();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!loading && !user) navigate("/auth"); }, [user, loading, navigate]);

  const load = async () => {
    if (!user || !isAdmin) return;
    const { data } = await supabase.from("clinics").select("*").eq("user_id", user.id).maybeSingle();
    if (data) {
      setClinic(data as Clinic);
      setName(data.clinic_name ?? "");
    } else {
      await supabase.from("clinics").insert({
        user_id: user.id,
        clinic_name: 'Criterion Wellness Home',
        email: user.email || ''
      });
      const { data: newData } = await supabase.from("clinics").select("*").eq("user_id", user.id).maybeSingle();
      if (newData) {
        setClinic(newData as Clinic);
        setName(newData.clinic_name ?? "");
      }
    }
  };
  useEffect(() => { load(); }, [user, isAdmin]);

  const saveName = async () => {
    if (!clinic) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 120) { toast.error("Enter a valid clinic name"); return; }
    setSaving(true);
    const { error } = await supabase.from("clinics").update({ clinic_name: trimmed }).eq("id", clinic.id);
    setSaving(false);
    if (error) { console.error(error); toast.error("Could not save changes"); return; }
    toast.success("Clinic name updated");
    load();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !clinic) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Logo must be less than 2MB"); return; }
    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${user.id}/logo-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("clinic-logos").upload(path, file, { upsert: true, cacheControl: "3600" });
    if (upErr) { setUploading(false); console.error(upErr); toast.error("Upload failed"); return; }
    const { data: pub } = supabase.storage.from("clinic-logos").getPublicUrl(path);
    const url = pub.publicUrl;
    const { error: updErr } = await supabase.from("clinics").update({ logo_url: url }).eq("id", clinic.id);
    setUploading(false);
    if (updErr) { console.error(updErr); toast.error("Could not save logo"); return; }
    toast.success("Logo updated");
    load();
  };

  if (loading || !user) return <BrandLoader label="Preparing your settings..." />;

  // Support users (non-admin): read-only view with just Full Name + Email
  if (isSupport && !isAdmin) {
    const fullName =
      (user.user_metadata?.full_name as string | undefined)?.trim() ||
      (user.user_metadata?.name as string | undefined)?.trim() ||
      "—";
    return (
      <div className="min-h-screen bg-gradient-soft">
        <TopBar />
        <main className="container py-4 md:py-6 max-w-2xl space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to dashboard
          </Button>
          <h1 className="font-display text-2xl font-bold">Settings</h1>
          <p className="text-sm text-muted-foreground">Your account details. These cannot be edited here.</p>

          <Card className="p-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Full name</Label>
              <Input value={fullName} readOnly disabled className="h-9 bg-muted cursor-not-allowed" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input value={user.email ?? ""} readOnly disabled className="h-9 bg-muted cursor-not-allowed" />
            </div>
            <p className="text-xs text-muted-foreground">
              Need a change? Please ask an admin to update your account.
            </p>
          </Card>
        </main>
      </div>
    );
  }

  if (!clinic) return <BrandLoader label="Preparing your settings..." />;

  return (
    <div className="min-h-screen bg-gradient-soft">
      <TopBar />
      <main className="container py-4 md:py-6 max-w-2xl space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to dashboard
        </Button>
        <h1 className="font-display text-2xl font-bold">Settings</h1>



        <Card className="p-4 space-y-3">
          <h2 className="font-display text-base font-semibold">Clinic logo</h2>
          <div className="flex items-center gap-4">
            {clinic.logo_url ? (
              <img src={clinic.logo_url} alt="Clinic logo" className="w-16 h-16 rounded-xl object-cover border border-border/60" />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center text-muted-foreground text-xs">No logo</div>
            )}
            <div>
              <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onFile} />
              <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
                <Upload className="w-4 h-4 mr-1.5" />{uploading ? "Uploading..." : "Upload new logo"}
              </Button>
              <p className="text-xs text-muted-foreground mt-1.5">PNG, JPG, or WebP. Max 2MB.</p>
            </div>
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <h2 className="font-display text-base font-semibold">Clinic name</h2>
          <Label htmlFor="cname" className="text-xs">Name</Label>
          <Input id="cname" value={name} onChange={e => setName(e.target.value)} maxLength={120} className="h-9" />
          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={saveName} disabled={saving} className="bg-gradient-primary">
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </Card>

        <Card className="p-4 space-y-2">
          <h2 className="font-display text-base font-semibold">Email</h2>
          <Label htmlFor="cemail" className="text-xs">Signup email</Label>
          <Input
            id="cemail"
            type="email"
            value={user?.email ?? clinic.email ?? ""}
            readOnly
            disabled
            className="h-9 bg-muted cursor-not-allowed"
          />
          <p className="text-xs text-muted-foreground">This is the email you signed up with. It cannot be changed.</p>
        </Card>

        <Card className="p-4 space-y-3 border-destructive/40 bg-destructive/5">
          <div>
            <h2 className="font-display text-base font-semibold text-destructive">Danger Zone</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Permanently remove all patient records from your clinic. This cannot be undone.
            </p>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setConfirmDeleteAll(true)}
            disabled={deletingAll}
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            {deletingAll ? "Deleting..." : "Delete All Patient Data"}
          </Button>
        </Card>
      </main>

      <AlertDialog open={confirmDeleteAll} onOpenChange={(o) => !deletingAll && setConfirmDeleteAll(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all patient data?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all patient data? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAll}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingAll}
              onClick={async (e) => {
                e.preventDefault();
                if (!clinic) return;
                setDeletingAll(true);
                const { error } = await supabase.from("patients").delete().eq("clinic_id", clinic.id);
                setDeletingAll(false);
                if (error) {
                  console.error(error);
                  toast.error("Could not delete patient data. Please try again.");
                  return;
                }
                toast.success("All patient data has been deleted");
                setConfirmDeleteAll(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
