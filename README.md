# BlockRun AI Skill for lobster.cash

Drop-in BlockRun AI integration for the [lobster.cash](https://lobster.cash) OpenClaw plugin. Adds 3 tools that let the agent chat with 40+ AI models and generate images via [BlockRun](https://sol.blockrun.ai).

The tools call the BlockRun API directly. Payment execution is delegated to lobster.cash via x402 — no wallet or signing logic in these files.

## What's Included

```
skills/blockrun/SKILL.md     # AI skill guide (tells the agent when/how to use BlockRun)
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
cp src/blockrun-tools.ts  <lobster-plugin>/src/blockrun-tools.ts
cp -r skills/blockrun     <lobster-plugin>/skills/blockrun
```

### 2. Register tools in `index.ts`

Add the imports:

```ts
import {
  createBlockRunModelsTool,
  createBlockRunChatTool,
  createBlockRunImageTool,
} from "./src/blockrun-tools.js";
```

Inside `register()`:

```ts
api.registerTool(createBlockRunModelsTool(api, config), { name: "blockrun_models" });
api.registerTool(createBlockRunChatTool(api, config), { name: "blockrun_chat" });
api.registerTool(createBlockRunImageTool(api, config), { name: "blockrun_image" });
```

### 3. Add skill to `openclaw.plugin.json`

```json
{
  "skills": ["crossmint", "blockrun"]
}
```

That's it. No new dependencies required.

## API Endpoints

All requests go to `https://sol.blockrun.ai/api/v1/`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/models` | List models and pricing |
| POST | `/chat/completions` | Chat completion |
| POST | `/images/generations` | Image generation |

## Requirements

- `@sinclair/typebox` (already in lobster.cash plugin)
- A funded lobster.cash wallet with USDC (for paid models)
