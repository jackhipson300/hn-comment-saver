/* Shared helpers: settings defaults, note naming and Markdown rendering.
 * Loaded as a plain script by the background page, popup and options page,
 * and exposes everything on `globalThis.HNCS`. */
(function () {
  const HN = "https://news.ycombinator.com/";

  const DEFAULT_SETTINGS = {
    method: "rest", // "rest" (Local REST API plugin) or "uri" (obsidian:// URI)
    restUrl: "https://127.0.0.1:27124",
    apiKey: "",
    vault: "",
    folder: "Sources/Blogs/Hacker News Comments",
    autoSync: true,
    collapsed: false, // render threads folded by default
  };

  /** Make a post title safe to use as an Obsidian file name. */
  function sanitizeFileName(title) {
    const name = String(title || "Untitled")
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/[\u0000-\u001f]/g, "")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 180)
      .trim();
    return name || "Untitled";
  }

  function notePath(post, settings) {
    const folder = String(settings.folder || "")
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");
    const file = (post.fileName || sanitizeFileName(post.title)) + ".md";
    return folder ? `${folder}/${file}` : file;
  }

  function escapeLinkText(text) {
    return String(text).replace(/([\\[\]])/g, "\\$1");
  }

  function escapeUrl(url) {
    return String(url)
      .replace(/ /g, "%20")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");
  }

  function link(text, url) {
    return `[${escapeLinkText(text)}](${escapeUrl(url)})`;
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }

  /**
   * Arrange saved comments into a forest: each comment hangs under its
   * nearest *saved* ancestor, or at the top level if none are saved.
   */
  function buildTree(post) {
    const comments = post.comments || {};
    const saved = new Set(Object.keys(comments));
    const children = new Map();
    const roots = [];
    for (const c of Object.values(comments)) {
      const anc = c.ancestors || [];
      let parent = null;
      for (let i = anc.length - 1; i >= 0; i--) {
        if (saved.has(String(anc[i]))) {
          parent = String(anc[i]);
          break;
        }
      }
      if (parent) {
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(c);
      } else {
        roots.push(c);
      }
    }
    // HN item ids are monotonically increasing, so this is chronological.
    const byId = (a, b) => Number(a.id) - Number(b.id);
    roots.sort(byId);
    for (const list of children.values()) list.sort(byId);
    return { roots, children };
  }

  function renderComment(c, children, fold) {
    const author = c.author
      ? link(c.author, `${HN}user?id=${encodeURIComponent(c.author)}`)
      : "[deleted]";
    const when = link(formatDate(c.time) || "link", `${HN}item?id=${c.id}`);
    const lines = [`> [!quote]${fold} ${author} · ${when}`];
    const body = String(c.text || "").replace(/\r/g, "").split("\n");
    for (const l of body) lines.push(l ? `> ${l}` : ">");
    // The user's own note: a nested quote (indented, vertical bar) under the text.
    // It is the user's Markdown, so it is not escaped.
    const note = String(c.note || "").replace(/\r/g, "").trim();
    if (note) {
      lines.push(">");
      for (const l of note.split("\n")) lines.push(l.trim() ? `> > ${l}` : "> >");
    }
    for (const child of children.get(String(c.id)) || []) {
      lines.push(">");
      for (const cl of renderComment(child, children, fold)) {
        lines.push(cl === ">" ? "> >" : `> ${cl}`);
      }
    }
    return lines;
  }

  function yamlString(s) {
    return JSON.stringify(String(s ?? ""));
  }

  /** Render the full note for a post. */
  function renderNote(post, settings) {
    settings = Object.assign({}, DEFAULT_SETTINGS, settings);
    const fold = settings.collapsed ? "-" : "+";
    const hnUrl = `${HN}item?id=${post.id}`;
    const postUrl = post.url || hnUrl;
    const { roots, children } = buildTree(post);

    const out = [
      "---",
      `title: ${yamlString(post.title)}`,
      `hn_id: ${Number(post.id)}`,
      `url: ${yamlString(postUrl)}`,
      `hn_url: ${yamlString(hnUrl)}`,
      `updated: ${yamlString(new Date().toISOString())}`,
      "tags:",
      "  - hackernews",
      "---",
      "",
      `- **Post:** ${link(post.title || postUrl, postUrl)}`,
      `- **Discussion:** ${link("Hacker News", hnUrl)}`,
      "",
      "## Saved comments",
      "",
    ];
    if (!roots.length) out.push("_No comments saved._", "");
    for (const c of roots) {
      out.push(...renderComment(c, children, fold), "");
    }
    return out.join("\n");
  }

  function obsidianUri(post, settings) {
    const params = new URLSearchParams();
    if (settings.vault) params.set("vault", settings.vault);
    params.set("file", notePath(post, settings).replace(/\.md$/, ""));
    params.set("clipboard", "true");
    params.set("overwrite", "true");
    params.set("silent", "true");
    // Obsidian expects %20 rather than + for spaces.
    return "obsidian://new?" + params.toString().replace(/\+/g, "%20");
  }

  globalThis.HNCS = {
    HN,
    DEFAULT_SETTINGS,
    sanitizeFileName,
    notePath,
    buildTree,
    renderNote,
    obsidianUri,
  };
})();
