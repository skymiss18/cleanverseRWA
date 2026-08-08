"use client";

import { createContext, useContext } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";

interface WalletContextValue {
  wallet: string | null;
  connecting: boolean;
  isDemoWallet: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue>({
  wallet: null,
  connecting: false,
  isDemoWallet: false,
  connect: async () => {},
  disconnect: () => {},
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnecting } = useAccount();
  const { disconnect: wagmiDisconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();

  return (
    <WalletContext.Provider
      value={{
        wallet: address ?? null,
        connecting: isConnecting,
        isDemoWallet: false,
        connect: async () => openConnectModal?.(),
        disconnect: () => wagmiDisconnect(),
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
