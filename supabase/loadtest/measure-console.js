/* ===== Sakiguri 負荷試験の計測（AC-28b / AC-34） =====
   ダッシュボードを開き、読み込みが終わってから貼る。
   A は読み取りだけ。B は GET を約200回投げる（書き込みは一切しない）。 */
(async () => {
  const REST = "/rest/v1/";
  const pad = (s, n) => String(s).padEnd(n, " ");
  const num = (v) => (v == null ? "-" : Math.round(v).toLocaleString());
  const out = [];
  const say = (s) => out.push(s);
  const finish = () => {
    const text = out.join("\n");
    window.__MEASURE = text;
    console.log(text);
    /* DevTools ならクリップボードに載せる */
    try { if (typeof copy === "function") copy(text); } catch {}
    return text;
  };

  /* ---------- A. アプリ自身の通信（resource timing） ---------- */
  const res = performance.getEntriesByType("resource");
  const rest = res.filter((e) => e.name.includes(REST));
  const nav = performance.getEntriesByType("navigation")[0];

  const tableOf = (url) => {
    const m = url.split(REST)[1] || "";
    return m.split("?")[0] || "(不明)";
  };
  const byTable = new Map();
  for (const e of rest) {
    const t = tableOf(e.name);
    const g = byTable.get(t) ?? { n: 0, ms: 0, max: 0 };
    g.n += 1;
    g.ms += e.duration;
    g.max = Math.max(g.max, e.duration);
    byTable.set(t, g);
  }

  const durs = rest.map((e) => e.duration).sort((a, b) => a - b);
  const med = (a) => (a.length ? a[Math.floor(a.length / 2)] : null);
  const firstStart = rest.length ? Math.min(...rest.map((e) => e.startTime)) : null;
  const lastEnd = rest.length ? Math.max(...rest.map((e) => e.responseEnd)) : null;

  say("===== A. アプリ自身の通信（実機・resource timing） =====");
  say(`REST リクエスト総数            ${rest.length}`);
  say(`resource エントリ総数          ${res.length}${res.length >= 250 ? "  ※250以上。取りこぼしの可能性あり（下の注記）" : ""}`);
  say(`最初の開始 → 最後の完了        ${num(lastEnd - firstStart)} ms`);
  say(`1往復 中央値 / 最大 / 合計     ${num(med(durs))} / ${num(durs.at(-1))} / ${num(durs.reduce((a, b) => a + b, 0))} ms`);
  say(`navigation loadEventEnd        ${num(nav?.loadEventEnd)} ms`);
  say(`navigation DOMContentLoaded    ${num(nav?.domContentLoadedEventEnd)} ms`);
  say(`最後の REST 完了（データ到着）  ${num(lastEnd)} ms  ← 実質の「読み込み完了」`);
  say("");
  say("テーブル別                     件数    合計ms    最大ms");
  for (const [t, g] of [...byTable].sort((a, b) => b[1].n - a[1].n)) {
    say(`  ${pad(t, 28)} ${pad(g.n, 7)} ${pad(num(g.ms), 9)} ${num(g.max)}`);
  }
  say("");
  say("注記：`Prefer: count=exact` はリクエストヘッダなので resource timing からは見えない。");
  say("      件数は B で実測する。");

  /* ---------- B. 追試。count=exact の有無で取り直す ---------- */
  const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
  const raw = key && localStorage.getItem(key);
  if (!raw) {
    say("");
    say("B: サインイン情報が読めなかったので追試を省略しました。");
    return finish();
  }
  const sess = JSON.parse(raw.startsWith("base64-") ? atob(raw.slice(7)) : raw);
  const ref = key.replace("sb-", "").replace("-auth-token", "");
  const base = `https://${ref}.supabase.co${REST}`;

  let anon = null;
  for (const s of [...document.querySelectorAll("script[src]")].map((x) => x.src)) {
    const t = await (await fetch(s)).text();
    const m = t.match(/sb_publishable_[A-Za-z0-9_-]+/);
    if (m) { anon = m[0]; break; }
  }
  if (!anon) {
    say("");
    say("B: API キーが読めなかったので追試を省略しました。");
    return finish();
  }

  const head = (extra) => ({
    apikey: anon,
    Authorization: "Bearer " + sess.access_token,
    ...extra,
  });

  /* AC-49 の確認材料。画面の数字と突き合わせる */
  const st = await fetch(base + "settings?select=as_of", { headers: head({}) });
  const asOf = (await st.json())[0]?.as_of;

  /** 1テーブルを fetchAll と同じ形で取り切る。count の有無だけ変える */
  const page = async (withCount) => {
    const url =
      base +
      `actuals?select=*&date=gte.${asOf}&order=date.asc%2Cid.asc`;
    let offset = 0, pages = 0, rows = 0, total = null;
    const times = [];
    for (let i = 0; i < 500; i++) {
      const t0 = performance.now();
      const r = await fetch(url, {
        headers: head({
          "Range-Unit": "items",
          Range: `${offset}-${offset + 999}`,
          ...(withCount ? { Prefer: "count=exact" } : {}),
        }),
      });
      times.push(performance.now() - t0);
      const cr = r.headers.get("content-range");
      if (cr && total === null && withCount) total = Number(cr.split("/")[1]);
      const got = await r.json();
      pages += 1;
      rows += got.length;
      offset += got.length;
      if (pages % 10 === 0) console.log(`  …${pages} 往復 / ${rows} 件`);
      if (got.length === 0) break;
      if (total !== null && rows >= total) break;
      if (!withCount && got.length < 1000) break;
    }
    times.sort((a, b) => a - b);
    return { pages, rows, total, times };
  };

  say("");
  console.log("B を開始します。10万件なら往復が多いので1〜2分かかることがあります…");
  say("===== B. 追試：actuals を取り切る（実機・GET のみ） =====");
  say(`基準日 ${asOf} ／ サインイン ${sess.user?.email ?? "-"}`);
  for (const withCount of [true, false]) {
    const t0 = performance.now();
    const r = await page(withCount);
    const wall = performance.now() - t0;
    say("");
    say(`${withCount ? "count=exact あり（いまの実装）" : "count なし"}`);
    say(`  往復回数        ${r.pages}`);
    say(`  取得件数        ${r.rows}${r.total !== null ? ` / 総件数 ${r.total}` : ""}`);
    say(`  通し時間        ${num(wall)} ms`);
    say(`  1往復 中央値    ${num(med(r.times))} ms`);
    say(`  1往復 最大      ${num(r.times.at(-1))} ms`);
  }
  say("");
  say("count=exact は毎ページ付いているので、往復回数ぶん COUNT が走る。");

  return finish();
})();
