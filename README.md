# HN Comment Saver (Firefox)

Click **save** on any Hacker News comment to add it to an Obsidian note named
after the post. The note links to the post and shows the saved comments as
nested, collapsible threads (Obsidian callouts).

Each comment gets three links next to its author/age:

- **save** – save just this comment (click again — it reads **unsave** — to remove it)
- **save+parents** – save this comment and every ancestor up to the top level
- **note** – type your own note on the comment (saving a note also saves the
  comment). It appears in Obsidian as an indented quote under the comment's
  text. Clear the text and save to delete it.

A saved comment is placed under its nearest *saved* ancestor, so it appears
inside all of its saved parents like on HN; with no saved ancestor it is a
top-level comment. Siblings are ordered oldest first.

## Install

Download the `.xpi` from the
[latest release](https://github.com/jackhipson300/hn-comment-saver/releases/latest)
and open it in Firefox (or `about:addons` → gear → *Install Add-on From File*).
It is signed by Mozilla as an unlisted add-on, so it works in regular Firefox
and **updates itself**: Firefox checks the `update_url` in the manifest about
once a day (`about:addons` → gear → *Check for Updates* to update right away).

## Releasing

Every push to the default branch that touches `extension/` runs
`.github/workflows/release.yml`, which stamps the version
(`<major>.<minor>.<run number>`, major/minor from `extension/manifest.json`),
signs it with Mozilla, and publishes a GitHub release with the `.xpi` and
`updates.json`. Installed copies pick it up automatically.

One-time setup: create API credentials at
<https://addons.mozilla.org/developers/addon/api/key/> and add them as repo
secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET` (*Settings → Secrets and
variables → Actions*). It can also be started by hand from the Actions tab
(*Run workflow*).

## Development

```sh
npm install
npm run dev    # Firefox with the extension loaded; reloads on every file change
npm run lint
```

`npm run dev` uses a separate Firefox profile named `hncs-dev` that keeps its
settings between runs, so the Obsidian settings only need entering once.

## Connect to Obsidian

Open the extension's settings (toolbar icon → *Settings*) and choose one:

1. **Local REST API plugin (recommended).** Install *Local REST API* from
   Obsidian's community plugins, copy its API key into the settings, and
   either open `https://127.0.0.1:27124` once in Firefox to accept its
   self-signed certificate, or enable the plugin's non-encrypted server and
   use `http://127.0.0.1:27123`. Use *Test connection* to check. The note is
   then rewritten silently every time you save/unsave.
2. **obsidian:// URI (no plugin).** The note is copied to the clipboard and
   Obsidian's `new` URI is opened with `overwrite`. Firefox asks once for
   permission to open Obsidian links. Obsidian will come to the front on each
   save; turn off auto-sync and use *Send to Obsidian* in the popup if that's
   annoying.

Other settings: target folder (default `Hacker News`), auto-sync on/off, and
whether threads start collapsed.

**The extension owns the note.** It regenerates the whole file from its own
saved data, so edits you make inside the note are overwritten on the next
save. Keep your own notes in a separate file that links to it.

The toolbar popup lists every post you've saved from, with *Send to
Obsidian*, *Copy Markdown* and *Forget* actions.

## Note format

```markdown
---
title: "Post title"
hn_id: 123
url: "https://example.com/article"
hn_url: "https://news.ycombinator.com/item?id=123"
tags:
  - hackernews
---

- **Post:** [Post title](https://example.com/article)
- **Discussion:** [Hacker News](https://news.ycombinator.com/item?id=123)

## Saved comments

> [!quote]+ [alice](https://news.ycombinator.com/user?id=alice) · [2026-11-20 12:00](https://news.ycombinator.com/item?id=124)
> Top-level comment text
>
> > [!quote]+ [bob](…) · [2026-11-20 12:05](…)
> > A saved reply
```

## Notes

- Works on thread pages and on a single comment's page (`item?id=<comment>`);
  ancestors that aren't on the page are fetched from the official HN API.
- Comment HTML (paragraphs, links, italics, code blocks) is converted to
  Markdown; characters Obsidian would treat as syntax (`$`, `*`, `[` …) are
  escaped.
