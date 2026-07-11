import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Patient, StaffMember } from "@/lib/clinic";
import { TopBar } from "@/components/TopBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Clock, User, Phone, FileText, Send, Activity, UserCog, UserCheck, Calendar, Pill } from "lucide-react";
import { isoToDisplay } from "@/lib/format";
import { BrandLoader } from "@/components/BrandLoader";
import { PatientFormDialog } from "@/components/PatientFormDialog";

interface Note {
  id: string;
  patient_id: string;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  author_email?: string;
  author_role?: string;
}

const formatNoteDate = (isoString: string) => {
  const d = new Date(isoString);
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; 
  const strTime = `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
  return `${day}/${month}/${year} ${strTime}`;
};

export default function PatientProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin, isClinic } = useAuth();
  
  const [patient, setPatient] = useState<Patient | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingNote, setSavingNote] = useState(false);

  const isStaff = !isAdmin && !isClinic;

  const loadData = async () => {
    if (!id || !user) return;
    setLoading(true);
    
    // Fetch patient
    const { data: pData } = await supabase
      .from("patients")
      .select("*")
      .eq("id", id)
      .single();
      
    if (pData) setPatient(pData as Patient);

    // Fetch staff for assignment display
    const { data: sData } = await supabase
      .from("user_roles")
      .select("*")
      .in("role", ["support", "admin", "clinic"]);
    if (sData) setStaff(sData as StaffMember[]);

    // Fetch notes
    const { data: nData } = await supabase
      .from("patient_notes")
      .select("*")
      .eq("patient_id", id)
      .order("created_at", { ascending: false });
      
    if (nData) setNotes(nData as Note[]);
    
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [id, user]);

  const saveNote = async () => {
    if (!newNote.trim() || !user || !id) return;
    setSavingNote(true);

    if (editingNoteId) {
      const { error } = await supabase
        .from("patient_notes")
        .update({ content: newNote.trim(), updated_at: new Date().toISOString() })
        .eq("id", editingNoteId);
        
      if (!error) {
        setNewNote("");
        setEditingNoteId(null);
        loadData();
      } else {
        alert("Failed to update note: " + error.message);
      }
    } else {
      const { error } = await supabase
        .from("patient_notes")
        .insert({
          patient_id: id,
          author_id: user.id,
          content: newNote.trim()
        });
        
      if (!error) {
        setNewNote("");
        loadData();
      } else {
        alert("Failed to add note: " + error.message);
      }
    }
    
    setSavingNote(false);
  };

  const cancelEdit = () => {
    setEditingNoteId(null);
    setNewNote("");
  };

  const startEdit = (note: Note) => {
    setEditingNoteId(note.id);
    setNewNote(note.content);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) return <BrandLoader message="Loading profile..." />;
  if (!patient) return (
    <div className="min-h-screen bg-background">
      <TopBar onHome={() => navigate("/dashboard")} title="Patient Profile" />
      <div className="p-8 text-center">Patient not found or access denied.</div>
    </div>
  );

  const getStaffName = (userId: string | null) => {
    if (!userId) return "Unassigned";
    const s = staff.find(x => x.user_id === userId);
    return s?.display_name || s?.email || "Unknown Staff";
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <TopBar onHome={() => navigate("/dashboard")} title="Patient Profile" />

      <main className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-2 -ml-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left Column: Patient Details */}
          <div className="md:col-span-1 space-y-6">
            <Card className="p-6 border-border/50 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-brand-500" />
              
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="text-2xl font-bold font-heading text-brand-900 tracking-tight">{patient.name}</h2>
                  <p className="text-sm font-bold text-emerald-600 mt-1">{patient.patient_number}</p>
                </div>
                <Badge variant={patient.status === 'active' ? 'default' : 'secondary'} className="capitalize">
                  {patient.status}
                </Badge>
              </div>

              <div className="space-y-4">
                <div className="flex items-center text-sm text-muted-foreground">
                  <Phone className="w-4 h-4 mr-3 text-brand-500 shrink-0" />
                  <span className="font-medium text-foreground">{patient.phone_number}</span>
                </div>
                
                <div className="flex items-start text-sm text-muted-foreground">
                  <Activity className="w-4 h-4 mr-3 mt-0.5 text-brand-500 shrink-0" />
                  <div>
                    <div className="font-medium text-foreground">Diagnosis</div>
                    <div className="mt-1 leading-relaxed whitespace-pre-wrap">{patient.diagnosis}</div>
                  </div>
                </div>

                <div className="flex items-center text-sm text-muted-foreground">
                  <Calendar className="w-4 h-4 mr-3 text-brand-500 shrink-0" />
                  <div>
                    <span className="font-medium text-foreground">Medication Due: </span>
                    {patient.medication_due_date ? isoToDisplay(patient.medication_due_date) : "Not Set"}
                  </div>
                </div>

                <div className="flex items-center text-sm text-muted-foreground">
                  <Pill className="w-4 h-4 mr-3 text-brand-500 shrink-0" />
                  <div>
                    <span className="font-medium text-foreground">Medication Status: </span>
                    <span className={patient.medication_renewal_status === 'due' ? 'text-red-600 font-bold capitalize' : 'text-emerald-600 font-bold capitalize'}>
                      {patient.medication_renewal_status || "active"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center text-sm text-muted-foreground">
                  <UserCog className="w-4 h-4 mr-3 text-brand-500 shrink-0" />
                  <div>
                    <span className="font-medium text-foreground">Assigned to: </span>
                    {getStaffName(patient.assigned_to)}
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-border/50 flex justify-end">
                <PatientFormDialog 
                  patient={patient} 
                  onSave={loadData}
                  trigger={
                    <Button variant="outline" className="w-full sm:w-auto">
                      Edit Details
                    </Button>
                  }
                />
              </div>
            </Card>

            <Card className="p-6 border-border/50 shadow-sm">
              <h3 className="font-heading font-semibold mb-4 text-brand-900">Treatment Info</h3>
              <div className="space-y-3 text-sm">
                <div><span className="text-muted-foreground">Duration:</span> <span className="font-medium">{patient.treatment_duration}</span></div>
                <div><span className="text-muted-foreground">Total Cost:</span> <span className="font-medium">₦{patient.total_cost.toLocaleString()}</span></div>
                <div><span className="text-muted-foreground">Amount Paid:</span> <span className="font-medium text-emerald-600">₦{patient.amount_paid.toLocaleString()}</span></div>
                {patient.treatment_notes && (
                  <div className="mt-4 pt-4 border-t border-border/50">
                    <span className="text-muted-foreground block mb-1">Notes:</span>
                    <div className="whitespace-pre-wrap">{patient.treatment_notes}</div>
                  </div>
                )}
              </div>
            </Card>
          </div>

          {/* Right Column: Timeline & Notes */}
          <div className="md:col-span-2 space-y-6">
            <Card className="p-6 border-border/50 shadow-sm">
              <h3 className="font-heading font-semibold mb-4 flex items-center text-brand-900">
                <FileText className="w-5 h-5 mr-2 text-brand-500" />
                {editingNoteId ? "Edit Clinical Note" : "Add Clinical Note"}
              </h3>
              <div className="space-y-3">
                <Textarea 
                  placeholder="Log a call, update treatment progress, or add clinical insights..."
                  className="min-h-[100px] resize-none border-border/60 focus:border-brand-500 focus:ring-brand-500/20"
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                />
                <div className="flex justify-end gap-2">
                  {editingNoteId && (
                    <Button variant="outline" onClick={cancelEdit} disabled={savingNote}>
                      Cancel
                    </Button>
                  )}
                  <Button 
                    onClick={saveNote} 
                    disabled={!newNote.trim() || savingNote} 
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {savingNote ? "Saving..." : (editingNoteId ? "Update Note" : "Save Note")}
                    {!editingNoteId && <Send className="w-4 h-4 ml-2" />}
                  </Button>
                </div>
              </div>
            </Card>

            <div className="space-y-4">
              <h3 className="font-heading font-semibold text-lg text-brand-900">Notes Timeline</h3>
              
              {notes.length === 0 ? (
                <div className="text-center p-8 bg-brand-50/50 rounded-xl border border-brand-100/50 text-muted-foreground">
                  No notes recorded yet.
                </div>
              ) : (
                <div className="relative space-y-6 before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent">
                  {notes.map((note) => (
                    <div key={note.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full border border-background bg-brand-100 text-brand-600 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                        <User className="w-5 h-5" />
                      </div>
                      <Card className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 border-border/50 shadow-sm hover:shadow-md transition-shadow relative">
                        {(user?.id === note.author_id || isAdmin) && (
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="absolute top-2 right-2 h-7 px-2 text-muted-foreground hover:text-brand-600"
                            onClick={() => startEdit(note)}
                          >
                            Edit
                          </Button>
                        )}
                        <div className="flex justify-between items-start mb-2 pr-10">
                          <span className="font-semibold text-sm text-brand-900">{getStaffName(note.author_id)}</span>
                          <div className="text-xs text-muted-foreground flex flex-col items-end gap-1">
                            <span className="flex items-center">
                              <Clock className="w-3 h-3 mr-1" />
                              {formatNoteDate(note.created_at)}
                            </span>
                            {note.updated_at && note.updated_at !== note.created_at && (
                              <span className="text-[10px] italic text-muted-foreground/80">
                                Edited: {formatNoteDate(note.updated_at)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                          {note.content}
                        </div>
                      </Card>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
