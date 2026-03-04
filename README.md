# BlockRun AI Skill for lobster.cash

Drop-in BlockRun AI integration for the [lobster.cash](https://lobster.cash) OpenClaw plugin. Adds 3 tools that let the agent chat with 40+ AI models and generate images, paid per-request with USDC from the agent's Solana wallet via the [x402 protocol](https://x402.org).

## What's Included

```
skills/blockrun/SKILL.md     # AI skill guide (tells the agent when/how to use BlockRun)
src/blockrun-api.ts          # x402 Solana payment + BlockRun API client
src/blockrun-tools.ts        # 3 OpenClaw tool factories
```

## Tools

| Tool | Description |
|------|-------------|
| `blockrun_models` | List available AI models with pricing |
| `blockrun_chat` | Chat with any model (GPT-5, Claude, Gemini, DeepSeek, etc.) |
| `blockrun_image` | Generate images (DALL-E 3, GPT Image 1, Flux 1.1 Pro) |

## Integration Steps

### 1. Copy files into the lobster.cash plugin

```
cp src/blockrun-api.ts    <lobster-plugin>/src/blockrun-api.ts
cp src/blockrun-tools.ts  <lobster-plugin>/src/blockrun-tools.ts
cp -r skills/blockrun     <lobster-plugin>/skills/blockrun
```

### 2. Install dependency

```bash
npm install @solana/spl-token
```

`@solana/web3.js` should already be a dependency of the lobster.cash plugin.

### 3. Register tools in `index.ts`

Add the imports at the top:

```ts
import {
  createBlockRunModelsTool,
  createBlockRunChatTool,
  createBlockRunImageTool,
} from "./src/blockrun-tools.js";
```

Inside the `register()` function, register all 3 tools:

```ts
api.registerTool(createBlockRunModelsTool(api, config), { name: "blockrun_models" });
api.registerTool(createBlockRunChatTool(api, config), { name: "blockrun_chat" });
api.registerTool(createBlockRunImageTool(api, config), { name: "blockrun_image" });
```

### 4. Add skill to `openclaw.plugin.json`

Add `"blockrun"` to the skills array:

```json
{
  "skills": ["crossmint", "blockrun"]
}
```

## How It Works

The tools reuse the lobster.cash wallet (Solana keypair stored at `~/.openclaw/crossmint-wallets/wallets.json`) to pay for BlockRun API calls:

1. Tool sends request to `sol.blockrun.ai`
2. Server returns `402 Payment Required` with USDC amount
3. Tool builds a partially-signed Solana SPL `TransferChecked` transaction
4. Retries with the signed tx in the `PAYMENT-SIGNATURE` header
5. Server's CDP facilitator co-signs and settles on-chain
6. AI response is returned

No API keys needed. The agent's private key never leaves the local machine.

## API Endpoint

All requests go to `https://sol.blockrun.ai/api/v1/...`:

- `GET /v1/models` — list models
- `POST /v1/chat/completions` — chat completion
- `POST /v1/images/generations` — image generation

## Requirements

- Node.js 18+
- `@solana/web3.js` (already in lobster.cash plugin)
- `@solana/spl-token` (new dependency)
- `@sinclair/typebox` (already in lobster.cash plugin)
- A funded Solana wallet with USDC (set up via lobster.cash)
