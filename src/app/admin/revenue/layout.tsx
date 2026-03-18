import Header from "@/components/layout/header";
import { AuthGuard } from "@/components/auth/AuthGuard";

export default function RevenueLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <Header />
      <main>{children}</main>
    </AuthGuard>
  );
}
