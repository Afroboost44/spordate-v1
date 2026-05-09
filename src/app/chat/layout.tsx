import Header from "@/components/layout/header";
import BottomNav from "@/components/layout/bottom-nav";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { RechargeBanner } from "@/components/payment/RechargeBanner";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <Header />
      <RechargeBanner />
      <main className="pb-20 md:pb-0">{children}</main>
      <BottomNav />
    </AuthGuard>
  );
}
