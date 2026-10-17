import type { Metadata } from "next";
import { DeleteAccount } from "@/components/DeleteAccount";

export const metadata: Metadata = { title: "Your account" };

export default function AccountPage() {
  return <DeleteAccount />;
}
