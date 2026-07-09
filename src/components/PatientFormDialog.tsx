import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import { toast } from "sonner";
import { Patient } from "@/lib/clinic";
import { isoToDisplay } from "@/lib/format";
import { trackEngagement } from "@/lib/engagement";
import { useAuth } from "@/lib/auth";

// Required: name + phone. Everything else is optional / operational.
const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  phone_number: z
    .string()
    .trim()
    .min(5, "Phone number is too short")
    .max(20)
    .regex(/^\+?\d+$/, "Enter a valid phone number"),
  diagnosis: z.string().trim().max(500).optional(),
  gender: z.enum(["Male", "Female"]).nullable().optional(),
  age: z.number().int().min(0).max(150).nullable().optional(),
  status: z.enum(["active", "completed", "lost"]),
  next_follow_up_date: z.string().optional().nullable(),
  call_status: z.enum(["responded", "no_response"]).nullable().optional(),
  usage_habit: z.enum(["frequent", "not_frequent"]).nullable().optional(),
  notes: z.string().max(2000).optional(),
  treatment_duration: z.string().max(120).optional(),
  total_cost: z.number().min(0).max(1_000_000_000),
  amount_paid: z.number().min(0).max(1_000_000_000),
});

// Format a numeric string with thousands separators. Accepts arbitrary input,
// strips non-digits, returns empty string if no digits remain.
const formatMoney = (raw: string) => {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
};
const moneyToNumber = (s: string) => {
  const digits = s.replace(/[^\d]/g, "");
  return digits ? Number(digits) : 0;
};

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clinicId: string;
  patient?: Patient | null;
  onSaved: (saved: Patient, previous?: Patient) => void;
}

const NONE = "__none__";

type FormState = {
  name: string;
  phone_number: string;
  diagnosis: string;
  gender: "Male" | "Female" | "";
  age: string;
  status: "active" | "completed" | "lost";
  next_follow_up_date: string;
  call_status: "responded" | "no_response" | "";
  usage_habit: "frequent" | "not_frequent" | "";
  notes: string;
  treatment_duration: string;
  total_cost: string; // formatted with commas
  amount_paid: string; // formatted with commas
};

const empty: FormState = {
  name: "",
  phone_number: "",
  diagnosis: "",
  gender: "",
  age: "",
  status: "active",
  next_follow_up_date: "",
  call_status: "",
  usage_habit: "",
  notes: "",
  treatment_duration: "",
  total_cost: "",
  amount_paid: "",
};

const draftKey = (clinicId: string, patientId?: string) =>
  `criterion:patient-draft:${clinicId}:${patientId ?? "new"}`;

const isoToDate = (iso: string): Date | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
};
const dateToIso = (d: Date) => {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
};

export const PatientFormDialog = ({ open, onOpenChange, clinicId, patient, onSaved }: Props) => {
  const { isAdmin } = useAuth();
  const isEdit = !!patient;
  // Support staff editing an existing patient: only operational fields are editable.
  // Admin: full access on everything.
  // For new patients, only admins reach this dialog (Dashboard already gates).
  const opOnly = isEdit && !isAdmin;

  const buildInitial = (): FormState =>
    patient
      ? {
          name: patient.name,
          phone_number: patient.phone_number,
          diagnosis: patient.diagnosis ?? "",
          gender: patient.gender ?? "",
          age: patient.age != null ? String(patient.age) : "",
          status: patient.status,
          next_follow_up_date: patient.next_follow_up_date ?? "",
          call_status: patient.call_status ?? "",
          usage_habit: patient.usage_habit ?? "",
          notes: patient.notes ?? "",
          treatment_duration: patient.treatment_duration ?? "",
          total_cost: patient.total_cost ? Number(patient.total_cost).toLocaleString("en-US") : "",
          amount_paid: patient.amount_paid ? Number(patient.amount_paid).toLocaleString("en-US") : "",
        }
      : empty;

  const [form, setForm] = useState<FormState>(() => {
    const base = buildInitial();
    try {
      const raw = localStorage.getItem(draftKey(clinicId, patient?.id));
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<FormState>;
        return { ...base, ...parsed };
      }
    } catch {
      /* ignore */
    }
    return base;
  });
  const [saving, setSaving] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(draftKey(clinicId, patient?.id), JSON.stringify(form));
    } catch {
      /* ignore */
    }
  }, [form, open, clinicId, patient?.id]);

  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey(clinicId, patient?.id));
    } catch {
      /* ignore */
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ageNum = form.age.trim() === "" ? null : Number(form.age);
    const totalCostNum = moneyToNumber(form.total_cost);
    const amountPaidNum = moneyToNumber(form.amount_paid);
    const parsed = schema.safeParse({
      name: form.name,
      phone_number: form.phone_number,
      diagnosis: form.diagnosis || undefined,
      gender: form.gender || null,
      age: ageNum,
      status: form.status,
      next_follow_up_date: form.next_follow_up_date || null,
      call_status: form.call_status || null,
      usage_habit: form.usage_habit || null,
      notes: form.notes || undefined,
      treatment_duration: form.treatment_duration || undefined,
      total_cost: totalCostNum,
      amount_paid: amountPaidNum,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    if (parsed.data.amount_paid > parsed.data.total_cost) {
      toast.error("Amount paid cannot exceed total cost");
      return;
    }
    setSaving(true);

    let payload: Record<string, unknown>;
    if (opOnly) {
      // Support: only operational fields. Financial + treatment fields are read-only.
      payload = {
        status: parsed.data.status,
        next_follow_up_date: parsed.data.next_follow_up_date || null,
        call_status: parsed.data.call_status ?? null,
        usage_habit: parsed.data.usage_habit ?? null,
        notes: parsed.data.notes ?? null,
      };
    } else {
      payload = {
        name: parsed.data.name,
        phone_number: parsed.data.phone_number,
        diagnosis: parsed.data.diagnosis ?? null,
        gender: parsed.data.gender ?? null,
        age: parsed.data.age ?? null,
        status: parsed.data.status,
        next_follow_up_date: parsed.data.next_follow_up_date || null,
        call_status: parsed.data.call_status ?? null,
        usage_habit: parsed.data.usage_habit ?? null,
        notes: parsed.data.notes ?? null,
        treatment_duration: parsed.data.treatment_duration ?? "",
        total_cost: parsed.data.total_cost,
        amount_paid: parsed.data.amount_paid,
      };
      if (!isEdit) {
        payload.clinic_id = clinicId;
        payload.assigned_to = null;
        // Legacy required-ish defaults so any old code paths keep working.
        payload.contact_method = "WhatsApp";
        payload.follow_up_type = "checkup";
      }
    }

    const { data: savedRow, error } = isEdit
      ? await supabase.from("patients").update(payload as never).eq("id", patient!.id).select().maybeSingle()
      : await supabase.from("patients").insert(payload as never).select().maybeSingle();
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(error.message || "Could not save patient. Please try again.");
      return;
    }
    if (!isEdit) trackEngagement(clinicId, "patient_added");
    clearDraft();
    onSaved((savedRow ?? { ...(patient ?? {}), ...payload }) as Patient, patient ?? undefined);
    onOpenChange(false);
  };

  const selectedDate = form.next_follow_up_date ? isoToDate(form.next_follow_up_date) : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">
            {isEdit ? "Edit patient" : "New patient"}
          </DialogTitle>
          {opOnly && (
            <p className="text-xs text-muted-foreground">
              Support access · you can update status, follow-up, call status, usage habit and notes.
            </p>
          )}
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4 pt-2">
          <div className="grid sm:grid-cols-2 gap-4">
            {/* CORE — read-only for support */}
            <div>
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                required
                disabled={opOnly}
              />
            </div>
            <div>
              <Label>Phone <span className="text-destructive">*</span></Label>
              <Input
                inputMode="tel"
                pattern="^\+?\d+$"
                placeholder="e.g., +23412345678"
                value={form.phone_number}
                onChange={e => setForm({ ...form, phone_number: e.target.value.replace(/[^\d+]/g, "") })}
                required
                disabled={opOnly}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Diagnosis</Label>
              <Input
                value={form.diagnosis}
                onChange={e => setForm({ ...form, diagnosis: e.target.value })}
                disabled={opOnly}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Treatment duration</Label>
              <Input
                placeholder="e.g., 6 weeks"
                value={form.treatment_duration}
                onChange={e => setForm({ ...form, treatment_duration: e.target.value })}
                disabled={opOnly}
                maxLength={120}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Next follow-up date</Label>
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal h-10",
                      !form.next_follow_up_date && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {form.next_follow_up_date ? isoToDisplay(form.next_follow_up_date) : "DD/MM/YYYY"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={(d) => {
                      if (d) {
                        setForm({ ...form, next_follow_up_date: dateToIso(d) });
                        setDatePickerOpen(false);
                      }
                    }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="sm:col-span-2">
              <Label>Notes</Label>
              <Textarea
                rows={3}
                placeholder="Internal notes about this patient..."
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            {/* OPERATIONAL */}
            <div>
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as FormState["status"] })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Call status</Label>
              <Select
                value={form.call_status || NONE}
                onValueChange={(v) =>
                  setForm({ ...form, call_status: v === NONE ? "" : (v as "responded" | "no_response") })
                }
              >
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  <SelectItem value="responded">Responded</SelectItem>
                  <SelectItem value="no_response">No response</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Usage habit</Label>
              <Select
                value={form.usage_habit || NONE}
                onValueChange={(v) =>
                  setForm({ ...form, usage_habit: v === NONE ? "" : (v as "frequent" | "not_frequent") })
                }
              >
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  <SelectItem value="frequent">Frequent</SelectItem>
                  <SelectItem value="not_frequent">Not frequent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Gender</Label>
              <Select
                value={form.gender || NONE}
                onValueChange={(v) => setForm({ ...form, gender: v === NONE ? "" : (v as "Male" | "Female") })}
                disabled={opOnly}
              >
                <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Age</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={150}
                value={form.age}
                onChange={e => setForm({ ...form, age: e.target.value.replace(/[^\d]/g, "") })}
                disabled={opOnly}
              />
            </div>
            <div>
              <Label>Total cost</Label>
              <Input
                inputMode="numeric"
                placeholder="e.g., 200,000"
                value={form.total_cost}
                onChange={e => setForm({ ...form, total_cost: formatMoney(e.target.value) })}
                disabled={opOnly}
              />
            </div>
            <div>
              <Label>Amount paid</Label>
              <Input
                inputMode="numeric"
                placeholder="e.g., 50,000"
                value={form.amount_paid}
                onChange={e => setForm({ ...form, amount_paid: formatMoney(e.target.value) })}
                disabled={opOnly}
              />
            </div>
            <div className="sm:col-span-2">
              {(() => {
                const total = moneyToNumber(form.total_cost);
                const paid = moneyToNumber(form.amount_paid);
                const balance = total - paid;
                const negative = balance < 0;
                return (
                  <div className="flex items-center justify-between rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Balance</span>
                    <span className={`font-semibold tabular-nums ${negative ? "text-destructive" : "text-foreground"}`}>
                      {balance.toLocaleString("en-US")}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving} className="bg-gradient-primary">
              {saving ? "Saving..." : isEdit ? "Save changes" : "Add patient"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
