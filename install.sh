#!/usr/bin/env bash
set -euo pipefail

# BlockRun AI skill installer for lobster.cash
# Usage: curl -sSL https://raw.githubusercontent.com/BlockRunAI/lobstercash-blockrun-skill/main/install.sh | bash

REPO="https://raw.githubusercontent.com/BlockRunAI/lobstercash-blockrun-skill/main"
INDEX="src/index.ts"

# Download skill + tools
mkdir -p skills/blockrun src
curl -sSL "$REPO/skills/blockrun/SKILL.md" -o skills/blockrun/SKILL.md
curl -sSL "$REPO/src/blockrun-tools.ts" -o src/blockrun-tools.ts
echo "Downloaded skills/blockrun/SKILL.md"
echo "Downloaded src/blockrun-tools.ts"

# Add "blockrun" to openclaw.plugin.json skills array
if [ -f openclaw.plugin.json ] && command -v jq &>/dev/null; then
  if ! jq -e '.skills | index("blockrun")' openclaw.plugin.json &>/dev/null; then
    jq '.skills += ["blockrun"]' openclaw.plugin.json > tmp.$$.json && mv tmp.$$.json openclaw.plugin.json
    echo "Patched openclaw.plugin.json"
  fi
fi

# Patch index.ts — add import + register tools
if [ -f "$INDEX" ] && ! grep -q "blockrun-tools" "$INDEX"; then
  IMPORT='import { createBlockRunModelsTool, createBlockRunChatTool, createBlockRunImageTool } from "./blockrun-tools.js";'
  REGISTER='  api.registerTool(createBlockRunModelsTool(), { name: "blockrun_models" });\n  api.registerTool(createBlockRunChatTool(), { name: "blockrun_chat" });\n  api.registerTool(createBlockRunImageTool(), { name: "blockrun_image" });'

  # Add import after last import line
  LAST_IMPORT=$(grep -n '^import ' "$INDEX" | tail -1 | cut -d: -f1)
  if [ -n "$LAST_IMPORT" ]; then
    sed -i.bak "${LAST_IMPORT}a\\
${IMPORT}" "$INDEX"
  else
    sed -i.bak "1i\\
${IMPORT}" "$INDEX"
  fi

  # Add registerTool calls after last existing registerTool line
  LAST_REGISTER=$(grep -n 'api.registerTool' "$INDEX" | tail -1 | cut -d: -f1)
  if [ -n "$LAST_REGISTER" ]; then
    sed -i.bak "${LAST_REGISTER}a\\
${REGISTER}" "$INDEX"
  fi

  rm -f "${INDEX}.bak"
  echo "Patched $INDEX"
fi

echo ""
echo "Done! BlockRun AI tools installed."
