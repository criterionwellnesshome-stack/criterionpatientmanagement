import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { BrandLoader } from "@/components/BrandLoader";
import { Activity, UserPlus, FileEdit, AlertCircle, Clock } from "lucide-react";
import { StaffMember } from "@/lib/clinic";

interface AuditLog {
  id: string;
  patient_id: string;
  action: string;
  changed_by: string;
  changes: any;
  created_at: string;
  patients: { name: string; patient_number: string } | null;
}

export default function TodaysActivity() {
  const navigate = useNavigate();
  const { user, isAdmin, isClinic } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [staffMap, setStaffMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  // We only allow Admins or Clinic Owners
  const hasAccess = isAdmin || isClinic;

  const loadActivity = async () => {
    if (!user) return;
    setLoading(true);
    
    const { data: logData, error } = await supabase
      .from("patient_audit_logs")
      .select(`
        *,
        patients ( name, patient_number )
      `)
      .order("created_at", { ascending: false })
      .limit(200);

    if (logData) setLogs(logData as any[]);

    // Fetch staff names
    const { data: sData } = await supabase.rpc("get_user_names");
    if (sData) {
      const map = new Map<string, string>();
      (sData as any[]).forEach(s => map.set(s.user_id, s.full_name || s.email));
      setStaffMap(map);
    }
    
    setLoading(false);
  };

  useEffect(() => {
    if (hasAccess) {
      loadActivity();

      const channel = supabase
        .channel('realtime-audit-logs')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'patient_audit_logs'
          },
          () => {
            loadActivity();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else if (user) {
      navigate("/dashboard");
    }
  }, [user, hasAccess]);

  if (loading) return <BrandLoader message="Loading activity..." />;
  if (!hasAccess) return null;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todaysLogs = logs.filter(l => new Date(l.created_at) >= startOfToday);
  const newPatientsCount = todaysLogs.filter(l => l.action === 'INSERT').length;
  const updatesCount = todaysLogs.filter(l => l.action === 'UPDATE').length;

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <TopBar onHome={() => navigate("/dashboard")} title="Today's Activity" />

      <main className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <Activity className="w-8 h-8 text-brand-600" />
          <h1 className="text-2xl font-bold font-heading text-brand-900 tracking-tight">Today's Activity</h1>
        </div>

        {/* Top Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="p-6 border-brand-100 bg-brand-50/30 flex items-center shadow-sm">
            <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 mr-4">
              <UserPlus className="w-6 h-6" />
            </div>
            <div>
              <div className="text-3xl font-bold text-brand-900">{newPatientsCount}</div>
              <div className="text-sm font-medium text-muted-foreground">New Patients Added Today</div>
            </div>
          </Card>
          
          <Card className="p-6 border-brand-100 bg-brand-50/30 flex items-center shadow-sm">
            <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 mr-4">
              <FileEdit className="w-6 h-6" />
            </div>
            <div>
              <div className="text-3xl font-bold text-brand-900">{updatesCount}</div>
              <div className="text-sm font-medium text-muted-foreground">Patient Updates Today</div>
            </div>
          </Card>
        </div>

        {/* Audit Log Feed */}
        <Card className="border-border/60 shadow-sm overflow-hidden mt-8">
          <div className="bg-muted/30 p-4 border-b border-border/60 font-semibold text-brand-900">
            Real-Time Audit Log
          </div>
          
          <div className="divide-y divide-border/40">
            {logs.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">No activity recorded today yet.</div>
            ) : (
              logs.map(log => {
                const staffName = staffMap.get(log.changed_by) || "Unknown User";
                const time = new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const patientName = log.patients?.name || "Deleted Patient";
                const patientNum = log.patients?.patient_number || "";
                
                return (
                  <div key={log.id} className="p-4 hover:bg-muted/10 transition-colors flex gap-4">
                    <div className="mt-1 text-muted-foreground">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start">
                        <div className="font-medium text-sm">
                          <span className="text-brand-700 font-semibold">{staffName}</span>
                          {" "}
                          {log.action === 'INSERT' ? "added a new patient" : 
                           log.action === 'UPDATE' ? "updated patient details for" : 
                           "deleted patient"}
                          {" "}
                          <span 
                            className="font-semibold text-foreground cursor-pointer hover:underline"
                            onClick={() => log.action !== 'DELETE' && navigate(`/patient/${log.patient_id}`)}
                          >
                            {patientName} {patientNum && `(${patientNum})`}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap ml-4 bg-muted px-2 py-0.5 rounded-full">
                          {time}
                        </div>
                      </div>
                      
                      {/* Changes Details */}
                      {log.action === 'UPDATE' && (
                        <div className="mt-2 text-xs bg-muted/30 border border-border/50 rounded p-2 text-muted-foreground">
                          <span className="font-semibold text-foreground/70 mb-1 block">Patient Profile Updated</span>
                          {(() => {
                            const changes = log.changes;
                            if (!changes || typeof changes !== 'object') return <span className="text-xs">Patient details updated.</span>;
                            
                            const fieldLabels: Record<string, string> = {
                              status: "Status",
                              call_status: "Call Status",
                              diagnosis: "Diagnosis",
                              phone_number: "Phone Number",
                              assigned_to: "Assigned Staff",
                              treatment_notes: "Treatment Notes"
                            };

                            const changeItems: React.ReactNode[] = [];
                            
                            Object.keys(changes).forEach(key => {
                              const change = changes[key];
                              if (change && typeof change === 'object' && 'old' in change && 'new' in change) {
                                const label = fieldLabels[key] || key;
                                let oldVal = change.old === null ? "None" : String(change.old);
                                let newVal = change.new === null ? "None" : String(change.new);
                                
                                if (key === 'assigned_to') {
                                  oldVal = staffMap.get(change.old) || change.old || "None";
                                  newVal = staffMap.get(change.new) || change.new || "None";
                                }

                                changeItems.push(
                                  <div key={key} className="mt-1">
                                    • Changed <strong className="text-foreground/80">{label}</strong> from <span className="italic">"{oldVal}"</span> to <strong className="text-emerald-700">"{newVal}"</strong>
                                  </div>
                                );
                              }
                            });

                            if (changeItems.length === 0) {
                              // If it is an older snapshot style log, print fallback
                              return <span className="text-xs">Patient details updated.</span>;
                            }

                            return <div className="space-y-0.5 mt-1">{changeItems}</div>;
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </main>
    </div>
  );
}
