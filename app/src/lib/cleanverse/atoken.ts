import type { CleanverseClient } from "./client";
import type {
  ATokenApplyStatusResult,
  CleanverseEnvelope,
  LaunchATokenRequest,
  LaunchATokenResult,
} from "./types";

type CleanverseRequester = Pick<CleanverseClient, "request">;

export async function launchAToken(
  client: CleanverseRequester,
  request: LaunchATokenRequest,
): Promise<CleanverseEnvelope<LaunchATokenResult>> {
  return client.request<LaunchATokenResult>("atoken/launch", {
    method: "POST",
    body: request,
    encrypted: true,
  });
}

export async function queryATokenApplyStatus(
  client: CleanverseRequester,
  requestId: string,
): Promise<ATokenApplyStatusResult> {
  const normalized = requestId.trim();
  if (!/^[A-Za-z0-9_-]{6,100}$/.test(normalized)) {
    throw new Error("Invalid Cleanverse A-Token requestId");
  }

  const response = await client.request<ATokenApplyStatusResult>(
    `atoken/query_apply_status/${encodeURIComponent(normalized)}`,
    { method: "GET" },
  );
  if (!response.data || typeof response.data !== "object") {
    throw new Error("Cleanverse returned no A-Token application data");
  }
  return response.data;
}