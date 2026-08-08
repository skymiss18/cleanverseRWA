"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRole } from "@/lib/role-context";
import type { RoleId } from "@/lib/roles";

interface RoleGuardProps {
  children: React.ReactNode;
}

const PUBLIC_ROUTES = ["/", "/login"];
const PUBLIC_ROUTE_PREFIXES = ["/badge"];

const ROLE_ROUTES: ReadonlyArray<{ path: string; role: RoleId }> = [
  { path: "/admin/subscriptions", role: "issuer" },
  { path: "/admin/coupons", role: "issuer" },
  { path: "/tokenize", role: "issuer" },
  { path: "/prospectus", role: "issuer" },
  { path: "/kyc", role: "investor" },
  { path: "/subscribe", role: "investor" },
  { path: "/portfolio", role: "investor" },
  { path: "/admin/kyc", role: "intermediary" },
  { path: "/compliance", role: "intermediary" },
  { path: "/evidence", role: "intermediary" },
  { path: "/audit", role: "intermediary" },
  { path: "/regulator", role: "regulator" },
];

function matchesRoute(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function RoleGuard({ children }: RoleGuardProps) {
  const { selectedRole, isLoading } = useRole();
  const pathname = usePathname();
  const router = useRouter();
  const isPublicRoute =
    PUBLIC_ROUTES.includes(pathname) ||
    PUBLIC_ROUTE_PREFIXES.some((route) => matchesRoute(pathname, route));
  const requiredRole = ROLE_ROUTES.find((route) => matchesRoute(pathname, route.path))?.role;
  const isUnauthorized = Boolean(selectedRole && requiredRole && selectedRole !== requiredRole);

  useEffect(() => {
    // Wait until role is loaded from localStorage
    if (isLoading) return;

    // Allow public routes without role selection
    if (isPublicRoute) return;

    // Redirect to login if no role selected
    if (!selectedRole) {
      router.replace("/login");
      return;
    }

    if (isUnauthorized) {
      router.replace("/login");
    }
  }, [selectedRole, isLoading, isPublicRoute, isUnauthorized, router]);

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
  if ((!selectedRole && !isPublicRoute) || isUnauthorized) {
    return null;
  }

  return <>{children}</>;
}
