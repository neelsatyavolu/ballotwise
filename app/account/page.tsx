import type { Metadata } from "next";
import { Suspense } from "react";
import { DeleteAccount } from "@/components/DeleteAccount";

export const metadata: Metadata = { title: "Your account" };

export default function AccountPage() {
  return (
    <Suspense>
      <DeleteAccount />
    </Suspense>
  );
}
