import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import {
  getWallet,
  getKeypair,
  isWalletConfigured,
  type WalletData,
} from "./wallet.js";
import {
  createTransaction,
  approveTransaction,
  waitForTransaction,
  signMessageForProxy,
  refreshInit,
  refreshToken,
  type CrossmintApiConfig,
} from "./api.js";
import { type CrossmintPluginConfig } from "./config.js";

const BLOCKRUN_API = "https://sol.blockrun.ai/api/v1";

function getAgentId(ctx: OpenClawPluginToolContext): string {
  return ctx.agentId || "main";
}

function toServerConfig(config: CrossmintPluginConfig): CrossmintApiConfig {
  return {
    serverBaseUrl: config.serverBaseUrl,
    requestTimeoutMs: config.requestTimeoutMs,
  };
}

function toAuthenticatedConfig(
  config: CrossmintPluginConfig,
  accessToken: string
): CrossmintApiConfig {
  return {
    serverBaseUrl: config.serverBaseUrl,
    requestTimeoutMs: config.requestTimeoutMs,
    accessToken,
  };
}

function secondsNow(): number {
  return Math.floor(Date.now() / 1000);
}

function tokenMissingOrExpiring(walletData: WalletData): boolean {
  if (!walletData.accessToken || !walletData.accessTokenExpiresAt) {
    return true;
  }
  return walletData.accessTokenExpiresAt <= secondsNow() + 30;
}

async function signUtf8AsHex(agentId: string, utf8Message: string): Promise<string> {
  const keypair = getKeypair(agentId);
  if (!keypair) {
    throw new Error(`No signing keypair found for agent "${agentId}".`);
  }
  const messageBytes = new TextEncoder().encode(utf8Message);
  const nacl = (await import("tweetnacl")).default;
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
  return Buffer.from(signature).toString("hex");
}

async function refreshAgentTokens(
  agentId: string,
  walletData: WalletData,
  config: CrossmintPluginConfig
): Promise<WalletData> {
  if (!walletData.refreshToken) {
    throw new Error(`Wallet session missing refresh token. Run lobster_setup again.`);
  }
  const serverConfig = toServerConfig(config);
  const init = await refreshInit(serverConfig, {
    agentId,
    agentPubKey: walletData.address,
  });
  const refreshSignature = await signUtf8AsHex(agentId, init.refreshNonce);
  const { updateSessionTokens } = await import("./wallet.js");
  const refreshed = await refreshToken(serverConfig, {
    agentId,
    agentPubKey: walletData.address,
    nonceId: init.nonceId,
    refreshToken: walletData.refreshToken,
    refreshSignature,
  });
  return updateSessionTokens(
    agentId,
    refreshed.accessToken,
    refreshed.refreshToken,
    refreshed.expiresAt
  );
}

async function ensureAuthenticated(
  agentId: string,
  config: CrossmintPluginConfig
): Promise<{ walletData: WalletData; apiConfig: CrossmintApiConfig }> {
  const walletData = getWallet(agentId);
  if (!walletData) {
    throw new Error(`No wallet found. Run lobster_setup first.`);
  }
  if (!isWalletConfigured(agentId) || !walletData.walletAddress) {
    throw new Error(`Wallet not configured. Run lobster_setup and complete consent.`);
  }
  let readyWallet = walletData;
  if (tokenMissingOrExpiring(readyWallet)) {
    readyWallet = await refreshAgentTokens(agentId, readyWallet, config);
  }
  if (!readyWallet.accessToken) {
    throw new Error(`Wallet access token missing. Run lobster_setup again.`);
  }
  return {
    walletData: readyWallet,
    apiConfig: toAuthenticatedConfig(config, readyWallet.accessToken),
  };
}

interface X402PaymentOption {
  scheme: string;
  network: string;
  amount: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

interface X402PaymentRequired {
  x402Version: number;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepts: X402PaymentOption[];
  error?: string;
}

function parseX402Response(body: string): X402PaymentRequired {
  return JSON.parse(body) as X402PaymentRequired;
}

/**
 * Handle x402 payment using the lobster.cash wallet.
 * 1. Parse 402 payment requirements
 * 2. Send USDC via lobster wallet to the payTo address
 * 3. Wait for confirmation
 * 4. Build payment proof and retry the original request
 */
async function fetchWithX402(
  url: string,
  init: RequestInit,
  agentId: string,
  config: CrossmintPluginConfig
): Promise<Response> {
  // First attempt
  const res = await fetch(url, init);
  if (res.status !== 402) {
    return res;
  }

  // Parse x402 payment requirements
  const body = await res.text();
  const paymentRequired = parseX402Response(body);
  const option = paymentRequired.accepts?.[0];
  if (!option) {
    throw new Error("No payment options in 402 response");
  }

  const amountRaw = parseInt(option.amount, 10);
  // USDC on Solana has 6 decimals
  const amountUsdc = (amountRaw / 1_000_000).toString();

  // Pay using lobster wallet
  const { walletData, apiConfig } = await ensureAuthenticated(agentId, config);
  const keypair = getKeypair(agentId);
  if (!keypair) {
    throw new Error(`No signing keypair found for agent "${agentId}".`);
  }

  const tx = await createTransaction(apiConfig, walletData.walletAddress!, {
    type: "transfer",
    to: option.payTo,
    token: "usdc",
    amount: amountUsdc,
  });

  const signature = signMessageForProxy(
    keypair,
    tx.messageToSign,
    tx.messageToSignEncoding
  );

  await approveTransaction(apiConfig, walletData.walletAddress!, tx.id, signature);
  const confirmed = await waitForTransaction(apiConfig, walletData.walletAddress!, tx.id, 120000);

  if (confirmed.status !== "success") {
    throw new Error(`Payment ${confirmed.status}: tx ${tx.id}`);
  }

  // Build x402 payment proof
  const paymentProof = {
    x402Version: paymentRequired.x402Version || 2,
    resource: paymentRequired.resource || { url, mimeType: "application/json" },
    accepted: {
      scheme: option.scheme,
      network: option.network,
      amount: option.amount,
      asset: option.asset,
      payTo: option.payTo,
      maxTimeoutSeconds: option.maxTimeoutSeconds || 300,
    },
    payload: {
      signature: confirmed.hash,
      transactionId: tx.id,
    },
    extensions: {},
  };

  const paymentHeader = btoa(JSON.stringify(paymentProof));

  // Retry with payment proof
  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("payment-signature", paymentHeader);

  return fetch(url, { ...init, headers: retryHeaders });
}

export function createBlockRunModelsTool() {
  return {
    name: "blockrun_models",
    description: "List available AI models on BlockRun with pricing.",
    parameters: Type.Object({
      filter: Type.Optional(Type.String({ description: "Filter by keyword (e.g., 'openai', 'free', 'image')" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const res = await fetch(`${BLOCKRUN_API}/models`);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = await res.json();
        const filter = (params.filter as string)?.toLowerCase();
        let models = result.data ?? [];
        if (filter) {
          models = models.filter((m: any) =>
            m.id.toLowerCase().includes(filter) ||
            m.owned_by?.toLowerCase().includes(filter) ||
            m.billing_mode?.toLowerCase().includes(filter),
          );
        }
        const lines = models.map((m: any) => {
          const price = m.billing_mode === "free" ? "FREE" : m.pricing ? `$${m.pricing.input}/M in · $${m.pricing.output}/M out` : "paid";
          return `${m.id}  (${price})`;
        });
        return { content: [{ type: "text", text: `BlockRun Models (${models.length}):\n\n${lines.join("\n")}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Failed: ${(e as Error).message}` }] };
      }
    },
  };
}

export function createBlockRunChatTool(_api: OpenClawPluginApi, config: CrossmintPluginConfig) {
  return {
    name: "blockrun_chat",
    description: "Chat with an AI model via BlockRun. Supports GPT-5, Claude, Gemini, DeepSeek, and 40+ more. Payment handled automatically via lobster.cash wallet.",
    parameters: Type.Object({
      model: Type.String({ description: "Model ID (e.g., 'openai/gpt-5.2', 'deepseek/deepseek-chat')" }),
      message: Type.String({ description: "The message to send" }),
      systemPrompt: Type.Optional(Type.String({ description: "System prompt" })),
      maxTokens: Type.Optional(Type.Number({ description: "Max response tokens (default: 1024)" })),
      temperature: Type.Optional(Type.Number({ description: "Temperature 0-2 (default: 1)" })),
    }),
    async execute(_id: string, params: Record<string, unknown>, ctx: OpenClawPluginToolContext) {
      const agentId = getAgentId(ctx);
      const model = params.model as string;
      const message = params.message as string;
      if (!model || !message) return { content: [{ type: "text", text: "model and message are required." }] };
      try {
        const messages: any[] = [];
        if (params.systemPrompt) messages.push({ role: "system", content: params.systemPrompt });
        messages.push({ role: "user", content: message });

        const url = `${BLOCKRUN_API}/chat/completions`;
        const init: RequestInit = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, max_tokens: (params.maxTokens as number) || 1024, temperature: (params.temperature as number) ?? 1 }),
        };

        const res = await fetchWithX402(url, init, agentId, config);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = await res.json();
        const reply = result.choices?.[0]?.message?.content || "(empty)";
        const usage = result.usage;
        return { content: [{ type: "text", text: `**${result.model}**:\n\n${reply}${usage ? `\n\n_${usage.prompt_tokens} in / ${usage.completion_tokens} out_` : ""}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Chat failed: ${(e as Error).message}` }] };
      }
    },
  };
}

export function createBlockRunImageTool(_api: OpenClawPluginApi, config: CrossmintPluginConfig) {
  return {
    name: "blockrun_image",
    description: "Generate an image via BlockRun. Supports DALL-E 3, GPT Image 1, and Flux 1.1 Pro. Payment handled automatically via lobster.cash wallet.",
    parameters: Type.Object({
      prompt: Type.String({ description: "Image description" }),
      model: Type.Optional(Type.String({ description: "'openai/dall-e-3' (default), 'openai/gpt-image-1', or 'black-forest/flux-1.1-pro'" })),
      size: Type.Optional(Type.String({ description: "'1024x1024' (default), '1792x1024', or '1024x1792'" })),
      quality: Type.Optional(Type.String({ description: "'standard' (default) or 'hd'" })),
    }),
    async execute(_id: string, params: Record<string, unknown>, ctx: OpenClawPluginToolContext) {
      const agentId = getAgentId(ctx);
      const prompt = params.prompt as string;
      if (!prompt) return { content: [{ type: "text", text: "prompt is required." }] };
      const model = (params.model as string) || "openai/dall-e-3";
      try {
        const url = `${BLOCKRUN_API}/images/generations`;
        const init: RequestInit = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, size: (params.size as string) || "1024x1024", quality: (params.quality as string) || "standard", n: 1 }),
        };

        const res = await fetchWithX402(url, init, agentId, config);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = await res.json();
        const img = result.data?.[0];
        if (!img) return { content: [{ type: "text", text: "No image returned." }] };
        return { content: [{ type: "text", text: `Image generated with ${model}!\n\nURL: ${img.url}${img.revised_prompt ? `\n\nRevised prompt: ${img.revised_prompt}` : ""}` }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Image generation failed: ${(e as Error).message}` }] };
      }
    },
  };
}
