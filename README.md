# BlockRun AI Skill for lobster.cash

Gives lobster.cash agents access to 40+ AI models and image generation via [BlockRun](https://sol.blockrun.ai).

## Install

From your lobster.cash plugin directory:

```bash
curl -sSL https://raw.githubusercontent.com/BlockRunAI/lobstercash-blockrun-skill/main/install.sh | bash
```

Then add 4 lines to your `index.ts`:

```ts
import { createBlockRunModelsTool, createBlockRunChatTool, createBlockRunImageTool } from "./src/blockrun-tools.js";

api.registerTool(createBlockRunModelsTool(), { name: "blockrun_models" });
api.registerTool(createBlockRunChatTool(), { name: "blockrun_chat" });
api.registerTool(createBlockRunImageTool(), { name: "blockrun_image" });
```

No new dependencies. Tools just call `sol.blockrun.ai/api/v1/` via fetch.

## What the agent can do

- **Chat** with GPT-5, Claude, Gemini, DeepSeek, and 40+ more
- **Generate images** with DALL-E 3, GPT Image 1, Flux 1.1 Pro
- **Browse models** and pricing
