import { CleanverseBusinessError } from "./errors";
import type { CleanverseClient } from "./client";
import type {
  CleanverseEnvelope,
  GenerateAPassRequest,
  GenerateAPassResult,
  QueryAPassResult,
  VerifyAPassResult,
} from "./types";

type CleanverseRequester = Pick<CleanverseClient, "request">;

export class APassOverwriteConfirmationRequired extends Error {
  constructor(readonly providerMessage: string) {
    super("Cleanverse requires confirmation before overwriting the existing A-Pass");
    this.name = "APassOverwriteConfirmationRequired";
  }
}

export async function generateAPass(
  client: CleanverseRequester,
  request: GenerateAPassRequest,
): Promise<CleanverseEnvelope<GenerateAPassResult>> {
  try {
    return await client.request<GenerateAPassResult>("generate_apass", {
      method: "POST",
      body: request,
      encrypted: true,
    });
  } catch (error) {
    if (error instanceof CleanverseBusinessError && error.code === "1000") {
      throw new APassOverwriteConfirmationRequired(error.message);
    }
    throw error;
  }
}

export async function queryAPass(
  client: CleanverseRequester,
  input: { chain: string; address: string },
) {
  const response = await client.request<QueryAPassResult>("query_apass", {
    method: "POST",
    body: input,
  });
  if (!response.data || typeof response.data !== "object") {
    throw new Error("Cleanverse returned no A-Pass data");
  }
  return response.data;
}

export async function verifyAPass(
  client: CleanverseRequester,
  input: { chain: string; atoken: string; address: string },
) {
  const response = await client.request<VerifyAPassResult>("verify_apass", {
    method: "POST",
    body: input,
  });
  if (!response.data || typeof response.data !== "object") {
    throw new Error("Cleanverse returned no A-Pass verification data");
  }
  return response.data;
}