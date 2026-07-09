// Silent, fire-and-forget engagement tracker.
// Failures are swallowed — must never interrupt user actions.
import { supabase } from "@/integrations/supabase/client";

export type EngagementAction = "whatsapp" | "call" | "completed" | "patient_added";

export function trackEngagement(
  clinicId: string | null | undefined,
  action: EngagementAction,
  patientId?: string | null,
): void {
  if (!clinicId) return;
  // Defer to a microtask so the UI action is never blocked.
  queueMicrotask(() => {
    try {
      void supabase
        .from("engagement_events")
        .insert({
          clinic_id: clinicId,
          patient_id: patientId ?? null,
          action_type: action,
        })
        .then(() => {}, () => {});
    } catch {
      // ignore
    }
  });
}
