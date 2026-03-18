import Header from "@/components/layout/header";
import BottomNav from "@/components/layout/bottom-nav";
import { AuthGuard } from "@/components/auth/AuthGuard";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <Header />
      <main className="pb-20 md:pb-0">{children}</main>
      <BottomNav />
    </AuthGuard>
  );
}
