/* Background page: owns storage of saved comments and syncing to Obsidian. */
/* global HNCS, browser */

const postKey = (id) => `post:${id}`;

async function getSettings() {
  const { settings } = await browser.storage.local.get("settings");
  return Object.assign({}, HNCS.DEFAULT_SETTINGS, settings);
}

async function getPost(id) {
  const key = postKey(id);
  const data = await browser.storage.local.get(key);
  return data[key] || null;
}

async function putPost(post) {
  await browser.storage.local.set({ [postKey(post.id)]: post });
}

async function listPosts() {
  const all = await browser.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith("post:"))
    .map(([, v]) => v)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

// Serialize storage mutations so rapid clicks can't clobber each other.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

function savedIds(post) {
  return post ? Object.keys(post.comments || {}) : [];
}

async function saveComments(story, comments) {
  let post = await getPost(story.id);
  if (!post) {
    post = {
      id: String(story.id),
      title: story.title,
      url: story.url,
      fileName: HNCS.sanitizeFileName(story.title),
      comments: {},
      created: Date.now(),
    };
  }
  // Keep metadata fresh (file name stays stable so the note isn't duplicated).
  if (story.title) post.title = story.title;
  if (story.url) post.url = story.url;
  for (const c of comments) {
    const prev = post.comments[String(c.id)];
    const entry = {
      id: String(c.id),
      author: c.author || "",
      time: c.time || "",
      text: c.text || "",
      ancestors: (c.ancestors || []).map(String),
    };
    // Re-saving a comment must not lose the note attached to it.
    if (prev && prev.note) entry.note = prev.note;
    post.comments[String(c.id)] = entry;
  }
  post.updated = Date.now();
  await putPost(post);
  return post;
}

async function unsaveComments(storyId, ids) {
  const post = await getPost(storyId);
  if (!post) return null;
  for (const id of ids) delete post.comments[String(id)];
  post.updated = Date.now();
  await putPost(post);
  return post;
}

/** Set (or clear, when empty) the note on a comment, saving the comment first if needed. */
async function setNote(story, comment, note) {
  const id = String(comment.id);
  let post = await getPost(story.id);
  if (!post || !post.comments[id]) {
    if (!note) return post;
    post = await saveComments(story, [comment]);
  }
  if (note) post.comments[id].note = note;
  else delete post.comments[id].note;
  post.updated = Date.now();
  await putPost(post);
  return post;
}

function notesOf(post) {
  const notes = {};
  for (const [id, c] of Object.entries((post && post.comments) || {})) {
    if (c.note) notes[id] = c.note;
  }
  return notes;
}

function vaultUrl(base, path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${String(base).replace(/\/+$/, "")}/vault/${encoded}`;
}

/**
 * Write the note to Obsidian. For the REST method this happens here; for
 * the URI method we return the URI + markdown so a page with user
 * activation (content script / popup) can copy it and open Obsidian.
 */
async function syncPost(post, settings) {
  settings = settings || (await getSettings());
  const markdown = HNCS.renderNote(post, settings);
  const path = HNCS.notePath(post, settings);

  if (settings.method === "uri") {
    return {
      ok: true,
      method: "uri",
      path,
      markdown,
      uri: HNCS.obsidianUri(post, settings),
    };
  }

  if (!settings.apiKey) {
    return {
      ok: false,
      method: "rest",
      path,
      error: "No Obsidian Local REST API key set. Open the extension options.",
    };
  }
  try {
    const res = await fetch(vaultUrl(settings.restUrl, path), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "text/markdown",
      },
      body: markdown,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        method: "rest",
        path,
        error: `Obsidian responded ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    return { ok: true, method: "rest", path };
  } catch (e) {
    return {
      ok: false,
      method: "rest",
      path,
      error:
        `Could not reach Obsidian at ${settings.restUrl}. Is Obsidian running with ` +
        `the Local REST API plugin enabled? If using https, open that URL in ` +
        `Firefox once and accept the self-signed certificate.`,
    };
  }
}

async function testConnection() {
  const settings = await getSettings();
  try {
    const res = await fetch(`${settings.restUrl.replace(/\/+$/, "")}/`, {
      headers: { Authorization: `Bearer ${settings.apiKey}` },
    });
    const json = await res.json().catch(() => ({}));
    if (json.authenticated) return { ok: true, message: "Connected and authenticated." };
    if (res.ok) return { ok: false, message: "Reached Obsidian, but the API key was rejected." };
    return { ok: false, message: `Obsidian responded ${res.status}.` };
  } catch (e) {
    return {
      ok: false,
      message:
        "Could not connect. Make sure Obsidian is running, the plugin is enabled, " +
        "and (for https) you have accepted the certificate by visiting the URL.",
    };
  }
}

async function handle(msg) {
  switch (msg.type) {
    case "getSaved": {
      const post = await getPost(msg.storyId);
      return { ids: savedIds(post), notes: notesOf(post) };
    }
    case "setNote": {
      const note = String(msg.note || "").replace(/\r/g, "").trim();
      const post = await serial(() => setNote(msg.story, msg.comment, note));
      if (!post) return { ids: [], notes: {} };
      const settings = await getSettings();
      const sync = settings.autoSync ? await syncPost(post, settings) : null;
      return { ids: savedIds(post), notes: notesOf(post), sync };
    }
    case "save":
    case "unsave": {
      const post = await serial(() =>
        msg.type === "save"
          ? saveComments(msg.story, msg.comments)
          : unsaveComments(msg.storyId, msg.ids)
      );
      if (!post) return { ids: [], notes: {} };
      const settings = await getSettings();
      const sync = settings.autoSync ? await syncPost(post, settings) : null;
      return { ids: savedIds(post), notes: notesOf(post), sync };
    }
    case "sync": {
      const post = await getPost(msg.storyId);
      if (!post) return { ok: false, error: "Nothing saved for this post." };
      return syncPost(post);
    }
    case "render": {
      const post = await getPost(msg.storyId);
      if (!post) return { markdown: "" };
      const settings = await getSettings();
      return { markdown: HNCS.renderNote(post, settings), path: HNCS.notePath(post, settings) };
    }
    case "list": {
      return { posts: await listPosts() };
    }
    case "deletePost": {
      await serial(() => browser.storage.local.remove(postKey(msg.storyId)));
      return { ok: true };
    }
    case "testConnection": {
      return testConnection();
    }
    default:
      return { error: `Unknown message ${msg.type}` };
  }
}

browser.runtime.onMessage.addListener((msg) => handle(msg));
