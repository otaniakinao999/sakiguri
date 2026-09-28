/* ===== Sakiguri 負荷試験の計測（AC-28b） =====
   ダッシュボードを開き、読み込みが終わってから貼る。
   A は読み取りだけ。B・C・D は GET のみ（書き込みは一切しない）。

   前回との違い：1往復を「ヘッダ受信 / 本文受信 / パース」の3つに分けて測る。
   前回の「1往復 中央値 104ms」は `await fetch()` の解決まで＝ヘッダ受信までで、
   本文の受信も JSON.parse も含んでいなかった。 */
(async () => {
  const REST = "/rest/v1/";
  const pad = (s, n) => String(s).padEnd(n, " ");
  const num = (v) => (v == null ? "-" : Math.round(v).toLocaleString());
  const mb = (b) => (b / 1024 / 1024).toFixed(1) + " MB";
  const out = [];
  const say = (s) => out.push(s);
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const finish = () => {
    const text = out.join("\n");
    window.__MEASURE = text;
    console.log(text);
    try { if (typeof copy === "function") copy(text); } catch {}
    return text;
  };

  /* ---------- A. アプリ自身の通信（resource timing） ---------- */
  const res = performance.getEntriesByType("resource");
  const rest = res.filter((e) => e.name.includes(REST));
  const nav = performance.getEntriesByType("navigation")[0];

  const tableOf = (url) => (url.split(REST)[1] || "").split("?")[0] || "(不明)";
  const byTable = new Map();
  for (const e of rest) {
    const t = tableOf(e.name);
    const g = byTable.get(t) ?? { n: 0, ms: 0, max: 0, enc: 0, dec: 0 };
    g.n += 1;
    g.ms += e.duration;
    g.max = Math.max(g.max, e.duration);
    g.enc += e.encodedBodySize || 0;
    g.dec += e.decodedBodySize || 0;
    byTable.set(t, g);
  }

  const durs = rest.map((e) => e.duration);
  const firstStart = rest.length ? Math.min(...rest.map((e) => e.startTime)) : null;
  const lastEnd = rest.length ? Math.max(...rest.map((e) => e.responseEnd)) : null;

  say("===== A. アプリ自身の通信（実機・resource timing） =====");
  say(`REST リクエスト総数            ${rest.length}`);
  say(`resource エントリ総数          ${res.length}`);
  if (res.length >= 250) {
    say("");
    say("  ※ **上限250に当たっています。** バッファは古い方を残すので、");
    say("     ここから下の A の数字はすべて「最初の250件ぶん」です。");
    say("     最後の REST 完了 は読み込み完了ではなく、その**下限**です。");
    say("");
  }
  say(`最初の開始 → 最後の完了        ${num(lastEnd - firstStart)} ms`);
  say(`1往復 中央値 / 最大 / 合計     ${num(med(durs))} / ${num(Math.max(...durs))} / ${num(sum(durs))} ms`);
  say("  ※ resource timing の duration は startTime → responseEnd。");
  say("     **本文の受信までを含み、JSON.parse は含まない。**");
  say(`navigation loadEventEnd        ${num(nav?.loadEventEnd)} ms`);
  say(`navigation DOMContentLoaded    ${num(nav?.domContentLoadedEventEnd)} ms`);
  say(`最後の REST 完了               ${num(lastEnd)} ms${res.length >= 250 ? "  ← 下限値" : "  ← データ到着"}`);
  say("");
  say("テーブル別                     件数    合計ms    最大ms   転送量");
  for (const [t, g] of [...byTable].sort((a, b) => b[1].n - a[1].n)) {
    const size = g.enc ? mb(g.enc) : "(取れず)";
    say(`  ${pad(t, 28)} ${pad(g.n, 7)} ${pad(num(g.ms), 9)} ${pad(num(g.max), 8)} ${size}`);
  }
  say("  ※ 転送量が (取れず) なのは Timing-Allow-Origin が無いため。B で実測する。");

  /* ---------- 認証情報 ---------- */
  const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
  const raw = key && localStorage.getItem(key);
  if (!raw) { say(""); say("B: サインイン情報が読めなかったので追試を省略しました。"); return finish(); }
  const sess = JSON.parse(raw.startsWith("base64-") ? atob(raw.slice(7)) : raw);
  const ref = key.replace("sb-", "").replace("-auth-token", "");
  const base = `https://${ref}.supabase.co${REST}`;

  let anon = null;
  for (const s of [...document.querySelectorAll("script[src]")].map((x) => x.src)) {
    const t = await (await fetch(s)).text();
    const m = t.match(/sb_publishable_[A-Za-z0-9_-]+/);
    if (m) { anon = m[0]; break; }
  }
  if (!anon) { say(""); say("B: API キーが読めなかったので追試を省略しました。"); return finish(); }

  const head = (extra) => ({ apikey: anon, Authorization: "Bearer " + sess.access_token, ...extra });
  const asOf = (await (await fetch(base + "settings?select=as_of", { headers: head({}) })).json())[0]?.as_of;
  const url = base + `actuals?select=*&date=gte.${asOf}&order=date.asc%2Cid.asc`;
  const range = (offset) => head({ "Range-Unit": "items", Range: `${offset}-${offset + 999}` });

  /* ---------- B. 1往復を3つに分けて取り切る ---------- */
  say("");
  console.log("B を開始します。10万件なら1分前後かかります…");
  say("===== B. actuals を取り切る。内訳つき（実機・GET のみ・count なし） =====");
  say(`基準日 ${asOf} ／ サインイン ${sess.user?.email ?? "-"}`);

  const tHead = [], tBody = [], tParse = [];
  let offset = 0, pages = 0, rows = 0, bytes = 0, enc = null;
  const bWall0 = performance.now();

  for (let i = 0; i < 500; i++) {
    const t0 = performance.now();
    const r = await fetch(url, { headers: range(offset) });
    const t1 = performance.now();
    /* 圧縮されていなければ、転送量がそのまま本文受信の時間になる */
    if (enc === null) enc = r.headers.get("content-encoding") ?? "(なし)";
    /* `r.json()` を text + JSON.parse に割る。ここでしか分けられない */
    const text = await r.text();
    const t2 = performance.now();
    const got = JSON.parse(text);
    const t3 = performance.now();

    tHead.push(t1 - t0);
    tBody.push(t2 - t1);
    tParse.push(t3 - t2);
    bytes += text.length;
    pages += 1;
    rows += got.length;
    offset += got.length;

    if (pages % 20 === 0) console.log(`  …${pages} 往復 / ${rows} 件`);
    if (got.length === 0 || got.length < 1000) break;
  }
  const bWall = performance.now() - bWall0;

  const h = sum(tHead), b = sum(tBody), p = sum(tParse);
  say("");
  say(`往復回数        ${pages}`);
  say(`取得件数        ${rows.toLocaleString()}`);
  say(`受け取った文字数 ${mb(bytes)}（JSON テキスト。展開後）`);
  say(`Content-Encoding ${enc}   ${enc === "(なし)" ? "← 非圧縮。転送量がそのまま時間になる" : ""}`);
  say(`実効スループット ${(bytes / 1024 / 1024 / (sum(tBody) / 1000)).toFixed(1)} MB/s（展開後の量 ÷ 本文受信の時間）`);
  say(`通し時間        ${num(bWall)} ms`);
  say("");
  say("                    合計ms     中央値ms   割合");
  const row3 = (label, tot, arr) =>
    say(`  ${pad(label, 18)} ${pad(num(tot), 10)} ${pad(num(med(arr)), 10)} ${((tot / bWall) * 100).toFixed(0)}%`);
  row3("ヘッダ受信", h, tHead);
  row3("本文受信", b, tBody);
  row3("JSON.parse", p, tParse);
  say(`  ${pad("上の3つの合計", 18)} ${pad(num(h + b + p), 10)} ${pad("", 10)} ${(((h + b + p) / bWall) * 100).toFixed(0)}%`);
  say("");
  say("読み方：**ヘッダ受信＋本文受信は並列化で縮む。JSON.parse は縮まない。**");
  say("        parse はメインスレッドで直列に走る（これが「床」）。");

  /* ---------- C. 対照：r.json() との差 ---------- */
  say("");
  say("===== C. 対照：`r.json()` と `text()+JSON.parse` の差（3ページ） =====");
  const cJson = [], cSplit = [];
  for (let i = 0; i < 3; i++) {
    const off = i * 1000;
    let t0 = performance.now();
    await (await fetch(url, { headers: range(off) })).json();
    cJson.push(performance.now() - t0);
    t0 = performance.now();
    JSON.parse(await (await fetch(url, { headers: range(off) })).text());
    cSplit.push(performance.now() - t0);
  }
  say(`  r.json()            中央値 ${num(med(cJson))} ms`);
  say(`  text()+JSON.parse   中央値 ${num(med(cSplit))} ms`);
  say("  ※ 差が大きければ B の parse は過大評価。20MBの中間文字列を作るぶん");
  say("     text()+parse のほうが不利なので、B の parse は**上限**として読む。");

  /* ---------- D. 並列化で縮むのはどこか（8ページ） ---------- */
  say("");
  say("===== D. 並列化の効き（8ページ・本文受信まで） =====");
  const eight = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => i * 1000);
  let t0 = performance.now();
  for (const off of eight) await (await fetch(url, { headers: range(off) })).text();
  const serial = performance.now() - t0;
  t0 = performance.now();
  await Promise.all(eight.map((off) => fetch(url, { headers: range(off) }).then((r) => r.text())));
  const par = performance.now() - t0;
  say(`  直列 8ページ        ${num(serial)} ms`);
  say(`  並列 8ページ        ${num(par)} ms   （${(serial / par).toFixed(1)}倍）`);
  say("  ※ parse を含めていない。通信だけがどれだけ縮むかを見る。");

  return finish();
})();
