/* Content script for news.ycombinator.com/item pages.
 * Adds "save" and "save+parents" links to every comment. */
/* global browser */
(() => {
  const HN = "https://news.ycombinator.com/";
  const API = "https://hacker-news.firebaseio.com/v0/item/";

  const pageId = new URL(location.href).searchParams.get("id");
  if (!pageId) return;

  // On a comment's own page (item?id=<comment>) the top "fatitem" is a comment
  // with an "on: <story>" link; on a story page it is the submission.
  const fat = document.querySelector("table.fatitem tr.athing");
  const onStoryLink = fat && fat.querySelector(".onstory a[href*='item?id=']");
  const isCommentPage = !!onStoryLink;
  const storyId = isCommentPage
    ? new URL(onStoryLink.getAttribute("href"), HN).searchParams.get("id")
    : pageId;

  /* ---------- page structure ---------- */

  function indentOf(tr) {
    const td = tr.querySelector("td.ind");
    if (!td) return 0;
    const attr = td.getAttribute("indent");
    if (attr != null && attr !== "") return Number(attr);
    const img = td.querySelector("img");
    return img ? Math.round(Number(img.getAttribute("width") || 0) / 40) : 0;
  }

  /** id -> { id, el, parentId, isFat } for every comment on the page. */
  const rows = new Map();
  if (isCommentPage) {
    rows.set(fat.id, { id: fat.id, el: fat, parentId: null, isFat: true });
  }
  {
    const stack = [];
    for (const tr of document.querySelectorAll("tr.athing.comtr")) {
      const depth = indentOf(tr);
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      const parent = stack[stack.length - 1];
      const info = {
        id: tr.id,
        el: tr,
        depth,
        parentId: parent ? parent.id : isCommentPage ? fat.id : null,
      };
      rows.set(tr.id, info);
      stack.push(info);
    }
  }

  /* ---------- HN API (for things not on this page) ---------- */

  const apiCache = new Map();
  function apiItem(id) {
    if (!apiCache.has(id)) {
      apiCache.set(
        id,
        fetch(`${API}${id}.json`).then((r) => {
          if (!r.ok) throw new Error(`HN API ${r.status}`);
          return r.json();
        })
      );
    }
    return apiCache.get(id);
  }

  /** Root-first comment ancestor ids of a comment, via the HN API. */
  let fatAncestorsPromise = null;
  function fatAncestors() {
    if (!fatAncestorsPromise) {
      fatAncestorsPromise = (async () => {
        const chain = [];
        let item = await apiItem(fat.id);
        while (item && item.parent) {
          const parent = await apiItem(item.parent);
          if (!parent || parent.type !== "comment") break;
          chain.unshift(String(parent.id));
          item = parent;
        }
        return chain;
      })();
    }
    return fatAncestorsPromise;
  }

  async function ancestorIds(id) {
    const chain = [];
    let cur = rows.get(id);
    while (cur && cur.parentId && rows.has(cur.parentId)) {
      chain.unshift(cur.parentId);
      cur = rows.get(cur.parentId);
    }
    if (cur && cur.isFat) chain.unshift(...(await fatAncestors()));
    return chain;
  }

  let storyPromise = null;
  function getStory() {
    if (!storyPromise) {
      storyPromise = (async () => {
        const hnUrl = `${HN}item?id=${storyId}`;
        if (!isCommentPage) {
          const a = document.querySelector(".fatitem .titleline > a");
          const href = a ? new URL(a.getAttribute("href"), HN).href : hnUrl;
          return { id: storyId, title: a ? a.textContent.trim() : `HN ${storyId}`, url: href };
        }
        const title = onStoryLink.textContent.trim();
        try {
          const item = await apiItem(storyId);
          return { id: storyId, title: item.title || title, url: item.url || hnUrl };
        } catch (e) {
          return { id: storyId, title, url: hnUrl };
        }
      })();
    }
    return storyPromise;
  }

  /* ---------- HTML -> Markdown ---------- */

  function escapeMd(text) {
    return text.replace(/([\\`*_[\]<>$~=|#])/g, "\\$1");
  }

  function escapeUrl(url) {
    return url.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
  }

  function inline(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeMd(node.nodeValue.replace(/\s+/g, " "));
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    if (node.classList.contains("reply")) return "";
    const tag = node.tagName.toLowerCase();
    const inner = () => Array.from(node.childNodes).map(inline).join("");
    switch (tag) {
      case "a": {
        const href = node.getAttribute("href");
        if (!href) return inner();
        const url = new URL(href, HN).href;
        // HN truncates long link text with "..." — show the full URL instead.
        const raw = node.textContent.trim();
        const text = !raw || raw.endsWith("...") ? escapeMd(url) : inner().trim();
        return `[${text}](${escapeUrl(url)})`;
      }
      case "i":
      case "em": {
        const t = inner();
        const m = t.match(/^(\s*)(.*?)(\s*)$/s);
        return m[2] ? `${m[1]}*${m[2]}*${m[3]}` : t;
      }
      case "b":
      case "strong": {
        const t = inner();
        const m = t.match(/^(\s*)(.*?)(\s*)$/s);
        return m[2] ? `${m[1]}**${m[2]}**${m[3]}` : t;
      }
      case "code":
        return "`" + node.textContent.replace(/`/g, "'") + "`";
      case "br":
        return "\n";
      default:
        return inner();
    }
  }

  function fence(code) {
    code = code.replace(/\n+$/, "");
    let ticks = "```";
    while (code.includes(ticks)) ticks += "`";
    return `${ticks}\n${code}\n${ticks}`;
  }

  function htmlToMd(root) {
    const blocks = [];
    let cur = "";
    const flush = () => {
      const t = cur
        .split("\n")
        .map((l) => l.replace(/[ \t]+/g, " ").trim())
        .join("\n")
        .trim();
      if (t) blocks.push(t);
      cur = "";
    };
    const walk = (parent) => {
      for (const node of parent.childNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = node.tagName.toLowerCase();
          if (node.classList.contains("reply")) continue;
          if (tag === "p" || tag === "div") {
            flush();
            walk(node);
            flush();
            continue;
          }
          if (tag === "pre") {
            flush();
            blocks.push(fence(node.textContent));
            continue;
          }
        }
        cur += inline(node);
      }
    };
    walk(root);
    flush();
    return blocks.join("\n\n");
  }

  /* ---------- comment extraction ---------- */

  function timeFromAge(el) {
    const title = el && el.getAttribute("title");
    if (!title) return "";
    const [iso, unix] = title.split(" ");
    if (unix && /^\d+$/.test(unix)) return new Date(Number(unix) * 1000).toISOString();
    const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
    return isNaN(d) ? "" : d.toISOString();
  }

  async function extractComment(id) {
    const row = rows.get(id);
    if (row) {
      const el = row.el;
      // HN no longer always marks the author link with class "hnuser".
      const user = el.querySelector(".comhead .hnuser, .comhead a[href^='user?id=']");
      const textEl = el.querySelector(".commtext");
      let text;
      if (textEl) text = htmlToMd(textEl);
      else {
        const c = el.querySelector(".comment");
        text = (c ? c.textContent.trim() : "") || "[deleted]";
      }
      return {
        id,
        author: user ? user.textContent.trim() : "",
        time: timeFromAge(el.querySelector(".comhead .age")),
        text,
      };
    }
    const item = await apiItem(id);
    let text = item.deleted ? "[deleted]" : item.dead ? "[dead]" : "";
    if (item.text) {
      const doc = new DOMParser().parseFromString(item.text, "text/html");
      text = htmlToMd(doc.body);
    }
    return {
      id: String(item.id),
      author: item.by || "",
      time: item.time ? new Date(item.time * 1000).toISOString() : "",
      text,
    };
  }

  /* ---------- UI ---------- */

  let toastTimer = null;
  function toast(message, isError) {
    let el = document.getElementById("hncs-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "hncs-toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.toggle("hncs-error", !!isError);
    el.classList.add("hncs-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("hncs-show"), isError ? 7000 : 2500);
  }

  let savedSet = new Set();
  let notes = {};

  /** Where to put note UI for a comment: right after its text. */
  function noteAnchor(row) {
    return row.el.querySelector(".comment") || row.el.querySelector("td.default") || row.el;
  }

  function renderNoteView(id, row) {
    let view = row.el.querySelector(".hncs-note-view");
    const note = notes[id];
    if (!note) {
      if (view) view.remove();
      return;
    }
    if (!view) {
      view = document.createElement("div");
      view.className = "hncs-note-view";
      view.title = "Your note (click to edit)";
      view.addEventListener("click", () => openNoteEditor(id));
      noteAnchor(row).after(view);
    }
    view.textContent = note;
  }

  function refresh(ids, newNotes) {
    savedSet = new Set(ids.map(String));
    if (newNotes) notes = newNotes;
    for (const [id, row] of rows) {
      const saved = savedSet.has(id);
      row.el.classList.toggle("hncs-saved", saved);
      const btn = row.el.querySelector(".hncs-save");
      if (btn) {
        btn.textContent = saved ? "unsave" : "save";
        btn.title = saved ? "Remove this comment from the Obsidian note" : "Save this comment";
      }
      const noteBtn = row.el.querySelector(".hncs-note");
      if (noteBtn) noteBtn.textContent = notes[id] ? "edit note" : "note";
      renderNoteView(id, row);
    }
  }

  async function commentWithAncestors(id) {
    const [story, anc] = await Promise.all([getStory(), ancestorIds(id)]);
    const comment = await extractComment(id);
    comment.ancestors = anc;
    return { story, comment };
  }

  function openNoteEditor(id) {
    const row = rows.get(id);
    if (!row) return;
    const existing = row.el.querySelector(".hncs-note-editor");
    if (existing) {
      existing.querySelector("textarea").focus();
      return;
    }
    const view = row.el.querySelector(".hncs-note-view");
    if (view) view.hidden = true;

    const box = document.createElement("div");
    box.className = "hncs-note-editor";
    const ta = document.createElement("textarea");
    ta.rows = 4;
    ta.placeholder = "Your note on this comment (Markdown). Ctrl+Enter to save, Esc to cancel.";
    ta.value = notes[id] || "";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save note";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    const hint = document.createElement("span");
    hint.className = "hncs-note-hint";
    hint.textContent = notes[id] ? "Clear the text and save to delete the note." : "";
    const actions = document.createElement("div");
    actions.className = "hncs-note-actions";
    actions.append(saveBtn, " ", cancelBtn, " ", hint);
    box.append(ta, actions);

    const close = () => {
      box.remove();
      if (view) view.hidden = false;
    };
    const submit = async () => {
      saveBtn.disabled = cancelBtn.disabled = true;
      try {
        const { story, comment } = await commentWithAncestors(id);
        const note = ta.value;
        const res = await browser.runtime.sendMessage({ type: "setNote", story, comment, note });
        close();
        refresh(res.ids, res.notes);
        await handleSync(res.sync, note.trim() ? "Note saved" : "Note removed");
      } catch (e) {
        console.error("[HN Comment Saver]", e);
        toast(`Error: ${e.message}`, true);
        saveBtn.disabled = cancelBtn.disabled = false;
      }
    };
    saveBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", close);
    ta.addEventListener("keydown", (e) => {
      // Keep HN's own keyboard shortcuts from firing while typing.
      e.stopPropagation();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });

    (view || noteAnchor(row)).after(box);
    ta.focus();
  }

  function openObsidianUri(sync) {
    return navigator.clipboard.writeText(sync.markdown).then(() => {
      const a = document.createElement("a");
      a.href = sync.uri;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  async function handleSync(sync, what) {
    if (!sync) {
      toast(`${what} (auto-sync off — use the toolbar button to send)`);
      return;
    }
    if (!sync.ok) {
      toast(`${what}, but Obsidian sync failed: ${sync.error}`, true);
      return;
    }
    if (sync.method === "uri") {
      try {
        await openObsidianUri(sync);
        toast(`${what} → opening Obsidian (${sync.path})`);
      } catch (e) {
        toast(`${what}, but couldn't open Obsidian: ${e.message}`, true);
      }
      return;
    }
    toast(`${what} → ${sync.path}`);
  }

  async function onSave(id, withAncestors) {
    try {
      if (!withAncestors && savedSet.has(id)) {
        if (notes[id] && !confirm("Unsaving this comment also deletes your note on it. Continue?")) {
          return;
        }
        const res = await browser.runtime.sendMessage({ type: "unsave", storyId, ids: [id] });
        refresh(res.ids, res.notes);
        await handleSync(res.sync, "Removed comment");
        return;
      }
      const [story, anc] = await Promise.all([getStory(), ancestorIds(id)]);
      const ids = withAncestors ? [...anc, id] : [id];
      const comments = await Promise.all(
        ids.map(async (cid, i) => {
          const c = await extractComment(cid);
          c.ancestors = withAncestors ? anc.slice(0, i) : anc;
          return c;
        })
      );
      const res = await browser.runtime.sendMessage({ type: "save", story, comments });
      refresh(res.ids, res.notes);
      const n = comments.length;
      await handleSync(res.sync, `Saved ${n} comment${n === 1 ? "" : "s"}`);
    } catch (e) {
      console.error("[HN Comment Saver]", e);
      toast(`Error: ${e.message}`, true);
    }
  }

  function makeLink(cls, label, title, handler) {
    const a = document.createElement("a");
    a.href = "javascript:void(0)";
    a.className = cls;
    a.textContent = label;
    a.title = title;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handler();
    });
    return a;
  }

  for (const [id, row] of rows) {
    const comhead = row.el.querySelector("span.comhead");
    if (!comhead) continue;
    const span = document.createElement("span");
    span.className = "hncs-controls";
    span.append(
      " | ",
      makeLink("hncs-save", "save", "Save this comment", () => onSave(id, false)),
      " | ",
      makeLink(
        "hncs-save-anc",
        "save+parents",
        "Save this comment and all of its parent comments",
        () => onSave(id, true)
      ),
      " | ",
      makeLink("hncs-note", "note", "Add your own note to this comment", () => openNoteEditor(id)),
      " "
    );
    const navs = comhead.querySelector(".navs");
    if (navs && navs.parentNode === comhead) comhead.insertBefore(span, navs);
    else comhead.appendChild(span);
  }

  browser.runtime
    .sendMessage({ type: "getSaved", storyId })
    .then((res) => refresh(res.ids || [], res.notes || {}))
    .catch((e) => console.error("[HN Comment Saver]", e));
})();
