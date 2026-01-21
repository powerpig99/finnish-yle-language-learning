# Project Memories - Language Learning Subtitles Extension

## ⚠️ GUIDING PRINCIPLE: Unified Interface (Added: 2026-01-19)

**CRITICAL:** Keep unified interface and controls across ALL platforms. Only adjust translation/adapter layers, NOT control logic.

- **ControlActions** = ONLY place for action logic (skip, repeat, speed, auto-pause)
- **ControlIntegration** = ONLY bridge between controls and contentscript
- **Platform adapters** = ONLY provide video element, subtitle data, mount points
- **Fix once, works everywhere** - don't duplicate logic per platform

If you find yourself writing platform-specific control logic in contentscript.js, STOP and put it in the unified layer instead.

---

## Workflow Reminder (Added: 2026-01-19)

**After fixing bugs that required significant debugging effort:**

1. Update `CLAUDE.md` with the fix details:
   - Problem description
   - Root cause analysis
   - Fix location (file + line numbers)
   - Code snippets if helpful

2. This prevents re-debugging the same issues in future sessions.

3. Key files to update:
   - `CLAUDE.md` - Main development guide with learnings
   - This memories file for critical reminders

## Key Debugging Learnings

### YLE Menu Focus Issue
- **Problem:** YLE settings menus close immediately
- **Cause:** `focusVideo()` called via setTimeout after control bar clicks
- **Fix:** Exclude `Settings__*` and `TopLevelSettings` elements in click handler
- **Location:** `contentscript.js` lines ~1448-1457

### Skip/Repeat Not Working (Initial Fix)
- **Problem:** Skip prev/next and repeat buttons don't work
- **Cause:** Subtitles not synced to `ControlIntegration`
- **Fix:** Call `ControlIntegration.setSubtitles(subtitles)` after batch load
- **Location:** `contentscript.js` ~line 495 in `handleBatchTranslation()`

### Repeat Skips Instead of Repeating (Accumulation Fix)
- **Problem:** Repeat button jumps to wrong position (skips instead of repeating)
- **Cause:** YLE loads subtitles in small batches (2-4). Each `setSubtitles(batch)` REPLACES previous data. Repeat only sees latest batch, not all 90+ subtitles.
- **Fix:** Use `fullSubtitles` array that ACCUMULATES (like `subtitleTimestamps`). Sync accumulated array, not current batch.
- **Key pattern:** Check for existing before adding: `fullSubtitles.find(fs => Math.abs(fs.startTime - sub.startTime) < 0.5)`
- **Location:** `contentscript.js` ~lines 488-513 in `handleBatchTranslation()`

### Extension Reload Required
Chrome extensions do NOT auto-reload. After code changes:
1. Go to `chrome://extensions`
2. Click reload on the extension
3. Refresh the target page

### Test Directly on Chrome
**IMPORTANT:** Always test changes directly in Chrome browser, not through simulations or assumptions.
- Open the actual website (YLE Areena, YouTube)
- Verify the feature works visually
- Check browser console for errors/logs
- Don't assume code changes work - verify them

---

## Tool Selection: CLI vs Browser (Added: 2026-01-21)

**Prefer CLI tools over browser automation.** Browser automation should be a last resort.

| Task | Use This | NOT This |
|------|----------|----------|
| Git operations | `git` CLI | Browser |
| Create/push tags | `git tag` + `git push` | Browser |
| Create releases | `gh release create` | Browser |
| View PR/issues | `gh pr view`, `gh issue view` | Browser |
| **Rename repo** | **Browser** (no CLI option) | - |
| **Change repo settings** | **Browser** | - |

**Rule:** Only use browser automation for things that genuinely can't be done via CLI (like renaming a repo or changing settings that have no CLI equivalent).
