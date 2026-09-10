#!/usr/bin/env bash
# install-preset.sh
#
# 0.4.11+ layers a per-session lock on the official Harness subagent tools.
# Agent presets should keep pointing at @deepseek-ai/dsh-tool-subagent.
# This script no longer rewrites a standard-plus preset.

set -euo pipefail

echo "dsh-subagent-tools-ui 0.4.11+ does not replace official subagent tools."
echo "Keep the default Harness preset (usually standard)."
echo
echo "If an older install created ~/.dsh/.agent-presets/standard-plus, switch"
echo "the default preset back to standard in Harness settings, then restart:"
echo "  dsh web --host 127.0.0.1 --port 8081"
echo
echo "No preset files were changed."
