import BottomNav from "@/components/layout/bottom-nav";
import { AuthGuard } from "@/components/auth/AuthGuard";

export default function ShareLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <main className="pb-20 md:pb-0">{children}</main>
      <BottomNav />
    </AuthGuard>
  );
}
