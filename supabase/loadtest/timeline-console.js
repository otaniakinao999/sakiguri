/* ===== 読み込みが何回走ったかを時系列で見る =====
   ダッシュボードを読み込んだ直後に貼る。読み取りだけ。リクエストは投げない。 */
(() => {
  const out = [];
  const say = (s) => out.push(s);
  const ms = (v) => String(Math.round(v)).padStart(7, " ");

  const res = performance.getEntriesByType("resource");
  const nav = performance.getEntriesByType("navigation")[0];

  /* 小さいテーブルは1回の読み込みにつき1往復。開始時刻が読み込みの回数を表す */
  const SMALL = ["settings", "accounts", "recurring_items", "oneoff_items", "overrides"];
  const nameOf = (u) => {
    if (u.includes("/auth/v1/")) return "auth:" + (u.split("/auth/v1/")[1] || "").split("?")[0];
    if (u.includes("/rest/v1/")) return (u.split("/rest/v1/")[1] || "").split("?")[0];
    return null;
  };

  const rows = res
    .map((e) => ({ n: nameOf(e.name), s: e.startTime, d: e.duration, e: e.responseEnd }))
    .filter((r) => r.n !== null)
    .sort((a, b) => a.s - b.s);

  say("===== 読み込みの時系列 =====");
  say(`navigation DOMContentLoaded ${ms(nav?.domContentLoadedEventEnd)} ms`);
  say(`navigation loadEventEnd     ${ms(nav?.loadEventEnd)} ms`);
  say("");
  say("小さいテーブルと認証だけを時刻順に並べる（actuals は件数だけ後述）");
  say("   開始ms    所要ms  対象");
  for (const r of rows) {
    if (r.n === "actuals") continue;
    say(`${ms(r.s)}  ${ms(r.d)}  ${r.n}`);
  }

  const acts = rows.filter((r) => r.n === "actuals");
  say("");
  say(`actuals の往復        ${acts.length} 回`);
  if (acts.length) {
    say(`  最初の開始          ${ms(acts[0].s)} ms`);
    say(`  最後の完了          ${ms(Math.max(...acts.map((a) => a.e)))} ms`);
    /* 500ms 以上あいたところを「かたまりの切れ目」とみなす */
    let groups = 1, last = acts[0].e;
    for (const a of acts.slice(1)) {
      if (a.s - last > 500) groups += 1;
      last = Math.max(last, a.e);
    }
    say(`  500ms 以上の切れ目で数えたかたまり  ${groups}`);
  }

  say("");
  say("小さいテーブルの往復回数（= 読み込みが走った回数）");
  for (const t of SMALL) {
    const n = rows.filter((r) => r.n === t).length;
    const at = rows.filter((r) => r.n === t).map((r) => Math.round(r.s)).join(", ");
    say(`  ${t.padEnd(18)} ${String(n).padStart(2)} 回   開始 ${at} ms`);
  }

  const auth = rows.filter((r) => r.n.startsWith("auth:"));
  say("");
  say(`認証まわりのリクエスト ${auth.length} 件`);
  for (const a of auth) say(`  ${ms(a.s)}  ${a.n}`);
  say("  ※ token?grant_type=refresh_token があればトークン更新が走っている");

  /* 保存されているセッションの有効期限。更新が近かったかを見る */
  try {
    const k = Object.keys(localStorage).find((x) => x.includes("auth-token"));
    const raw = localStorage.getItem(k);
    const s = JSON.parse(raw.startsWith("base64-") ? atob(raw.slice(7)) : raw);
    const left = s.expires_at * 1000 - Date.now();
    say("");
    say(`セッションの残り有効時間 ${Math.round(left / 1000)} 秒`);
  } catch {
    say("");
    say("セッションの有効期限は読めませんでした");
  }

  say("");
  say(`resource エントリ総数 ${res.length}${res.length >= 250 ? "  ※上限に当たっているので回数は下限値" : ""}`);

  const text = out.join("\n");
  window.__TIMELINE = text;
  console.log(text);
  try { if (typeof copy === "function") copy(text); } catch {}
  return text;
})();
