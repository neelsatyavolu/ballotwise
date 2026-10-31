import { ZoneRoot } from "@/components/midterms/ZoneRoot";
import { DeskProvider } from "@/components/midterms/desk";
import { currentUser } from "@/lib/auth/session";
import { hasDdhqSession } from "@/lib/ddhq/vault";
import { db } from "@/lib/env";

/** Every tracker screen shows its times in the viewer's own zone. */
export default async function MidtermsLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const owner = user && await hasDdhqSession(db(), user.id) ? user.id : null;
  return <DeskProvider owner={owner}><ZoneRoot>{children}</ZoneRoot></DeskProvider>;
}
