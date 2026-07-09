import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Clinic, Patient, todayISO } from "@/lib/clinic";
import { toast } from "sonner";
import { Upload, AlertCircle } from "lucide-react";
import * as XLSX from "xlsx";

import { trackEngagement } from "@/lib/engagement";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clinic: Clinic;
  existingPatients: Patient[];
  onImported: () => void;
};

const ACCEPTED_FIELDS = [
  "name",
  "phone",
  "diagnosis",
  "treatment_duration",
  "next_follow_up_date",
  "status",
  "call_status",
  "usage_habit",
  "notes",
  "total_cost",
  "amount_paid",
] as const;

const ALIASES: Record<string, string> = {
  phone_number: "phone",
  full_name: "name",
  patient_name: "name",
  followup_date: "next_follow_up_date",
  follow_up_date: "next_follow_up_date",
};

const ALLOWED_STATUS = ["active", "inactive", "completed", "follow-up", "follow_up"] as const;
const ALLOWED_CALL = ["responded", "no_response", "no response", "pending"] as const;
const ALLOWED_USAGE = ["regular", "irregular", "stopped", "unknown"] as const;

// CSV parser
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { cur.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  cur.push(field);
  rows.push(cur);
  while (rows.length && rows[rows.length - 1].every(c => c.trim() === "")) rows.pop();
  return rows;
}

const cleanPhone = (raw: string): string => {
  const trimmed = String(raw ?? "").trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
};

const toNumber = (raw: any): number => {
  if (raw == null || raw === "") return 0;
  const s = String(raw).replace(/[^\d.\-]/g, "");
  if (!s) return 0;
  const n = Number(s);
  return isFinite(n) ? n : 0;
};

const normalizeHeader = (h: string): string => {
  const k = String(h ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return ALIASES[k] ?? k;
};

const normalizeDate = (raw: any): string | null => {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  // Try ISO / common formats
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
};

async function readFileAsRows(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) {
    const text = await file.text();
    return parseCsv(text);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: true, defval: "" });
    return rows.map(r => r.map(c => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? ""))));
  }
  throw new Error("Unsupported file type. Please upload a .csv or .xlsx file.");
}

export function ImportPatientsDialog({ open, onOpenChange, clinic, existingPatients, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setFile(null); setBusy(false); };

  const handleClose = (o: boolean) => {
    if (busy) return;
    if (!o) reset();
    onOpenChange(o);
  };

  const handleImport = async () => {
    if (!file) return;
    const ext = file.name.toLowerCase().split(".").pop();
    if (!["csv", "xlsx", "xls"].includes(ext || "")) {
      toast.error("Unsupported file type. Please upload a .csv or .xlsx file.");
      return;
    }
    setBusy(true);
    try {
      let rows: string[][] = [];
      try {
        rows = await readFileAsRows(file);
      } catch (e: any) {
        toast.error(e?.message || "Could not read file.");
        setBusy(false);
        return;
      }

      if (rows.length < 2) {
        toast.error("File is empty or has no data rows.");
        setBusy(false);
        return;
      }

      const headerRow = rows[0].map(normalizeHeader);
      const colIdx: Record<string, number> = {};
      headerRow.forEach((h, idx) => {
        if ((ACCEPTED_FIELDS as readonly string[]).includes(h) && colIdx[h] === undefined) {
          colIdx[h] = idx;
        }
      });

      if (colIdx.name === undefined || colIdx.phone === undefined) {
        toast.error("File must include 'name' and 'phone' columns.");
        setBusy(false);
        return;
      }

      const seenInFile = new Set<string>();
      const existingKeys = new Set(
        existingPatients.map(p => `${p.name.trim().toLowerCase()}|${cleanPhone(p.phone_number)}`)
      );

      const candidates: any[] = [];
      let skippedInvalid = 0;
      let skippedDuplicate = 0;

      const getCell = (row: string[], key: string): string => {
        const i = colIdx[key];
        if (i === undefined) return "";
        return String(row[i] ?? "").trim();
      };

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.every(c => String(c ?? "").trim() === "")) continue;
        const name = getCell(row, "name");
        const phone = cleanPhone(getCell(row, "phone"));
        if (!name || !phone) { skippedInvalid++; continue; }

        const key = `${name.toLowerCase()}|${phone}`;
        if (existingKeys.has(key) || seenInFile.has(key)) { skippedDuplicate++; continue; }
        seenInFile.add(key);

        const rec: any = {
          clinic_id: clinic.id,
          name,
          phone_number: phone,
          diagnosis: getCell(row, "diagnosis") || "Imported",
          treatment_duration: getCell(row, "treatment_duration") || "",
          notes: getCell(row, "notes") || null,
          total_cost: toNumber(getCell(row, "total_cost")),
          amount_paid: toNumber(getCell(row, "amount_paid")),
          next_follow_up_date: normalizeDate(getCell(row, "next_follow_up_date")) || todayISO(),
          assigned_to: null,
        };

        const status = getCell(row, "status").toLowerCase().replace(/\s+/g, "_");
        rec.status = ALLOWED_STATUS.includes(status as any) ? status.replace("follow_up", "follow-up") : "active";

        const callStatus = getCell(row, "call_status").toLowerCase().replace(/\s+/g, "_");
        if (callStatus && ALLOWED_CALL.includes(callStatus as any)) {
          rec.call_status = callStatus === "no_response" ? "no_response" : callStatus;
        }

        const usage = getCell(row, "usage_habit").toLowerCase();
        if (usage && ALLOWED_USAGE.includes(usage as any)) rec.usage_habit = usage;

        candidates.push(rec);
      }

      if (candidates.length === 0) {
        toast.error(`No valid rows to import. Skipped ${skippedInvalid} invalid, ${skippedDuplicate} duplicates.`);
        setBusy(false);
        return;
      }

      const { error } = await supabase.from("patients").insert(candidates);
      if (error) {
        console.error("Import insert error:", error);
        toast.error(`Import failed: ${error.message}`);
        setBusy(false);
        return;
      }
      for (let i = 0; i < candidates.length; i++) trackEngagement(clinic.id, "patient_added");

      toast.success(
        `${candidates.length} patient${candidates.length === 1 ? "" : "s"} imported successfully` +
        (skippedInvalid || skippedDuplicate ? ` · ${skippedInvalid + skippedDuplicate} rows skipped (${skippedInvalid} invalid, ${skippedDuplicate} duplicates)` : "")
      );
      reset();
      onOpenChange(false);
      onImported();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Could not process file.");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Import patients</DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel file with columns such as: <span className="font-medium">name, phone, diagnosis, treatment_duration, next_follow_up_date, status, call_status, usage_habit, notes, total_cost, amount_paid</span>.
          </DialogDescription>
          <p className="text-xs text-muted-foreground mt-1">
            Only <span className="font-medium">name</span> and <span className="font-medium">phone</span> are required. Unknown columns are ignored safely.
          </p>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={busy}
          />
          <div className="rounded-md bg-muted/40 border border-border/50 p-3 text-xs text-muted-foreground flex gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <div>Numbers like <span className="font-medium text-foreground">200,000</span> are accepted — commas are stripped automatically.</div>
              <div className="mt-1">Duplicates (same name + phone) are skipped. Rows missing name or phone are counted as invalid.</div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleImport} disabled={!file || busy} className="bg-gradient-primary shadow-glow">
            <Upload className="w-4 h-4 mr-1.5" />
            {busy ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
