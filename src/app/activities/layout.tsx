import Footer from "@/components/layout/footer";
import Header from "@/components/layout/header";
import BottomNav from "@/components/layout/bottom-nav";
import { AuthGuard } from "@/components/auth/AuthGuard";

export default function ActivitiesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <Header />
      <main className="pb-20 md:pb-0">{children}</main>
      <div className="hidden md:block"><Footer /></div>
      <BottomNav />
    </AuthGuard>
  );
}
