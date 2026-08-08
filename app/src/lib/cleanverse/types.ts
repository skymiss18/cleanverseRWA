export type CleanverseEnvelope<T> = {
  code: string;
  message: string;
  data: T | null;
};

export type CleanverseRequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  encrypted?: boolean;
  requestId?: string;
  signal?: AbortSignal;
};

export type CleanverseClientConfig = {
  baseUrl: string;
  apiId: string;
  apiKey: string;
  timeoutMs: number;
};

export type CleanverseRule = {
  allowed_group: string;
  allowed_sub_group: string;
  min_tier: number;
  min_sub_tier: number;
  is_black_list?: boolean;
  countries?: string[];
};

export type ATokenApplyStatus =
  | "PENDING"
  | "APPROVED"
  | "ISSUING"
  | "ISSUED"
  | "REJECTED"
  | "ISSUE_FAILED";

export type LaunchATokenRequest = {
  chain: string;
  token_name: string;
  token_symbol: string;
  decimals: number;
  admin_address: string;
  rule: CleanverseRule;
  icon: string;
  callback_url?: string;
};

export type LaunchATokenResult = {
  requestId: string;
  issueAssetId: number;
};

export type ATokenApplyStatusResult = {
  flowType: "LAUNCH" | "LAUNCH_WRAPPED" | "REGISTER_WRAPPED" | "REGISTER_ATOKEN";
  requestId: string;
  applyStatus: ATokenApplyStatus;
  rejectReason?: string;
  issueErrorMsg?: string;
  chain: string;
  atokenAddress?: string;
  originTokenAddress?: string;
  tokenSymbol?: string;
  txHash?: string;
  issuedAt?: string;
  callbackUrl?: string;
  callbackStatus?: "PENDING" | "SUCCESS" | "FAILED";
  callbackAttempts?: number;
  callbackLastError?: string;
};

export type ATokenApplicationRecord = {
  issuanceId: string;
  assetName: string;
  assetType?: "Bond" | "GreenBond" | "REIT" | "TradeReceivable";
  requestId: string;
  issueAssetId: number;
  chain: string;
  tokenSymbol: string;
  adminAddress: string;
  rule: CleanverseRule;
  applyStatus: ATokenApplyStatus;
  subscriptionOpen: boolean;
  atokenAddress?: string;
  txHash?: string;
  rejectReason?: string;
  issueErrorMsg?: string;
  submittedAt: string;
  lastSyncedAt: string;
};

export type GenerateAPassRequest = {
  customerId: string;
  kycSource?: string;
  kycId?: string;
  subTier?: number;
  subGroup?: string;
  override?: boolean;
  expirationTime: number;
  wallet: {
    address: string;
    chain: string;
  };
  identityDataList?: Array<{
    idType: "ID_CARD" | "PASSPORT" | "DRIVER_LICENSE" | "HK_MACAO_TAIWAN_PASS" | "RESIDENCE_PERMIT";
    fullName: string;
    idNumber?: string;
    validUntil?: string;
    issuingCountryISO2: string;
  }>;
};

export type GenerateAPassResult = {
  customerId: string;
  cvRecordId: string;
  tier: string;
  wallet: {
    operate: string;
    address: string;
    chain: string;
    txHash?: string;
    depositUSDCWallet?: string;
    depositUSDTWallet?: string;
  };
};

export type QueryAPassResult = {
  cvRecordId: string;
  subTier: number;
  tier: string;
  status: 1 | 2;
  expirationTime: number;
  subGroup?: string;
  currentKycHash?: string;
  group?: string;
  countries: string[];
};

export type VerifyAPassResult = {
  chain: string;
  atoken: string;
  address: string;
  code: 1 | 2 | 3 | 4;
  message: string;
  magickLink?: string;
};

export type EligibilityReasonCode =
  | "CVA_NOT_FOUND"
  | "CVA_NOT_ISSUED"
  | "CVA_ADDRESS_MISSING"
  | "CVI_NOT_FOUND"
  | "CVI_FROZEN"
  | "CVI_EXPIRED"
  | "CVI_RULE_REJECTED"
  | "PROVIDER_ERROR";

export type CleanverseEligibilityDecision = {
  eligible: boolean;
  checkedAt: string;
  issuanceId: string;
  chain: string;
  walletAddress: string;
  atokenAddress?: string;
  apass?: {
    cvRecordId: string;
    status: 1 | 2;
    expirationTime: number;
    tier: string;
    subTier: number;
    countries: string[];
  };
  verification?: VerifyAPassResult;
  reasons: Array<{ code: EligibilityReasonCode; message: string }>;
};

export function isTerminalATokenStatus(status: ATokenApplyStatus) {
  return status === "ISSUED" || status === "REJECTED" || status === "ISSUE_FAILED";
}