import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import Papa from 'papaparse';
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Patient, StaffMember, todayISO } from "@/lib/clinic";
import { ShieldAlert, RefreshCw, Users, Activity, CalendarClock, ExternalLink } from "lucide-react";
import { isoToDisplay } from "@/lib/format";
import { BrandLoader } from "@/components/BrandLoader";

export default function Admin() {
  const { user, loading, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate("/auth");
    else if (!isAdmin) navigate("/dashboard");
  }, [user, loading, isAdmin, navigate]);

  const load = async () => {
    setBusy(true);
    // Admin = global super view: fetch ALL patients with NO filtering.
    // Stable ordering by created_at ASC then patient_id ASC so rows never
    // jump around on assignment, status change, or edits.
    const [{ data: p }, { data: s }] = await Promise.all([
      supabase
        .from("patients")
        .select("*")
        .order("created_at", { ascending: true })
        .order("patient_number", { ascending: true }),
      supabase.rpc("list_staff"),
    ]);
    setPatients((p ?? []) as Patient[]);
    setStaff((s ?? []) as StaffMember[]);
    setBusy(false);
  };
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  const staffNameMap = useMemo(() => {
    const m = new Map<string, string>();
    staff.forEach(s => m.set(s.user_id, s.email));
    return m;
  }, [staff]);

  const today = todayISO();
  const totalPatients = patients.length;
  const activePatients = useMemo(() => patients.filter(p => p.status === "active").length, [patients]);
  const followUpsDue = useMemo(
    () => patients.filter(p => p.status === "active" && p.next_follow_up_date <= today).length,
    [patients, today]
  );

  if (loading || !isAdmin) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Checking access...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-soft">
      <TopBar />
      <main className="container py-6 sm:py-8 space-y-6 px-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-primary" />
            <h1 className="font-display text-xl sm:text-2xl font-bold">Admin · Patient operations</h1>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => {
              const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(patients, null, 2));
              const downloadAnchorNode = document.createElement('a');
              downloadAnchorNode.setAttribute("href", dataStr);
              downloadAnchorNode.setAttribute("download", "full_database_dump.json");
              document.body.appendChild(downloadAnchorNode);
              downloadAnchorNode.click();
              downloadAnchorNode.remove();
            }}>
              Download Full DB Dump
            </Button>
            
            <Button size="sm" variant="outline" className="relative cursor-pointer">
              Upload CSV Dump
              <input type="file" accept=".csv" className="absolute inset-0 opacity-0 cursor-pointer" onClick={(e) => { (e.target as any).value = null; }} onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (e) => {
                  try {
                    const csvText = e.target?.result as string;
                    
                    const parsed = Papa.parse(csvText, {
                      header: true,
                      skipEmptyLines: true,
                      delimiter: ';'
                    });

                    if (parsed.errors.length && !parsed.data.length) {
                      throw new Error("Failed to parse CSV: " + parsed.errors[0].message);
                    }
                    const data = parsed.data;
                    
                    const { data: clinicData } = await supabase.from('clinics').select('id').limit(1).single();
                    if (!clinicData) throw new Error("Clinic not found. Are you logged in?");

                    const cleanedData = data.map((p: any) => {
                      const cleanP: any = { 
                        clinic_id: clinicData.id, 
                        assigned_to: null 
                      };
                      
                      // Explicitly copy and clean safe fields
                      const safeFields = [
                        'id', 'name', 'phone_number', 'contact_method', 
                        'diagnosis', 'treatment_duration', 'treatment_notes', 
                        'follow_up_type', 'next_follow_up_date', 'status', 
                        'created_at', 'updated_at', 'gender', 'call_status', 
                        'usage_habit', 'notes', 'extra_fields'
                      ];

                      for (const field of safeFields) {
                        if (p[field] !== undefined && p[field] !== null && p[field].trim() !== '') {
                          cleanP[field] = p[field].trim();
                        }
                      }

                      // Handle numerics explicitly
                      cleanP.total_cost = p.total_cost && p.total_cost.trim() !== '' ? parseFloat(p.total_cost) : 0;
                      cleanP.amount_paid = p.amount_paid && p.amount_paid.trim() !== '' ? parseFloat(p.amount_paid) : 0;
                      
                      if (p.age && p.age.trim() !== '') {
                        const parsedAge = parseInt(p.age);
                        if (!isNaN(parsedAge)) cleanP.age = parsedAge;
                      }

                      // Apply fallback defaults
                      if (!cleanP.status) cleanP.status = 'active';
                      if (!cleanP.contact_method) cleanP.contact_method = 'WhatsApp';
                      if (!cleanP.follow_up_type) cleanP.follow_up_type = 'checkup';
                      if (!cleanP.treatment_duration) cleanP.treatment_duration = 'Unknown';
                      if (!cleanP.next_follow_up_date) {
                        const d = new Date();
                        d.setDate(d.getDate() + 7);
                        cleanP.next_follow_up_date = d.toISOString().split('T')[0];
                      }

                      return cleanP;
                    });

                    // Insert in chunks of 50 to avoid payload limits
                    for (let i = 0; i < cleanedData.length; i += 50) {
                      const chunk = cleanedData.slice(i, i + 50);
                      const { error } = await supabase.from('patients').insert(chunk);
                      if (error) throw error;
                    }
                    
                    alert("Import successful! Reloading...");
                    load();
                  } catch (err: any) {
                    alert("Import failed: " + err.message);
                  }
                };
                reader.readAsText(file);
              }} />
            </Button>

            <Button size="sm" variant="outline" onClick={load} disabled={busy}>
              <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Users className="w-4 h-4" /> Total patients
            </div>
            <div className="mt-1 text-2xl font-semibold text-foreground">{totalPatients.toLocaleString()}</div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Activity className="w-4 h-4" /> Active patients
            </div>
            <div className="mt-1 text-2xl font-semibold text-foreground">{activePatients.toLocaleString()}</div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <CalendarClock className="w-4 h-4" /> Follow-ups due
            </div>
            <div className="mt-1 text-2xl font-semibold text-foreground">{followUpsDue.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-1">Active patients due today or earlier</div>
          </Card>
        </div>

        <Card className="overflow-hidden">
          {busy ? (
            <BrandLoader fullScreen={false} label="Loading patients..." />
          ) : patients.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="mb-4">No patients yet.</p>
              <Button asChild className="bg-gradient-primary">
                <Link to="/dashboard">Go to dashboard to add patients</Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto -webkit-overflow-scrolling-touch">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-muted/50 border-b border-border/60 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Phone</th>
                    <th className="px-4 py-3 font-medium">Diagnosis</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Assigned to</th>
                    <th className="px-4 py-3 font-medium">Last updated</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {patients.map(p => (
                    <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{p.name}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{p.phone_number}</td>
                      <td className="px-4 py-3 text-muted-foreground">{p.diagnosis}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={`capitalize ${statusBadgeClass(p.status)}`}>
                          {p.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.assigned_to ? (staffNameMap.get(p.assigned_to) ?? "—") : <span className="italic">Unassigned</span>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {isoToDisplay(p.updated_at.slice(0, 10))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/dashboard" title="Open in dashboard">
                            <ExternalLink className="w-4 h-4" />
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}

const statusBadgeClass = (status: Patient["status"]) => {
  switch (status) {
    case "active":
      return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900";
    case "completed":
      return "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900";
    case "lost":
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900";
  }
};
