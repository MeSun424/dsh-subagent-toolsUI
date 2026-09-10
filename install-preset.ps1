# install-preset.ps1
#
# 0.4.11+ layers a per-session lock on the official Harness subagent tools.
# Agent presets should keep pointing at @deepseek-ai/dsh-tool-subagent.
# This script no longer rewrites a standard-plus preset.

Write-Host "dsh-subagent-tools-ui 0.4.11+ does not replace official subagent tools."
Write-Host "Keep the default Harness preset (usually 'standard')."
Write-Host ""
Write-Host "If an older install created ~/.dsh/.agent-presets/standard-plus, switch"
Write-Host "the default preset back to 'standard' in Harness settings, then restart:"
Write-Host "  dsh web --host 127.0.0.1 --port 8081"
Write-Host ""
Write-Host "No preset files were changed."
