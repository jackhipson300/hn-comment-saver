/* global browser */
const $ = (s) => document.querySelector(s);

function status(msg, isError) {
  const el = $("#status");
  el.textContent = msg || "";
  el.classList.toggle("error", !!isError);
}

async function send(post) {
  status("Sending…");
  const res = await browser.runtime.sendMessage({ type: "sync", storyId: post.id });
  if (!res.ok) return status(res.error, true);
  if (res.method === "uri") {
    await navigator.clipboard.writeText(res.markdown);
    window.location.href = res.uri;
    return status(`Copied note and opened Obsidian → ${res.path}`);
  }
  status(`Written to ${res.path}`);
}

async function copy(post) {
  const res = await browser.runtime.sendMessage({ type: "render", storyId: post.id });
  await navigator.clipboard.writeText(res.markdown);
  status("Markdown copied to clipboard.");
}

async function remove(post) {
  if (!confirm(`Forget saved comments for "${post.title}"?\n(The Obsidian note is not deleted.)`)) return;
  await browser.runtime.sendMessage({ type: "deletePost", storyId: post.id });
  status("Removed.");
  render();
}

function button(label, cls, fn) {
  const b = document.createElement("button");
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener("click", () => fn().catch((e) => status(e.message, true)));
  return b;
}

async function render() {
  const { posts } = await browser.runtime.sendMessage({ type: "list" });
  const ul = $("#posts");
  ul.textContent = "";
  $("#empty").hidden = posts.length > 0;
  for (const post of posts) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.className = "title";
    a.href = `https://news.ycombinator.com/item?id=${post.id}`;
    a.target = "_blank";
    a.textContent = post.title;
    const n = Object.keys(post.comments || {}).length;
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${n} comment${n === 1 ? "" : "s"} · updated ${new Date(post.updated).toLocaleString()}`;
    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(
      button("Send to Obsidian", "primary", () => send(post)),
      button("Copy Markdown", "", () => copy(post)),
      button("Forget", "danger", () => remove(post))
    );
    li.append(a, meta, actions);
    ul.appendChild(li);
  }
}

$("#options").addEventListener("click", (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});

render().catch((e) => status(e.message, true));
