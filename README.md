# Dbrief

Dbrief extracts daily session activity into artifacts for generating Markdown daily notes.
The extractor currently supports Codex, Opencode, and Claude Code session data. The final note output is plain Markdown.

## How does Dbrief work?

Dbrief obtains your sessions from your coding agents' respective directories and extracts logs based on the selected date.
You can install the skill to the agent of your choice, and you can either:
- Edit the skill to modify the location, writing style, or note layout
- Or just use it directly with the default layout.

When no `--source` is provided, Dbrief auto-discovers supported local sources that have readable local state.

## Installation

```bash
npm install -g @franshjy/dbrief
```

## Quick Start

```bash
cd ~/your-project
dbrief install              # Choose which coding agent(s) receive dbrief-note
dbrief extract              # Extract today's sessions
$dbrief-note
```

The CLI produces the JSON artifact. Your coding agent uses the installed `dbrief-note` skill to turn that artifact into a Markdown note with `Summary`, `Projects`, and `Other` sections.

## Commands

### extract

Extract session data for a date or date range.

```bash
dbrief extract                              # Today -> ./dbrief_YYYY-MM-DD.json
dbrief extract --date 2026-06-01            # Specific date -> ./dbrief_2026-06-01.json
dbrief extract --from 2026-05-01            # From date to today
dbrief extract --to 2026-06-01              # From earliest to date
dbrief extract --from 2026-05-01 --to 2026-06-01  # Date range -> current directory by default
dbrief extract --source codex               # Codex only
dbrief extract --source opencode           # Opencode only
dbrief extract --source codex,opencode     # Explicit merged sources
dbrief extract --source claude             # Claude Code only
dbrief extract --out ./output.json          # Custom output path
```

**Options:**
- `--date <date>`: Target date (today, yesterday, or YYYY-MM-DD)
- `--from <date>`: Start date for range extraction
- `--to <date>`: End date for range extraction
- `--out <path>`: Output file (single day) or directory (range)
- `--source <source>`: Enable session source(s): `codex`, `opencode`, `claude`
- `--codex-dir <path>`: Codex data directory (default: `~/.codex`)
- `--opencode-dir <path>`: Opencode data directory (default: `~/.local/share/opencode`)
- `--claude-dir <path>`: Claude Code data directory (default: `~/.claude`)

Notes:
- Source merge is the default behavior when multiple supported local sources are discovered.

### install

Install the `dbrief-note` skill to one or more coding agents in the current directory. The skill writes Markdown only. Dbrief does not include note-app adapters or native app APIs in this release.

```bash
dbrief install                         # Interactive selector
dbrief install --agent codex           # Codex only -> .codex/skills/dbrief-note/SKILL.md
dbrief install --agent opencode        # Opencode only -> .opencode/skills/dbrief-note/SKILL.md
dbrief install --agent claude          # Claude Code only -> .claude/skills/dbrief-note/SKILL.md
dbrief install --agent codex,opencode  # Multiple selected agents
dbrief install --all                   # Codex, Opencode, and Claude Code
```

In non-interactive shells, `dbrief install` keeps the previous Codex default.

### inspect

Inspect a generated artifact. Defaults to pretty-printed JSON. Use `--format summary` for a compact overview.

```bash
dbrief inspect --input ./dbrief_2026-06-04.json
dbrief inspect --input ./dbrief_2026-06-04.json --format summary
```

**`--format summary`** prints a compact breakdown: date, timezone, and per-project thread/message/context counts.

**Options:**
- `--input <path>`: Input artifact file (required)
- `--format summary`: Print a compact summary instead of full JSON

## Artifact Schema

Output is minified JSON. Messages are tuples of `["u"|"a", content_string]`.

```json
{
  "date": "2026-06-01",
  "timezone": "Asia/Bangkok",
  "projects": [
    {
      "project_key": "project-alpha",
      "threads": [
        {
          "title": "Daily note output contract",
          "branch": "master",
          "context": [],
          "messages": [
            ["u", "Why did you modify the mapper of the user table?"],
            ["a", "Whoopsies!"],
            ["u", "tf?"],
            ["a", "My bad g"]
          ]
        }
      ]
    }
  ]
}
```

**Extraction modes:**
- **Full** (no compaction): `context` = `[]`, `messages` = all messages
- **Hybrid** (compacted): `context` = replacement_history, `messages` = post-compaction messages

**Current source behavior:**
- **Codex**: Reads thread metadata from `state_5.sqlite` and transcript content from JSONL rollout files.
- **Opencode**: Reads session, message, and part data from `opencode.db`, flattening visible user/assistant text only.
- **Claude Code**: Reads per-project JSONL session streams from `~/.claude/projects`, keeping user/assistant text while dropping command/meta noise and tool-result internals.
## Note Writing Structure

The primary output of `dbrief extract` is JSON. The final daily note is generated by the installed `dbrief-note` skill.
You can override the default structure by editing the skill. The writer should also preserve an existing note structure when updating an existing file.

The default Markdown structure is:

```markdown
# {date}

## Summary

## Projects

## Other
```

## Dev Setup

```bash
npm install
npm run build
npm link
```

## License

This project is licensed under the GNU Affero General Public License v3.0
(`AGPL-3.0`). See [LICENSE](./LICENSE) for the full text.

If you run a modified version of this project as a network service, AGPL
requires you to make the corresponding source code available to those users.
