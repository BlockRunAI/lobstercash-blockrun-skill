#!/usr/bin/env bash
set -euo pipefail

# BlockRun AI skill installer for lobster.cash
# Usage: curl -sSL https://raw.githubusercontent.com/BlockRunAI/lobstercash-blockrun-skill/main/install.sh | bash

REPO="https://raw.githubusercontent.com/BlockRunAI/lobstercash-blockrun-skill/main"

# Download skill + tools
mkdir -p skills/blockrun src
curl -sSL "$REPO/skills/blockrun/SKILL.md" -o skills/blockrun/SKILL.md
curl -sSL "$REPO/src/blockrun-tools.ts" -o src/blockrun-tools.ts
echo "Downloaded skills/blockrun/SKILL.md"
echo "Downloaded src/blockrun-tools.ts"

# Add "blockrun" to openclaw.plugin.json skills array if it exists
if [ -f openclaw.plugin.json ] && command -v jq &>/dev/null; then
  if ! jq -e '.skills | index("blockrun")' openclaw.plugin.json &>/dev/null; then
    jq '.skills += ["blockrun"]' openclaw.plugin.json > tmp.$$.json && mv tmp.$$.json openclaw.plugin.json
    echo "Added \"blockrun\" to openclaw.plugin.json"
  fi
fi

echo ""
echo "Done! Now add to your index.ts:"
echo ""
echo '  import { createBlockRunModelsTool, createBlockRunChatTool, createBlockRunImageTool } from "./src/blockrun-tools.js";'
echo ""
echo '  api.registerTool(createBlockRunModelsTool(), { name: "blockrun_models" });'
echo '  api.registerTool(createBlockRunChatTool(), { name: "blockrun_chat" });'
echo '  api.registerTool(createBlockRunImageTool(), { name: "blockrun_image" });'
