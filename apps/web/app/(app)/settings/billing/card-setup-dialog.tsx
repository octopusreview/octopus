"use client";

import { useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { IconLoader2 } from "@tabler/icons-react";
import { createCardSetupIntent, finalizeCardSetup } from "./actions";

/**
 * In-app card capture via Stripe's embedded Payment Element on a SetupIntent —
 * the card form renders inside our dialog (Stripe-hosted iframe, so card data
 * never touches our servers) and there is no redirect to Stripe.
 */
export function CardSetupDialog({
  open,
  onOpenChange,
  publishableKey,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publishableKey: string;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);

  useEffect(() => {
    if (!open) {
      setReady(false);
      setError(null);
      elementsRef.current = null;
      return;
    }

    let cancelled = false;
    (async () => {
      const res = await createCardSetupIntent();
      if (cancelled) return;
      if (res.error || !res.clientSecret) {
        setError(res.error ?? "Could not start card setup.");
        return;
      }
      const stripe = await loadStripe(publishableKey);
      if (cancelled) return;
      if (!stripe) {
        setError("Could not load the payment form.");
        return;
      }
      stripeRef.current = stripe;
      const elements = stripe.elements({
        clientSecret: res.clientSecret,
        appearance: { theme: "night", variables: { colorPrimary: "#22c55e" } },
      });
      elementsRef.current = elements;
      const paymentElement = elements.create("payment");
      if (mountRef.current) {
        paymentElement.mount(mountRef.current);
        paymentElement.on("ready", () => {
          if (!cancelled) setReady(true);
        });
      }
    })().catch((err) => {
      if (cancelled) return;
      console.error("[billing] card setup failed to initialize:", err);
      setError("Could not load the payment form. Please try again.");
    });

    return () => {
      cancelled = true;
    };
  }, [open, publishableKey]);

  const handleSave = async () => {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return;

    setSaving(true);
    setError(null);
    try {
      const { error: confirmError, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
      });
      if (confirmError) {
        setError(confirmError.message ?? "Card could not be saved.");
        return;
      }
      if (!setupIntent || setupIntent.status !== "succeeded") {
        setError("Card setup did not complete. Please try again.");
        return;
      }
      const res = await finalizeCardSetup(setupIntent.id);
      if (res.error) {
        setError(res.error);
        return;
      }
      onOpenChange(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add card</DialogTitle>
          <DialogDescription>
            Saved for subscriptions, top-ups, and auto-reload. Card details go
            directly to Stripe — they never touch our servers.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-24">
          <div ref={mountRef} />
          {!ready && !error && (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <IconLoader2 className="size-5 animate-spin" />
            </div>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!ready || saving}>
            {saving && <IconLoader2 className="size-4 mr-1 animate-spin" />}
            Save card
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
