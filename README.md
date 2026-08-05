# BlockRun AI Skill for lobster.cash

Gives lobster.cash agents access to <!-- br:models.chatVisible -->71<!-- /br:models.chatVisible --> AI models and image generation via [BlockRun](https://sol.blockrun.ai). Payment handled by the lobster.cash smart wallet via x402.

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

Dependencies: `@solana/web3.js`, `bs58`. Agent keypair's ATA must be funded with USDC.
