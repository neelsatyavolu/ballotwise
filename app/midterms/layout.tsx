import { ZoneRoot } from "@/components/midterms/ZoneRoot";

/** Every tracker screen shows its times in the viewer's own zone. */
export default function MidtermsLayout({ children }: { children: React.ReactNode }) {
  return <ZoneRoot>{children}</ZoneRoot>;
}
