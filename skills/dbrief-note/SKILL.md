---
name: dbrief-note
description: Generate a polished daily note from a Dbrief JSON artifact. Use when the user asks to create, write, or generate a daily note, daily summary, or project log.
---

# Daily Note Generator

Read the Dbrief JSON artifact and generate one portable Markdown daily note.
Infer note conventions from the target location, existing file, nearby templates, and project instructions, but always produce Markdown.

## Output Format

If no stronger existing convention is detected, use this base structure:

```markdown
# {date}

## Summary
[What happened overall today? High-level overview.]

## Projects

### {project_name}

#### Changes
[What was done in this project today]

#### Unresolved
[Open questions, blockers, or things left incomplete]

#### Notes
[Observations, decisions, or context worth remembering]

## Other
[Cross-project notes, personal workflow notes, uncategorized items, or anything that does not belong cleanly to one project.]
```

## Instructions

1. Read the JSON artifact (user provides the path, or use `./dbrief_YYYY-MM-DD.json` from the current directory by default)
2. For each project, analyze the conversation threads to identify:
   - Concrete changes (features, fixes, decisions made)
   - Unresolved items (questions raised, blockers, incomplete work)
   - Notable context (architectural decisions, trade-offs discussed)
3. Write a concise summary that ties everything together
4. Keep the tone retrospective and factual
5. Use the project directory name as the project heading

## Writer Rules

- If the target Markdown file already exists, preserve its structure and update or append within matching sections.
- If nearby notes or templates imply conventions, follow those conventions.
- If no convention is detected, use the base Markdown structure above.
- Do not assume Obsidian-only syntax unless the workspace clearly uses it.
- Put non-project-wide material, cross-project notes, personal workflow notes, and uncategorized items under `## Other`.
