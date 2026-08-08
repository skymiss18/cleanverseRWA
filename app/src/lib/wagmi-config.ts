import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { mainnet, sepolia } from "viem/chains";
import { createConfig, http } from "wagmi";

const walletChainId = Number(process.env.NEXT_PUBLIC_WALLET_CHAIN_ID ?? sepolia.id);
export const targetChain = walletChainId === mainnet.id ? mainnet : sepolia;
export const targetChainId = targetChain.id;

const connectors = connectorsForWallets(
  [
    {
      groupName: "Browser Wallet",
      wallets: [
        injectedWallet,
      ],
    },
  ],
  {
    appName: "HarbourRWA",
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "disabled",
  },
);

export const wagmiConfig = createConfig({
  chains: [targetChain],
  connectors,
  transports: {
    [mainnet.id]: http(process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URL),
  },
  ssr: true,
});
