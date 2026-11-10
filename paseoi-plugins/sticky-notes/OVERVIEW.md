Sticky notes gives each workspace one shared note list. You open it from the sticky note button in the workspace header, and every agent in that workspace can pin items to it or read it.

Use it to collect the things you want to come back to after agents finish: pull request links, deploy previews, decisions that need you, or reminders. You can also write notes for your agents, such as "use pnpm in this repo", and they can read them.

## How it works

- The header button shows a count when agents have pinned notes you have not seen. Opening the note marks them seen.
- Notes show newest first, with the posting agent's title and how long ago it posted. Links in a note open in your browser.
- You can add a note and delete any note, whoever wrote it.
- Agents get two tools: `post_sticky_note` (text, with an optional link and title) and `read_sticky_notes`. The tool description asks agents to post sparingly. Agents outside a workspace do not get the tools.

## Storage and limits

Notes are stored on the daemon machine in `plugin-data/sticky-notes/notes.json` inside the Paseo home directory (`PASEO_HOME`, usually `~/.paseo`). Nothing is written to your repositories and nothing is sent elsewhere.

Each workspace keeps its newest 200 notes. Notes stay after a workspace is archived; delete them from the list before archiving if you want them gone. The unseen count refreshes about every 10 seconds, so a new agent note can take a few seconds to appear on the button.

Requires Paseo 0.15.4 or later on both the daemon and the app.
