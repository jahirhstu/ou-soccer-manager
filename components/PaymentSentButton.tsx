"use client";

import { useActionState, useEffect, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { submitPaymentSentNotification } from "@/lib/actions/notifications";

export function PaymentSentButton({
  amount,
  compact = false,
  disabled = false,
  playerId,
  seasonId
}: {
  amount: string;
  compact?: boolean;
  disabled?: boolean;
  playerId: string;
  seasonId: string;
}) {
  const [state, action, pending] = useActionState(submitPaymentSentNotification, null as { success?: boolean; duplicate?: boolean; amount?: number; error?: string } | null);
  const [sent, setSent] = useState(disabled);

  useEffect(() => {
    if (state?.success) {
      setSent(true);
      toast.success(state.duplicate ? "Admins were already notified for this balance." : "Admins notified.");
    }
    if (state?.error) toast.error(state.error);
  }, [state]);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`Please confirm that you have sent ${amount} to jahirhstu2@gmail.com.`)) {
          event.preventDefault();
        }
      }}
    >
      <input name="playerId" type="hidden" value={playerId} />
      <input name="seasonId" type="hidden" value={seasonId} />
      <button className={`${compact ? "min-h-7 px-2 py-0.5 text-[11px]" : "min-h-9 w-full justify-center px-3 text-xs sm:w-auto"} btn-primary`} disabled={sent || pending} type="submit">
        <Send className="h-3.5 w-3.5" />
        {pending ? "Sending..." : sent ? "Payment sent" : "Payment sent"}
      </button>
    </form>
  );
}
