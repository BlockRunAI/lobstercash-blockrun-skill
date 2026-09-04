# BlockRun AI Skill for lobster.cash

Gives lobster.cash agents access to <!-- br:models.chatVisible -->76<!-- /br:models.chatVisible --> AI models and image generation via [BlockRun](https://sol.blockrun.ai). Use a BlockRun account API key, or the lobster.cash Solana wallet via x402.

## Account API setup

[Register](https://user.blockrun.ai), [create a key](https://user.blockrun.ai/dashboard/keys), and [add credits](https://user.blockrun.ai/dashboard/credits). Set `BLOCKRUN_API_KEY` in the gateway process environment, then restart the gateway. Keep the value out of chat, source files and installer arguments.

All three tools use bearer authentication at `https://api.blockrun.ai/v1` when that variable is set. Account mode requires no Solana keypair or funded wallet. Invalid keys, insufficient credits and rate limits return errors without falling back to wallet payment.

Without a key, this integration uses **Solana** at `https://sol.blockrun.ai`. For **Base**, use the [main BlockRun SDK](https://github.com/BlockRunAI/blockrun-llm-ts); this lobster.cash adapter does not implement Base signing.

## Install

```bash
curl -sSL https://raw.githubusercontent.com/BlockRunAI/lobstercash-blockrun-skill/main/install.sh | bash
```

The install script:
1. Downloads `SKILL.md` + `blockrun-tools.ts` into the plugin
2. Patches `openclaw.plugin.json` to register the skill
3. Patches `index.ts` to import and register all 3 tools

No manual code changes needed. Restart the gateway after install.

## What the agent can do

- **Chat** with GPT-5, Claude, Gemini, DeepSeek, and 40+ more
- **Generate images** with DALL-E 3, GPT Image 1, Flux 1.1 Pro
- **Browse models** and pricing

## Manual integration

If you prefer to patch manually, add to your `index.ts`:

```ts
import { createBlockRunModelsTool, createBlockRunChatTool, createBlockRunImageTool } from "./src/blockrun-tools.js";

api.registerTool(createBlockRunModelsTool(), { name: "blockrun_models" });
api.registerTool(createBlockRunChatTool(), { name: "blockrun_chat" });
api.registerTool(createBlockRunImageTool(), { name: "blockrun_image" });
```

Dependencies: `@solana/web3.js`, `bs58`. Only wallet mode needs a funded agent keypair ATA.

## Development verification

Run `node --experimental-vm-modules --test test/*.test.mjs` with Node 22.13+ (development tests use Node's TypeScript stripping). The tests execute the three tool factories with mocked host/Solana modules and verify account priority, no wallet fallback, sanitized errors and Solana routing. This repository installs into the host plugin rather than publishing a standalone npm package.
