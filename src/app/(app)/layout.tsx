import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/layout/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  let branchName: string | null = null;
  if (user.branchId) {
    const b = await prisma.branch.findUnique({ where: { id: user.branchId }, select: { name: true, nameMy: true } });
    branchName = b ? b.nameMy || b.name : null;
  }
  return (
    <AppShell user={{ name: user.name, nameMy: user.nameMy, role: user.role, branchName }}>
      {children}
    </AppShell>
  );
}
