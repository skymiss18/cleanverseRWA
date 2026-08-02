"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRole } from "@/lib/role-context";

interface RoleGuardProps {
  children: React.ReactNode;
}

const PUBLIC_ROUTES = ["/", "/login"];

export function RoleGuard({ children }: RoleGuardProps) {
  const { selectedRole, isLoading } = useRole();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Wait until role is loaded from localStorage
    if (isLoading) return;

    // Allow public routes without role selection
    if (PUBLIC_ROUTES.includes(pathname)) return;

    // Redirect to login if no role selected
    if (!selectedRole) {
      router.push("/login");
    }
  }, [selectedRole, isLoading, pathname, router]);

  // Show nothing while loading to prevent flash of protected content
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-800 rounded-full animate-spin mx-auto mb-3" />
          <div className="text-sm text-slate-600">Loading...</div>
        </div>
      </div>
    );
  }

  // Don't render protected content if no role and not on public route
  if (!selectedRole && !PUBLIC_ROUTES.includes(pathname)) {
    return null;
  }

  return <>{children}</>;
}
