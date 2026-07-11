import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Clinic, Patient, StaffMember, todayISO, buildWhatsAppLink, staffDisplayName } from "@/lib/clinic";
import { TopBar } from "@/components/TopBar";
import { PatientFormDialog } from "@/components/PatientFormDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Plus, Search, MessageCircle, MoreVertical, AlertTriangle, CalendarClock, Users, Download, Upload, UserCheck, X, Pill } from "lucide-react";
import { isoToDisplay, displayToIso, isoToDayMonth } from "@/lib/format";
import { ImportPatientsDialog } from "@/components/ImportPatientsDialog";
import { trackEngagement } from "@/lib/engagement";
import { BrandLoader } from "@/components/BrandLoader";

import { toast } from "sonner";

const UNASSIGNED = "__unassigned__";

export default function Dashboard() {
  const { user, loading, isAdmin, isSupport } = useAuth();
  const navigate = useNavigate();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | Patient["status"]>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Patient | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Patient | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);

  // Admin-only flag for assignment UI; support users are read-mostly.
  const canManage = isAdmin; // admins (incl. clinic owner who is admin) manage assignments
  const canEdit = isAdmin || isSupport; // support can edit their own patients
  const supportOnly = isSupport && !isAdmin; // simplified support view

  useEffect(() => { if (!loading && !user) navigate("/auth"); }, [user, loading, navigate]);

  const load = async () => {
    if (!user) return;
    setBusy(true);

    // Single-organization system: load the org clinic record. If admin has none, bootstrap one
    // so all patient flows (Add / Import / assign) work without backend changes.
    const { data: clinics } = await supabase.from("clinics").select("*").limit(1);
    let c = (clinics?.[0] as Clinic | undefined) ?? null;
    if (!c && isAdmin) {
      const { data: created, error: createErr } = await supabase
        .from("clinics")
        .insert({
          user_id: user.id,
          clinic_name: "Criterion Wellness Home",
          email: user.email ?? "admin@criterionwellness.local",
        } as never)
        .select()
        .maybeSingle();
      if (createErr) {
        console.error("Failed to bootstrap default clinic:", createErr);
      } else if (created) {
        c = created as Clinic;
      }
    }
    setClinic(c);

    // Patients are filtered by RLS:
    // - admin / clinic owner → all patients
    // - support → only patients where assigned_to = auth.uid()
    // Stable ordering across admin + wellness dashboards.
    // Order by created_at ASC then patient_number ASC so rows never jump around
    // when status, call status, notes, or assignment are updated.
    const { data: p } = await supabase
      .from("patients")
      .select("*")
      .order("created_at", { ascending: true })
      .order("patient_number", { ascending: true });
    console.debug("[patients] fetched", p?.length ?? 0, "first:", p?.[0] ? { id: p[0].id, patient_number: p[0].patient_number, name: p[0].name } : null);
    setPatients((p ?? []) as Patient[]);

    // Staff list (for assignment dropdown). Only admins can call list_staff.
    if (isAdmin) {
      const { data: s } = await supabase.rpc("list_staff");
      setStaff((s ?? []) as StaffMember[]);
    }

    setBusy(false);
  };
  useEffect(() => { if (user) load(); }, [user, isAdmin]);

  const today = todayISO();
  const dueToday = useMemo(() => patients.filter(p => p.status === "active" && p.next_follow_up_date === today), [patients, today]);
  const overdue = useMemo(() => patients.filter(p => p.status === "active" && p.next_follow_up_date < today), [patients, today]);
  const renewalDue = useMemo(() => patients.filter(p => p.status === "active" && p.medication_renewal_status === "due"), [patients]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let list = patients;
    if (statusFilter !== "all") list = list.filter(p => p.status === statusFilter);
    if (q) list = list.filter(p => p.name?.toLowerCase()?.includes(q) || p.diagnosis?.toLowerCase()?.includes(q) || p.phone_number?.includes(q) || p.patient_number?.toLowerCase()?.includes(q));
    return list;
  }, [patients, search, statusFilter]);

  // Keep selection in sync with filtered/visible rows.
  const allVisibleSelected = filtered.length > 0 && filtered.every(p => selected.has(p.id));
  const toggleSelectAll = () => {
    setSelected(prev => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        filtered.forEach(p => next.delete(p.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach(p => next.add(p.id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Map of user_id → display name (falls back to email) for ALL staff including admins,
  // so existing patient assignments to an admin still render a sensible label.
  const staffNameMap = useMemo(() => {
    const m = new Map<string, string>();
    staff.forEach(s => m.set(s.user_id, staffDisplayName(s)));
    return m;
  }, [staff]);

  // Assignable staff: only Wellness Support — admins are excluded from the picker.
  const assignableStaff = useMemo(
    () => staff.filter(s => s.role === "support"),
    [staff]
  );

  const updateStatus = async (p: Patient, status: Patient["status"]) => {
    let next_follow_up_date = p.next_follow_up_date;
    if (status === "active") {
      const defaultIso = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const input = window.prompt("Next follow-up date (DD/MM/YYYY):", isoToDisplay(defaultIso));
      if (!input) return;
      const iso = displayToIso(input);
      if (!iso) {
        toast.error("Invalid date format. Use DD/MM/YYYY.");
        return;
      }
      next_follow_up_date = iso;
    }
    const { data, error } = await supabase.from("patients").update({ status, next_follow_up_date }).eq("id", p.id).select().maybeSingle();
    if (error) {
      console.error(error);
      toast.error("Could not update patient. Please try again.");
      return;
    }
    if (status === "completed") trackEngagement(clinic?.id, "completed", p.id);
    setPatients(prev => prev.map(row => row.id === p.id ? { ...row, ...(data as Patient ?? { status, next_follow_up_date }) } : row));
    toast.success("Updated");
  };

  const updateCallStatus = async (p: Patient, call_status: Patient["call_status"]) => {
    const { data, error } = await supabase
      .from("patients")
      .update({ call_status })
      .eq("id", p.id)
      .select()
      .maybeSingle();
    if (error) {
      console.error(error);
      toast.error("Could not update call status.");
      return;
    }
    setPatients(prev => prev.map(row => row.id === p.id ? { ...row, ...(data as Patient ?? { call_status }) } : row));
    toast.success("Updated");
  };

  const updateMedicationStatus = async (p: Patient, medication_renewal_status: Patient["medication_renewal_status"]) => {
    const { data, error } = await supabase
      .from("patients")
      .update({ medication_renewal_status })
      .eq("id", p.id)
      .select()
      .maybeSingle();
    if (error) {
      console.error(error);
      toast.error("Could not update medication status.");
      return;
    }
    setPatients(prev => prev.map(row => row.id === p.id ? { ...row, ...(data as Patient ?? { medication_renewal_status }) } : row));
    toast.success("Updated");
  };

  const assignPatient = async (p: Patient, assignedTo: string | null) => {
    const { data, error } = await supabase
      .from("patients")
      .update({ assigned_to: assignedTo })
      .eq("id", p.id)
      .select()
      .maybeSingle();
    if (error) {
      console.error(error);
      toast.error("Could not update assignment.");
      return;
    }
    setPatients(prev => prev.map(r => (r.id === p.id ? { ...r, ...(data as Patient) } : r)));
    toast.success(assignedTo ? "Patient assigned" : "Assignment cleared");
  };

  const bulkAssign = async (assignedTo: string | null) => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const { error } = await supabase
      .from("patients")
      .update({ assigned_to: assignedTo })
      .in("id", ids);
    if (error) {
      console.error(error);
      toast.error("Bulk assignment failed.");
      return;
    }
    setPatients(prev => prev.map(r => (selected.has(r.id) ? { ...r, assigned_to: assignedTo } : r)));
    toast.success(`Assigned ${ids.length} patient${ids.length === 1 ? "" : "s"}`);
    setSelected(new Set());
    setBulkAssignOpen(false);
  };

  const exportCsv = () => {
    if (!patients.length) { toast.error("No patients to export"); return; }
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = ["Name", "Phone", "Diagnosis", "Treatment notes", "Follow-up date", "Assigned to"];
    const rows = patients.map(p => [
      p.name, p.phone_number, p.diagnosis, p.treatment_notes ?? "", isoToDisplay(p.next_follow_up_date),
      p.assigned_to ? (staffNameMap.get(p.assigned_to) ?? p.assigned_to) : "Unassigned",
    ].map(escape).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const rawName = (clinic?.clinic_name ?? "Criterion Wellness Home").trim();
    const safeName = rawName.replace(/[\\/:*?"<>|\x00-\x1F]/g, "").replace(/\s+/g, " ").trim();
    a.download = safeName ? `${safeName} - Patients.csv` : `Criterion Wellness Home Patients.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast.success("Export started");
  };

  const contact = (p: Patient) => {
    // Always WhatsApp — wa.me/{phone}. Phone is sanitized to digits.
    const clinicName = (clinic?.clinic_name ?? "Criterion Wellness Home").trim();
    const followText = p.next_follow_up_date ? ` scheduled for ${isoToDisplay(p.next_follow_up_date)}` : "";
    const msg = `Hi ${p.name}, this is a reminder from ${clinicName} regarding your follow-up${followText}. Please confirm.`;
    trackEngagement(clinic?.id, "whatsapp", p.id);
    window.open(buildWhatsAppLink(p.phone_number, msg), "_blank");
  };

  const openNew = () => {
    setEditing(null); setDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    const { error } = await supabase.from("patients").delete().eq("id", id);
    if (error) {
      console.error(error);
      toast.error("Could not delete patient. Please try again.");
    } else {
      toast.success("Patient deleted");
      setPatients(prev => prev.filter(row => row.id !== id));
    }
    setDeleteTarget(null);
  };

  if (loading || busy) return <BrandLoader label="Preparing your dashboard..." />;

  // Support users may not have a clinic record they can read. That's OK — we still show their assigned patients.
  const headerName = clinic?.clinic_name ?? "Criterion Wellness Home";

  return (
    <div className="min-h-screen bg-gradient-soft">
      <TopBar showSettings />
      {isSupport && !isAdmin && (
        <div className="container pt-6">
          <div className="text-xs text-muted-foreground">Support staff · viewing your assigned patients</div>
        </div>
      )}
      <main className="container py-6 md:py-8 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 md:gap-4">
          <StatCard icon={CalendarClock} label="Due today" value={dueToday.length} tone="primary" />
          <StatCard icon={AlertTriangle} label="Overdue" value={overdue.length} tone="warning" />
          <StatCard icon={Pill} label="Medication renewal due" value={renewalDue.length} tone="danger" />
          <StatCard icon={Users} label={isSupport && !isAdmin ? "My patients" : "Total patients"} value={patients.length} tone="success" />
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search name, phone..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
            </div>
            <div className="flex gap-2 flex-wrap">
              {canManage && clinic && (
                <Button variant="outline" onClick={() => setImportOpen(true)}>
                  <Upload className="w-4 h-4 mr-1.5" /> Import Patients
                </Button>
              )}
              {canManage && (
                <Button variant="outline" onClick={exportCsv} disabled={!patients.length}>
                  <Download className="w-4 h-4 mr-1.5" /> Export Data
                </Button>
              )}
              {canManage && clinic && (
                <Button onClick={openNew} className="bg-gradient-primary shadow-glow">
                  <Plus className="w-4 h-4 mr-1.5" /> Add Patient
                </Button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["all", "active", "completed", "lost"] as const).map(f => (
              <Button
                key={f}
                size="sm"
                variant={statusFilter === f ? "default" : "outline"}
                onClick={() => setStatusFilter(f)}
                className={`capitalize h-8 ${statusFilter === f ? "bg-gradient-primary" : ""}`}
              >
                {f}
              </Button>
            ))}
          </div>
        </div>

        {/* Bulk action bar (admin only) */}
        {canManage && selected.size > 0 && (
          <div className="sticky top-16 z-20 -mx-2 sm:mx-0">
            <Card className="p-3 flex items-center justify-between gap-3 border-primary/40 bg-primary/5">
              <div className="text-sm">
                <span className="font-semibold">{selected.size}</span> patient{selected.size === 1 ? "" : "s"} selected
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => setBulkAssignOpen(true)} className="bg-gradient-primary">
                  <UserCheck className="w-4 h-4 mr-1.5" /> Assign to staff
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  <X className="w-4 h-4 mr-1.5" /> Clear
                </Button>
              </div>
            </Card>
          </div>
        )}

        <Card className="overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="mb-4">
                {isSupport && !isAdmin
                  ? "No patients are assigned to you yet."
                  : "No patients yet"}
              </p>
              {canManage && clinic && (
                <Button onClick={openNew} className="bg-gradient-primary shadow-glow">
                  <Plus className="w-4 h-4 mr-1.5" /> Add Patient
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="bg-muted/50 border-b border-border/60">
                  <tr className="text-left">
                    {canManage && (
                      <th className="px-3 py-3 w-10">
                        <Checkbox
                          checked={allVisibleSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="Select all"
                        />
                      </th>
                    )}
                    <th className="px-3 py-3 font-medium">Name</th>
                    <th className="px-3 py-3 font-medium whitespace-nowrap">Phone</th>
                    <th className="px-3 py-3 font-medium hidden md:table-cell">Diagnosis</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 font-medium">Call status</th>
                    <th className="px-3 py-3 font-medium">Medication</th>
                    {canManage && <th className="px-3 py-3 font-medium hidden lg:table-cell">Assigned to</th>}
                    {!supportOnly && <th className="px-3 py-3 font-medium hidden lg:table-cell whitespace-nowrap">Updated</th>}
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const shortDiagnosis = p.diagnosis && p.diagnosis.length > 60 ? `${p.diagnosis.slice(0, 60)}…` : (p.diagnosis ?? "—");
                    return (
                      <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                        {canManage && (
                          <td className="px-3 py-3">
                            <Checkbox
                              checked={selected.has(p.id)}
                              onCheckedChange={() => toggleOne(p.id)}
                              aria-label={`Select ${p.name}`}
                            />
                          </td>
                        )}
                        <td className="px-3 py-3 cursor-pointer" onClick={() => navigate(`/patient/${p.id}`)}>
                          <div className="font-medium hover:underline text-brand-700">
                            {p.name}
                          </div>
                          <div className="text-xs text-emerald-600 font-bold mt-0.5">{p.patient_number}</div>
                          <div className="text-xs text-muted-foreground md:hidden mt-0.5">{shortDiagnosis}</div>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground whitespace-nowrap cursor-pointer" onClick={() => navigate(`/patient/${p.id}`)}>
                          {p.phone_number}
                        </td>
                        <td className="px-3 py-3 hidden md:table-cell text-muted-foreground cursor-pointer" title={p.diagnosis ?? ""} onClick={() => navigate(`/patient/${p.id}`)}>
                          {shortDiagnosis}
                        </td>
                        <td className="px-3 py-3">
                          <Select
                            value={p.status}
                            onValueChange={(v) => updateStatus(p, v as Patient["status"])}
                          >
                            <SelectTrigger className={`h-8 w-[120px] capitalize border ${statusTriggerClass(p.status)}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                              <SelectItem value="lost">Lost</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <Select
                              value={p.call_status ?? "none"}
                              onValueChange={(v) =>
                                updateCallStatus(p, v === "none" ? null : (v as Patient["call_status"]))
                              }
                            >
                              <SelectTrigger className={`h-8 w-[140px] border ${callTriggerClass(p.call_status)}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">—</SelectItem>
                                <SelectItem value="responded">Responded</SelectItem>
                                <SelectItem value="no_response">No response</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => contact(p)}
                              title="Send WhatsApp"
                              className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/40"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Select
                            value={p.medication_renewal_status || "active"}
                            onValueChange={(v) => updateMedicationStatus(p, v as "active" | "due")}
                          >
                            <SelectTrigger className={`h-8 w-[100px] border ${medicationTriggerClass(p.medication_renewal_status)}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">Active</SelectItem>
                              <SelectItem value="due">Due</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        {canManage && (
                          <td className="px-3 py-3 hidden lg:table-cell">
                            {(() => {
                              const assignedId = p.assigned_to;
                              const assignedIsAssignable = assignedId
                                ? assignableStaff.some(s => s.user_id === assignedId)
                                : true;
                              const assignedLabel = assignedId ? (staffNameMap.get(assignedId) ?? "Unknown user") : "";
                              return (
                                <Select
                                  value={assignedId ?? UNASSIGNED}
                                  onValueChange={(v) => assignPatient(p, v === UNASSIGNED ? null : v)}
                                >
                                  <SelectTrigger className="h-8 w-[200px]">
                                    <SelectValue placeholder="Unassigned" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                                    {/* If currently assigned to a non-support user (legacy admin assignment), keep it visible so admin can reassign. */}
                                    {assignedId && !assignedIsAssignable && (
                                      <SelectItem value={assignedId}>
                                        {assignedLabel} (legacy)
                                      </SelectItem>
                                    )}
                                    {assignableStaff.map(s => (
                                      <SelectItem key={s.user_id} value={s.user_id}>
                                        {staffDisplayName(s)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              );
                            })()}
                          </td>
                        )}
                        {!supportOnly && (
                          <td className="px-3 py-3 hidden lg:table-cell text-muted-foreground whitespace-nowrap">
                            {p.updated_at ? isoToDayMonth(p.updated_at.slice(0, 10)) : "—"}
                          </td>
                        )}
                        <td className="px-3 py-3">
                          <div className="flex justify-end">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost"><MoreVertical className="w-4 h-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => navigate(`/patient/${p.id}`)} className="font-medium text-brand-600">
                                  View Profile
                                </DropdownMenuItem>
                                {canEdit && (
                                  <DropdownMenuItem onClick={() => { setEditing(p); setDialogOpen(true); }}>Edit Details</DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => updateStatus(p, "active")}>Mark active + reschedule</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => updateStatus(p, "completed")}>Mark completed</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => updateStatus(p, "lost")}>Mark lost</DropdownMenuItem>
                                {canManage && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => setDeleteTarget(p)} className="text-destructive focus:text-destructive">Delete patient</DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </main>

      {dialogOpen && (clinic || editing) && (
        <PatientFormDialog
          open={dialogOpen} onOpenChange={setDialogOpen}
          clinicId={clinic?.id ?? editing?.clinic_id ?? ""} patient={editing}
          onSaved={(saved, previous) => {
            setPatients(prev => {
              const exists = prev.some(r => r.id === saved.id);
              return exists
                ? prev.map(r => (r.id === saved.id ? saved : r))
                : [...prev, saved];
            });

            if (previous) {
              toast.success("Changes saved", {
                duration: 6000,
                action: {
                  label: "Undo",
                  onClick: async () => {
                    setPatients(prev => prev.map(r => (r.id === previous.id ? previous : r)));
                    const { error } = await supabase
                      .from("patients")
                      .update({
                        name: previous.name,
                        phone_number: previous.phone_number,
                        contact_method: previous.contact_method,
                        diagnosis: previous.diagnosis,
                        treatment_duration: previous.treatment_duration,
                        treatment_notes: previous.treatment_notes,
                        follow_up_type: previous.follow_up_type,
                        next_follow_up_date: previous.next_follow_up_date,
                        total_cost: previous.total_cost,
                        amount_paid: previous.amount_paid,
                      })
                      .eq("id", previous.id);
                    if (error) {
                      console.error(error);
                      toast.error("Could not undo changes");
                      setPatients(prev => prev.map(r => (r.id === saved.id ? saved : r)));
                      return;
                    }
                    toast.success("Changes reverted");
                  },
                },
              });
            } else {
              toast.success("Patient added successfully");
            }
          }}
        />
      )}

      {importOpen && clinic && (
        <ImportPatientsDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          clinic={clinic}
          existingPatients={patients}
          onImported={load}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete patient?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this patient? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk assign dialog */}
      <AlertDialog open={bulkAssignOpen} onOpenChange={setBulkAssignOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Assign {selected.size} patient{selected.size === 1 ? "" : "s"}</AlertDialogTitle>
            <AlertDialogDescription>
              Choose a staff member to assign the selected patients to. They will become responsible for these patients.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <BulkAssignPicker staff={assignableStaff} onPick={bulkAssign} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const BulkAssignPicker = ({ staff, onPick }: { staff: StaffMember[]; onPick: (id: string | null) => void }) => {
  const [value, setValue] = useState<string>("");
  return (
    <div className="space-y-3">
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger><SelectValue placeholder="Select staff member" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>Unassigned (clear)</SelectItem>
          {staff.map(s => (
            <SelectItem key={s.user_id} value={s.user_id}>
              {staffDisplayName(s)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        className="w-full bg-gradient-primary"
        disabled={!value}
        onClick={() => onPick(value === UNASSIGNED ? null : value)}
      >
        Confirm assignment
      </Button>
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number | string; tone: "primary" | "warning" | "success" | "muted" | "danger" }) => {
  const toneMap = {
    primary: "bg-accent text-accent-foreground",
    warning: "bg-warning/15 text-warning",
    success: "bg-success/15 text-success",
    muted: "bg-muted text-muted-foreground",
    danger: "bg-destructive/15 text-destructive",
  };
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${toneMap[tone]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-2xl font-display font-bold leading-none">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </div>
    </Card>
  );
};

const statusTriggerClass = (status: Patient["status"]) => {
  switch (status) {
    case "active":
      return "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900";
    case "completed":
      return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900";
    case "lost":
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900";
  }
};

const callTriggerClass = (cs: Patient["call_status"]) => {
  switch (cs) {
    case "responded":
      return "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900";
    case "no_response":
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900";
    default:
      return "";
  }
};

const medicationTriggerClass = (status: Patient["medication_renewal_status"]) => {
  switch (status) {
    case "active":
      return "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900";
    case "due":
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900";
    default:
      return "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900";
  }
};
