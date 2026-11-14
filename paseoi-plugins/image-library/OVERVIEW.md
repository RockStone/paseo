Image library collects every image from a workspace's agent conversations in one grid. Open it from the images icon in the workspace header.

## What it shows

- Images you attached to prompts (Mine).
- Images agents produced: screenshots from tool results, such as a Read of a .png or a browser screenshot, and images placed inline in assistant messages (Agents).

Filter by All, Mine or Agents, and search by agent title. Tap a thumbnail for a large view with **Open agent**, which jumps to the conversation, and **Copy path**. The grid loads more as you scroll, or with **Load more** on a phone. The header button counts images added since you last opened the drawer.

## How it works

The daemon reads each agent's timeline, finds the image files it references, and keeps an index in `plugin-data/image-library/` inside the Paseo home (`PASEO_HOME`, usually `~/.paseo`). Only agents that changed since the last visit are rescanned, and a changed agent reads only its new rows.

Reading the timeline of a stored agent resumes it, so the index does that on its own only for agents that are loaded or were active in the last 3 days. Older conversations are indexed when you press **Scan older conversations** at the bottom of the grid, which shows how many are not scanned yet. A press scans up to 20 agents one after another, shows its progress and can be stopped with **Stop**. Press it again for the next 20. Images you attached to an older conversation that was never scanned are not listed until it is scanned. Images stay on the daemon machine; thumbnails and large views travel to the app over the plugin connection and nothing leaves your network.

## Limits

- Only local files that still exist are listed. Paseo keeps agent screenshots in the system temporary directory, which the operating system can clear. Images you attached are kept in `desktop-attachments` and last longer.
- Images referenced by web address or embedded without a file are not listed.
- Thumbnails (320 px) and large views (2048 px) of big files are resized with `sips` on macOS. Elsewhere, files over 300 KB get no thumbnail and files over 12 MB have no large view; copy the path instead.
- Images attached from another device or before the app began saving attachments may be missing when no copy is on disk.

Requires Paseo 0.15.4 or later on both the daemon and the app.
