import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { HeartPulse, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type State =
  | { kind: "loading" }
  | { kind: "valid" }
  | { kind: "already" }
  | { kind: "invalid"; message: string }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

export default function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ kind: "invalid", message: "Missing unsubscribe token." });
      return;
    }
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    fetch(
      `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
      { headers: { apikey: supabaseKey } }
    )
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          setState({ kind: "invalid", message: data?.error ?? "Invalid or expired link." });
          return;
        }
        if (data?.valid === false && data?.reason === "already_unsubscribed") {
          setState({ kind: "already" });
          return;
        }
        if (data?.valid === true) {
          setState({ kind: "valid" });
          return;
        }
        setState({ kind: "invalid", message: "Invalid or expired link." });
      })
      .catch(() => setState({ kind: "invalid", message: "Network error. Please try again." }));
  }, [token]);

  const confirm = async () => {
    if (!token) return;
    setState({ kind: "submitting" });
    const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", {
      body: { token },
    });
    if (error) {
      setState({ kind: "error", message: error.message ?? "Something went wrong." });
      return;
    }
    if (data?.success) {
      setState({ kind: "success" });
      return;
    }
    if (data?.reason === "already_unsubscribed") {
      setState({ kind: "already" });
      return;
    }
    setState({ kind: "error", message: "Could not process unsubscribe." });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-soft">
      <div className="w-full max-w-md">
        <Link to="/" className="flex flex-col items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
            <HeartPulse className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-2xl text-center">Criterion Wellness Home</span>
        </Link>

        <Card className="p-8 shadow-elegant border-border/60 text-center">
          {state.kind === "loading" && (
            <>
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-4">Checking your link…</p>
            </>
          )}

          {state.kind === "valid" && (
            <>
              <h1 className="font-display text-xl font-semibold mb-2">Unsubscribe from emails?</h1>
              <p className="text-sm text-muted-foreground mb-6">
                You'll no longer receive app notifications from Criterion Wellness Home at this address.
              </p>
              <Button onClick={confirm} size="lg" className="w-full bg-gradient-primary hover:opacity-90">
                Confirm unsubscribe
              </Button>
            </>
          )}

          {state.kind === "submitting" && (
            <>
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground mt-4">Processing…</p>
            </>
          )}

          {state.kind === "success" && (
            <>
              <CheckCircle2 className="w-10 h-10 mx-auto text-success" />
              <h1 className="font-display text-xl font-semibold mt-4 mb-2">You're unsubscribed</h1>
              <p className="text-sm text-muted-foreground">
                We won't send you any more emails at this address.
              </p>
            </>
          )}

          {state.kind === "already" && (
            <>
              <CheckCircle2 className="w-10 h-10 mx-auto text-success" />
              <h1 className="font-display text-xl font-semibold mt-4 mb-2">Already unsubscribed</h1>
              <p className="text-sm text-muted-foreground">
                This email address has already been removed from our list.
              </p>
            </>
          )}

          {(state.kind === "invalid" || state.kind === "error") && (
            <>
              <AlertCircle className="w-10 h-10 mx-auto text-destructive" />
              <h1 className="font-display text-xl font-semibold mt-4 mb-2">Something went wrong</h1>
              <p className="text-sm text-muted-foreground">{state.message}</p>
            </>
          )}

          <Link to="/" className="inline-block mt-6 text-sm text-primary hover:underline">
            ← Back to Criterion Wellness Home
          </Link>
        </Card>
      </div>
    </div>
  );
}
