import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk";
import {
  getWallet,
  getKeypair,
  isWalletConfigured,
  updateSessionTokens,
  type WalletData,
} from "./wallet.js";
import {
  createTransaction,
  approveTransaction,
  waitForTransaction,
  refreshInit,
  refreshToken,
  isAccessTokenExpiredError,
  signMessageForProxy,
  type CrossmintApiConfig,
  type ProxyTransactionMessageEncoding,
} from "./api.js";
import { type CrossmintPluginConfig } from "./config.js";

const BLOCKRUN_API =
  "https://blockrun-sol-staging-demo-1092497648280.us-central1.run.app/api/v1";
const USDC_DECIMALS = 6;

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
  if (!walletData.accessToken || !walletData.accessTokenExpiresAt) return true;
  return walletData.accessTokenExpiresAt <= secondsNow() + 30;
}

async function signUtf8AsHex(
  agentId: string,
  utf8Message: string
): Promise<string> {
  const keypair = getKeypair(agentId);
  if (!keypair)
    throw new Error(`No signing keypair found for agent "${agentId}".`);
  const messageBytes = new TextEncoder().encode(utf8Message);
  const nacl = (await import("tweetnacl")).default;
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
  return Buffer.from(signature).toString("hex");
}

function signProxyMessageForAgent(
  agentId: string,
  message: string,
  encoding: ProxyTransactionMessageEncoding
): string {
  const keypair = getKeypair(agentId);
  if (!keypair)
    throw new Error(`No signing keypair found for agent "${agentId}".`);
  return signMessageForProxy(keypair, message, encoding);
}

async function refreshAgentTokens(
  agentId: string,
  walletData: WalletData,
  config: CrossmintPluginConfig
): Promise<WalletData> {
  if (!walletData.refreshToken)
    throw new Error(
      `Wallet session missing refresh token for agent "${agentId}".`
    );
  const serverConfig = toServerConfig(config);
  const init = await refreshInit(serverConfig, {
    agentId,
    agentPubKey: walletData.address,
  });
  const refreshSignature = await signUtf8AsHex(agentId, init.refreshNonce);
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
  if (!walletData)
    throw new Error(
      `No wallet found for agent "${agentId}". Run lobster_setup first.`
    );
  if (!isWalletConfigured(agentId) || !walletData.walletAddress)
    throw new Error(
      `Wallet not configured for agent "${agentId}". Run lobster_setup first.`
    );
  let readyWallet = walletData;
  if (tokenMissingOrExpiring(readyWallet)) {
    readyWallet = await refreshAgentTokens(agentId, readyWallet, config);
  }
  if (!readyWallet.accessToken)
    throw new Error(
      `Wallet access token missing for agent "${agentId}". Run lobster_setup.`
    );
  return {
    walletData: readyWallet,
    apiConfig: toAuthenticatedConfig(config, readyWallet.accessToken),
  };
}

async function withAuthenticatedApi<T>(
  agentId: string,
  config: CrossmintPluginConfig,
  fn: (context: {
    walletData: WalletData;
    apiConfig: CrossmintApiConfig;
  }) => Promise<T>
): Promise<T> {
  const context = await ensureAuthenticated(agentId, config);
  try {
    return await fn(context);
  } catch (error) {
    if (!isAccessTokenExpiredError(error)) throw error;
    const refreshed = await refreshAgentTokens(
      agentId,
      context.walletData,
      config
    );
    if (!refreshed.accessToken)
      throw new Error("Token refresh succeeded but no access token.");
    return fn({
      walletData: refreshed,
      apiConfig: toAuthenticatedConfig(config, refreshed.accessToken),
    });
  }
}

// ── x402 types ──────────────────────────────────────────────

interface X402PaymentOption {
  scheme: string;
  network: string;
  amount: string;
  payTo: string;
  asset: string;
  maxTimeoutSeconds?: number;
  extra?: {
    feePayer?: string;
    features?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

interface X402PaymentRequired {
  x402Version: number;
  resource?: { url?: string; description?: string; contentType?: string };
  accepts: X402PaymentOption[];
}

// ── x402 payment via lobster.cash ───────────────────────────

/**
 * Send USDC payment via lobster.cash smart wallet and return the
 * on-chain transaction hash for x402 proof.
 */
async function payViaLobster(
  option: X402PaymentOption,
  agentId: string,
  config: CrossmintPluginConfig
): Promise<string> {
  const amountBaseUnits = BigInt(option.amount);
  const humanAmount = (
    Number(amountBaseUnits) / Math.pow(10, USDC_DECIMALS)
  ).toString();

  return withAuthenticatedApi(agentId, config, async ({ walletData, apiConfig }) => {
    const created = await createTransaction(
      apiConfig,
      walletData.walletAddress!,
      { type: "transfer", to: option.payTo, token: "usdc", amount: humanAmount }
    );

    const signature = signProxyMessageForAgent(
      agentId,
      created.messageToSign,
      created.messageToSignEncoding
    );

    let tx = await approveTransaction(
      apiConfig,
      walletData.walletAddress!,
      created.id,
      signature
    );

    tx = await waitForTransaction(
      apiConfig,
      walletData.walletAddress!,
      tx.id,
      60000
    );

    if (tx.status !== "success")
      throw new Error(`Payment transaction ${tx.status}: ${tx.id}`);
    if (!tx.hash)
      throw new Error("Payment succeeded but no transaction hash returned");

    return tx.hash;
  });
}

/**
 * Fetch with x402 payment handling.
 * On 402: pay via lobster.cash smart wallet, retry with payment proof.
 */
async function fetchWithX402(
  url: string,
  init: RequestInit,
  agentId: string,
  config: CrossmintPluginConfig
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status !== 402) return res;

  const body = await res.text();
  const paymentRequired: X402PaymentRequired = JSON.parse(body);
  const option = paymentRequired.accepts?.[0];
  if (!option) throw new Error("No payment options in 402 response");

  // Pay via lobster.cash smart wallet
  const txHash = await payViaLobster(option, agentId, config);

  // Fetch the confirmed transaction from Solana RPC so the facilitator
  // gets real serialized transaction bytes (not just a tx hash string).
  const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
  const rpcRes = await fetch(SOLANA_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTransaction",
      params: [
        txHash,
        { encoding: "base64", maxSupportedTransactionVersion: 0 },
      ],
    }),
  });
  const rpcResult = await rpcRes.json();
  const txBase64 = rpcResult.result?.transaction?.[0];
  if (!txBase64)
    throw new Error(
      "Could not fetch confirmed transaction from Solana RPC"
    );

  // Build x402 payment header. The standard @x402 library decodes this as
  // the paymentPayload sent to the facilitator, so network/scheme must be
  // top-level. "accepted" echoes the chosen accept entry for requirement matching.
  const x402Version = paymentRequired.x402Version || 2;
  const headerPayload = {
    x402Version,
    scheme: option.scheme,
    network: option.network,
    accepted: option,
    payload: {
      transaction: txBase64,
    },
  };
  const paymentHeader = btoa(JSON.stringify(headerPayload));

  // Retry with payment proof
  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("X-PAYMENT", paymentHeader);
  return fetch(url, { ...init, headers: retryHeaders });
}

// ── BlockRun tool factories ─────────────────────────────────

export function createBlockRunModelsTool() {
  return {
    name: "blockrun_models",
    description: "List available AI models on BlockRun with pricing.",
    parameters: Type.Object({
      filter: Type.Optional(
        Type.String({
          description:
            "Filter by keyword (e.g., 'openai', 'free', 'image')",
        })
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      try {
        const res = await fetch(`${BLOCKRUN_API}/models`);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = await res.json();
        const filter = (params.filter as string)?.toLowerCase();
        let models = result.data ?? [];
        if (filter) {
          models = models.filter(
            (m: any) =>
              m.id.toLowerCase().includes(filter) ||
              m.owned_by?.toLowerCase().includes(filter) ||
              m.billing_mode?.toLowerCase().includes(filter)
          );
        }
        const lines = models.map((m: any) => {
          const price =
            m.billing_mode === "free"
              ? "FREE"
              : m.pricing
                ? `$${m.pricing.input}/M in · $${m.pricing.output}/M out`
                : "paid";
          return `${m.id}  (${price})`;
        });
        return {
          content: [
            {
              type: "text",
              text: `BlockRun Models (${models.length}):\n\n${lines.join("\n")}`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Failed: ${(e as Error).message}` }],
        };
      }
    },
  };
}

export function createBlockRunChatTool(
  _api: OpenClawPluginApi,
  config: CrossmintPluginConfig
) {
  return {
    name: "blockrun_chat",
    description:
      "Chat with an AI model via BlockRun. Supports GPT-5, Claude, Gemini, DeepSeek, and 40+ more. Payment via lobster.cash wallet.",
    parameters: Type.Object({
      model: Type.String({
        description:
          "Model ID (e.g., 'openai/gpt-5.2', 'deepseek/deepseek-chat')",
      }),
      message: Type.String({ description: "The message to send" }),
      systemPrompt: Type.Optional(
        Type.String({ description: "System prompt" })
      ),
      maxTokens: Type.Optional(
        Type.Number({ description: "Max response tokens (default: 1024)" })
      ),
      temperature: Type.Optional(
        Type.Number({ description: "Temperature 0-2 (default: 1)" })
      ),
    }),
    async execute(
      _id: string,
      params: Record<string, unknown>,
      ctx: OpenClawPluginToolContext
    ) {
      const model = params.model as string;
      const message = params.message as string;
      const agentId = getAgentId(ctx);
      if (!model || !message)
        return {
          content: [{ type: "text", text: "model and message are required." }],
        };
      try {
        const messages: any[] = [];
        if (params.systemPrompt)
          messages.push({ role: "system", content: params.systemPrompt });
        messages.push({ role: "user", content: message });

        const res = await fetchWithX402(
          `${BLOCKRUN_API}/chat/completions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages,
              max_tokens: (params.maxTokens as number) || 1024,
              temperature: (params.temperature as number) ?? 1,
            }),
          },
          agentId,
          config
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = await res.json();
        const reply = result.choices?.[0]?.message?.content || "(empty)";
        const usage = result.usage;
        return {
          content: [
            {
              type: "text",
              text: `**${result.model}**:\n\n${reply}${usage ? `\n\n_${usage.prompt_tokens} in / ${usage.completion_tokens} out_` : ""}`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            { type: "text", text: `Chat failed: ${(e as Error).message}` },
          ],
        };
      }
    },
  };
}

export function createBlockRunImageTool(
  _api: OpenClawPluginApi,
  config: CrossmintPluginConfig
) {
  return {
    name: "blockrun_image",
    description:
      "Generate an image via BlockRun. Supports DALL-E 3, GPT Image 1, and Flux 1.1 Pro. Payment via lobster.cash wallet.",
    parameters: Type.Object({
      prompt: Type.String({ description: "Image description" }),
      model: Type.Optional(
        Type.String({
          description:
            "'openai/dall-e-3' (default), 'openai/gpt-image-1', or 'black-forest/flux-1.1-pro'",
        })
      ),
      size: Type.Optional(
        Type.String({
          description:
            "'1024x1024' (default), '1792x1024', or '1024x1792'",
        })
      ),
      quality: Type.Optional(
        Type.String({ description: "'standard' (default) or 'hd'" })
      ),
    }),
    async execute(
      _id: string,
      params: Record<string, unknown>,
      ctx: OpenClawPluginToolContext
    ) {
      const prompt = params.prompt as string;
      const agentId = getAgentId(ctx);
      if (!prompt)
        return {
          content: [{ type: "text", text: "prompt is required." }],
        };
      const model = (params.model as string) || "openai/dall-e-3";
      try {
        const res = await fetchWithX402(
          `${BLOCKRUN_API}/images/generations`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              prompt,
              size: (params.size as string) || "1024x1024",
              quality: (params.quality as string) || "standard",
              n: 1,
            }),
          },
          agentId,
          config
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = await res.json();
        const img = result.data?.[0];
        if (!img)
          return {
            content: [{ type: "text", text: "No image returned." }],
          };
        return {
          content: [
            {
              type: "text",
              text: `Image generated with ${model}!\n\nURL: ${img.url}${img.revised_prompt ? `\n\nRevised prompt: ${img.revised_prompt}` : ""}`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Image generation failed: ${(e as Error).message}`,
            },
          ],
        };
      }
    },
  };
}
