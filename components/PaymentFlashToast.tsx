"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

export function PaymentFlashToast({ success }: { success?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shownRef = useRef(false);

  useEffect(() => {
    if (!success || shownRef.current) return;
    shownRef.current = true;
    if (success === "payment_saved") toast.success("Payment recorded.");
    if (success === "waiver_saved") toast.success("Waiver recorded.");
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("success");
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router, searchParams, success]);

  return null;
}
