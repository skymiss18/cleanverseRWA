"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { RoleId } from "./roles";

interface RoleContextValue {
  selectedRole: RoleId | null;
  setRole: (roleId: RoleId) => void;
  clearRole: () => void;
  isLoading: boolean;
}

const RoleContext = createContext<RoleContextValue>({
  selectedRole: null,
  setRole: () => {},
  clearRole: () => {},
  isLoading: true,
});

const STORAGE_KEY = "nexusrwa_selected_role";

export function RoleProvider({ children }: { children: ReactNode }) {
  const [selectedRole, setSelectedRole] = useState<RoleId | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load role from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && ["issuer", "intermediary", "regulator", "investor"].includes(stored)) {
        setSelectedRole(stored as RoleId);
      }
    } catch (error) {
      console.error("Failed to load role from localStorage:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setRole = (roleId: RoleId) => {
    setSelectedRole(roleId);
    try {
      localStorage.setItem(STORAGE_KEY, roleId);
    } catch (error) {
      console.error("Failed to save role to localStorage:", error);
    }
  };

  const clearRole = () => {
    setSelectedRole(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error("Failed to remove role from localStorage:", error);
    }
  };

  return (
    <RoleContext.Provider value={{ selectedRole, setRole, clearRole, isLoading }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
