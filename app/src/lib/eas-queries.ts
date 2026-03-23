/**
 * EAS (Ethereum Attestation Service) GraphQL queries.
 *
 * Fetches SYNDICATE_JOIN_REQUEST, AGENT_APPROVED, VENICE_INFERENCE,
 * TRADE_EXECUTED, and X402_RESEARCH attestations for a given syndicate.
 */

import { decodeAbiParameters, type Address } from "viem";
import { getAddresses } from "./contracts";

// ── Types ──────────────────────────────────────────────────

export type AttestationType =
  | "JOIN_REQUEST"
  | "APPROVED"
  | "VENICE_INFERENCE"
  | "TRADE_EXECUTED"
  | "RESEARCH";

export interface AttestationItem {
  uid: string;
  type: AttestationType;
  attester: Address;
  recipient: Address;
  time: number; // unix seconds
  txid: string;
  revoked: boolean;
  // Decoded data — governance attestations
  syndicateId?: bigint;
  agentId?: bigint;
  vault?: Address;
  message?: string; // only for JOIN_REQUEST
  // Decoded data — agent activity attestations
  model?: string; // VENICE_INFERENCE
  promptTokens?: number; // VENICE_INFERENCE
  completionTokens?: number; // VENICE_INFERENCE
  tokenIn?: Address; // TRADE_EXECUTED
  tokenOut?: Address; // TRADE_EXECUTED
  amountIn?: bigint; // TRADE_EXECUTED
  amountOut?: string; // TRADE_EXECUTED
  routing?: string; // TRADE_EXECUTED
  provider?: string; // RESEARCH
  queryType?: string; // RESEARCH
  prompt?: string; // RESEARCH
  resultUri?: string; // RESEARCH
}

// ── GraphQL ────────────────────────────────────────────────

interface RawAttestation {
  id: string;
  attester: string;
  recipient: string;
  time: number;
  data: string;
  txid: string;
  revoked: boolean;
}

const ATTESTATION_FIELDS = `
  id
  attester
  recipient
  time
  data
  txid
  revoked
`;

export async function fetchSyndicateAttestations(
  creator: Address,
  syndicateId: bigint,
  chainId?: number,
  vault?: Address,
): Promise<AttestationItem[]> {
  const addresses = getAddresses(chainId);

  // Graceful degradation: no EAS on this chain
  if (!addresses.easExplorer) return [];

  const url = `${addresses.easExplorer}/graphql`;

  // Build query — governance attestations keyed by creator, agent activity by vault recipient
  const hasActivitySchemas =
    addresses.easSchemas.veniceInference !== "0x0000000000000000000000000000000000000000000000000000000000000000";

  const query = `
    query SyndicateAttestations(
      $joinSchema: String!,
      $approveSchema: String!,
      $creator: String!
      ${hasActivitySchemas && vault ? ", $veniceSchema: String!, $tradeSchema: String!, $researchSchema: String!, $vault: String!" : ""}
    ) {
      joinRequests: attestations(
        where: {
          schemaId: { equals: $joinSchema }
          recipient: { equals: $creator }
        }
        orderBy: [{ time: desc }]
        take: 50
      ) { ${ATTESTATION_FIELDS} }
      approvals: attestations(
        where: {
          schemaId: { equals: $approveSchema }
          attester: { equals: $creator }
        }
        orderBy: [{ time: desc }]
        take: 50
      ) { ${ATTESTATION_FIELDS} }
      ${hasActivitySchemas && vault ? `
      veniceInferences: attestations(
        where: {
          schemaId: { equals: $veniceSchema }
          recipient: { equals: $vault }
        }
        orderBy: [{ time: desc }]
        take: 50
      ) { ${ATTESTATION_FIELDS} }
      trades: attestations(
        where: {
          schemaId: { equals: $tradeSchema }
          recipient: { equals: $vault }
        }
        orderBy: [{ time: desc }]
        take: 50
      ) { ${ATTESTATION_FIELDS} }
      research: attestations(
        where: {
          schemaId: { equals: $researchSchema }
          recipient: { equals: $vault }
        }
        orderBy: [{ time: desc }]
        take: 50
      ) { ${ATTESTATION_FIELDS} }
      ` : ""}
    }
  `;

  const variables: Record<string, string> = {
    joinSchema: addresses.easSchemas.joinRequest,
    approveSchema: addresses.easSchemas.agentApproved,
    creator: creator, // EAS GraphQL is case-sensitive — use checksummed address
  };

  if (hasActivitySchemas && vault) {
    variables.veniceSchema = addresses.easSchemas.veniceInference;
    variables.tradeSchema = addresses.easSchemas.tradeExecuted;
    variables.researchSchema = addresses.easSchemas.x402Research;
    variables.vault = vault;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      next: { revalidate: 60 },
    });

    if (!response.ok) return [];

    const result = await response.json();
    const joinRequests: RawAttestation[] =
      result?.data?.joinRequests || [];
    const approvals: RawAttestation[] =
      result?.data?.approvals || [];
    const veniceInferences: RawAttestation[] =
      result?.data?.veniceInferences || [];
    const trades: RawAttestation[] =
      result?.data?.trades || [];
    const researchItems: RawAttestation[] =
      result?.data?.research || [];

    const items: AttestationItem[] = [];

    // Decode join requests
    for (const raw of joinRequests) {
      const decoded = decodeJoinRequest(raw.data);
      if (!decoded || decoded.syndicateId !== syndicateId) continue;

      items.push({
        uid: raw.id,
        type: "JOIN_REQUEST",
        attester: raw.attester as Address,
        recipient: raw.recipient as Address,
        time: raw.time,
        txid: raw.txid,
        revoked: raw.revoked,
        syndicateId: decoded.syndicateId,
        agentId: decoded.agentId,
        vault: decoded.vault,
        message: decoded.message,
      });
    }

    // Decode approvals
    for (const raw of approvals) {
      const decoded = decodeApproval(raw.data);
      if (!decoded || decoded.syndicateId !== syndicateId) continue;

      items.push({
        uid: raw.id,
        type: "APPROVED",
        attester: raw.attester as Address,
        recipient: raw.recipient as Address,
        time: raw.time,
        txid: raw.txid,
        revoked: raw.revoked,
        syndicateId: decoded.syndicateId,
        agentId: decoded.agentId,
        vault: decoded.vault,
      });
    }

    // Decode Venice inference attestations
    for (const raw of veniceInferences) {
      const decoded = decodeVeniceInference(raw.data);
      if (!decoded) continue;

      items.push({
        uid: raw.id,
        type: "VENICE_INFERENCE",
        attester: raw.attester as Address,
        recipient: raw.recipient as Address,
        time: raw.time,
        txid: raw.txid,
        revoked: raw.revoked,
        model: decoded.model,
        promptTokens: decoded.promptTokens,
        completionTokens: decoded.completionTokens,
      });
    }

    // Decode trade attestations
    for (const raw of trades) {
      const decoded = decodeTrade(raw.data);
      if (!decoded) continue;

      items.push({
        uid: raw.id,
        type: "TRADE_EXECUTED",
        attester: raw.attester as Address,
        recipient: raw.recipient as Address,
        time: raw.time,
        txid: raw.txid,
        revoked: raw.revoked,
        tokenIn: decoded.tokenIn,
        tokenOut: decoded.tokenOut,
        amountIn: decoded.amountIn,
        amountOut: decoded.amountOut,
        routing: decoded.routing,
      });
    }

    // Decode research attestations
    for (const raw of researchItems) {
      const decoded = decodeResearch(raw.data);
      if (!decoded) continue;

      items.push({
        uid: raw.id,
        type: "RESEARCH",
        attester: raw.attester as Address,
        recipient: raw.recipient as Address,
        time: raw.time,
        txid: raw.txid,
        revoked: raw.revoked,
        provider: decoded.provider,
        queryType: decoded.queryType,
        prompt: decoded.prompt,
        resultUri: decoded.resultUri,
      });
    }

    // Sort chronologically (newest first)
    items.sort((a, b) => b.time - a.time);

    return items;
  } catch {
    return [];
  }
}

// ── ABI decode helpers ─────────────────────────────────────

function decodeJoinRequest(
  data: string,
): {
  syndicateId: bigint;
  agentId: bigint;
  vault: Address;
  message: string;
} | null {
  try {
    const [syndicateId, agentId, vault, message] = decodeAbiParameters(
      [
        { name: "syndicateId", type: "uint256" },
        { name: "agentId", type: "uint256" },
        { name: "vault", type: "address" },
        { name: "message", type: "string" },
      ],
      data as `0x${string}`,
    );
    return { syndicateId, agentId, vault, message };
  } catch {
    return null;
  }
}

function decodeApproval(
  data: string,
): {
  syndicateId: bigint;
  agentId: bigint;
  vault: Address;
} | null {
  try {
    const [syndicateId, agentId, vault] = decodeAbiParameters(
      [
        { name: "syndicateId", type: "uint256" },
        { name: "agentId", type: "uint256" },
        { name: "vault", type: "address" },
      ],
      data as `0x${string}`,
    );
    return { syndicateId, agentId, vault };
  } catch {
    return null;
  }
}

function decodeVeniceInference(
  data: string,
): {
  model: string;
  promptTokens: number;
  completionTokens: number;
} | null {
  try {
    const [model, promptTokens, completionTokens] = decodeAbiParameters(
      [
        { name: "model", type: "string" },
        { name: "promptTokens", type: "uint256" },
        { name: "completionTokens", type: "uint256" },
        { name: "promptHash", type: "string" },
      ],
      data as `0x${string}`,
    );
    return {
      model,
      promptTokens: Number(promptTokens),
      completionTokens: Number(completionTokens),
    };
  } catch {
    return null;
  }
}

function decodeTrade(
  data: string,
): {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: string;
  routing: string;
} | null {
  try {
    const [tokenIn, tokenOut, amountIn, amountOut, , routing] =
      decodeAbiParameters(
        [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOut", type: "string" },
          { name: "txHash", type: "string" },
          { name: "routing", type: "string" },
        ],
        data as `0x${string}`,
      );
    return { tokenIn, tokenOut, amountIn, amountOut, routing };
  } catch {
    return null;
  }
}

function decodeResearch(
  data: string,
): {
  provider: string;
  queryType: string;
  prompt: string;
  resultUri: string;
} | null {
  try {
    const [provider, queryType, prompt, , resultUri] = decodeAbiParameters(
      [
        { name: "provider", type: "string" },
        { name: "queryType", type: "string" },
        { name: "prompt", type: "string" },
        { name: "costUsdc", type: "string" },
        { name: "resultUri", type: "string" },
      ],
      data as `0x${string}`,
    );
    return { provider, queryType, prompt, resultUri };
  } catch {
    return null;
  }
}
