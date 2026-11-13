Driveboard puts a project's tracker beside the session. Open it from the list icon in the workspace header, or with ⌥⌘N (Ctrl+Alt+N elsewhere). It slides in from the right edge with three tabs.

## Owner todo (default)

Items from the project's `docs/owner-todo.md` that wait on you, grouped Critical, Product and Later, with done items folded away. Expand an item to read it and reply in place; ⌘↵ saves the reply into the file. New replies collect in a banner: **Send to agent** prompts the workspace's top-level agent (the most recently active one) with every new reply, and **Dismiss** marks them handled without a prompt. You can edit or remove your replies.

## Progress

Done share, rank counts and the task list from `docs/drive.md`: in progress, open, then done.

## Notes

The workspace's sticky notes. Agents in the workspace get `post_sticky_note` and `read_sticky_notes`; you can add notes for them too (⌘↵ adds).

## Badge and storage

The header button counts owner items that are new or changed since you last opened the board, tasks added to docs/drive.md since you last opened Progress, and agent notes you have not seen. Task status changes only dot the Progress tab. It refreshes about every 10 seconds.

The tracker files belong to the project: every workspace of a project shows the files in the project's root checkout. Replies are written there with a stale-file guard and an atomic rename. Notes and the record of sent replies live on the daemon machine in `plugin-data/driveboard/` inside the Paseo home (`PASEO_HOME`, usually `~/.paseo`). On first start the plugin copies notes from the retired Sticky notes plugin and sent replies from the retired standalone Driveboard.

Tracker format: top-level checkboxes `[ ]`, `[~]` or `[x]`, an ID (`Z-1` for tasks, `**OT-1 Title.**` for owner items) and one `<!-- priority:3|2|1 -->` marker. Owner replies are stored as `  > Owner reply (YYYY-MM-DD HH:MM UTC): text` lines under the item.

Requires Paseo 0.15.4 or later on both the daemon and the app.
