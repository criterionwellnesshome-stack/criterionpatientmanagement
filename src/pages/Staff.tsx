import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BrandLoader } from "@/components/BrandLoader";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StaffMember, roleLabel, staffDisplayName } from "@/lib/clinic";
import { UserPlus, MoreVertical, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";

type StaffRow = StaffMember & { status: "invited" | "active" | "deactivated" };

export default function Staff() {
  const { user, loading, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(true);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "support">("support");
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StaffRow | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate("/auth");
    else if (!isAdmin) navigate("/dashboard");
  }, [user, loading, isAdmin, navigate]);

  const load = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("list_staff");
    if (error) {
      toast.error("Could not load staff");
    } else {
      setStaff((data ?? []) as StaffRow[]);
    }
    setBusy(false);
  };
  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  const sorted = useMemo(
    () => [...staff].sort((a, b) => staffDisplayName(a).localeCompare(staffDisplayName(b))),
    [staff]
  );

  const callManage = async (body: Record<string, unknown>, successMsg: string) => {
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("manage-staff", { body });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Action failed");
      return false;
    }
    toast.success(successMsg);
    await load();
    return true;
  };

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = inviteEmail.trim().toLowerCase();
    const fullName = inviteName.trim();
    if (!fullName) { toast.error("Full name required"); return; }
    if (!email) { toast.error("Email required"); return; }
    const ok = await callManage(
      {
        action: "invite",
        email,
        full_name: fullName,
        role: inviteRole,
        redirect_to: `${window.location.origin}/reset-password`,
      },
      "Invite sent",
    );
    if (ok) {
      setInviteEmail("");
      setInviteName("");
      setInviteRole("support");
      setInviteOpen(false);
    }
  };

  const changeRole = async (s: StaffRow, role: "admin" | "support") => {
    if (s.role === role) return;
    await callManage({ action: "update_role", user_id: s.user_id, role }, "Role updated");
  };

  const deactivate = async (s: StaffRow) => {
    await callManage({ action: "deactivate", user_id: s.user_id }, "User deactivated");
  };
  const reactivate = async (s: StaffRow) => {
    await callManage({ action: "reactivate", user_id: s.user_id }, "User reactivated");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("admin-delete-user", {
      body: { user_id: deleteTarget.user_id },
    });
    setSubmitting(false);
    if (error || (data as any)?.error) {
      toast.error((data as any)?.error || error?.message || "Delete failed");
    } else {
      toast.success("User deleted");
      setDeleteTarget(null);
      await load();
    }
  };

  if (loading || !isAdmin) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Checking access...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-soft">
      <TopBar showSettings />
      <main className="container py-6 sm:py-8 space-y-6 px-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h1 className="font-display text-xl sm:text-2xl font-bold">Staff</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={load} disabled={busy}>
              <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setInviteOpen(true)} className="bg-gradient-primary">
              <UserPlus className="w-4 h-4 mr-1.5" /> Invite Staff
            </Button>
          </div>
        </div>

        <Card className="overflow-hidden">
          {busy ? (
            <BrandLoader fullScreen={false} label="Loading staff..." />
          ) : sorted.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="mb-4">No staff yet.</p>
              <Button onClick={() => setInviteOpen(true)} className="bg-gradient-primary">
                <UserPlus className="w-4 h-4 mr-1.5" /> Invite Staff
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-muted/50 border-b border-border/60 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s) => {
                    const isSelf = s.user_id === user?.id;
                    const displayName = staffDisplayName(s);
                    return (
                      <tr key={s.user_id} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">
                          {displayName}
                          {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                          {!s.full_name && (
                            <span className="ml-2 text-xs text-muted-foreground">(no name)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{s.email}</td>
                        <td className="px-4 py-3">
                          <Select
                            value={s.role === "admin" ? "admin" : "support"}
                            onValueChange={(v) => changeRole(s, v as "admin" | "support")}
                            disabled={isSelf || submitting}
                          >
                            <SelectTrigger className="h-8 w-[170px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="support">Wellness Support</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`capitalize ${statusBadgeClass(s.status)}`}>
                            {s.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="sm" variant="ghost" disabled={isSelf}>
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {s.status === "deactivated" ? (
                                <DropdownMenuItem onClick={() => reactivate(s)}>
                                  Reactivate
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem onClick={() => deactivate(s)}>
                                  Deactivate
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(s)}
                                className="text-destructive focus:text-destructive"
                              >
                                Delete user
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <form onSubmit={submitInvite}>
            <DialogHeader>
              <DialogTitle>Invite staff</DialogTitle>
              <DialogDescription>
                We'll email a setup link so they can choose their password and sign in.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="invite-name">Full name</Label>
                <Input
                  id="invite-name"
                  type="text"
                  required
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Jane Doe"
                />
              </div>
              <div>
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="staff@example.com"
                />
              </div>
              <div>
                <Label htmlFor="invite-role">Role</Label>
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "admin" | "support")}>
                  <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="support">Wellness Support</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="bg-gradient-primary">
                {submitting ? "Sending..." : "Send invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <span className="font-medium">{deleteTarget ? staffDisplayName(deleteTarget) : ""}</span> ({deleteTarget?.email}).
              Their patient assignments will be cleared. Consider deactivating instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const statusBadgeClass = (status: StaffRow["status"]) => {
  switch (status) {
    case "active":
      return "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900";
    case "invited":
      return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900";
    case "deactivated":
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900";
  }
};
