/* ===== AC-34：重複と欠落が無いことを確かめる =====
   id だけを取り切って数える。GET のみ。約100往復、20〜40秒。 */
(async () => {
  const out = [];
  const say = (s) => out.push(s);

  const key = Object.keys(localStorage).find((k) => k.includes("auth-token"));
  const raw = localStorage.getItem(key);
  const sess = JSON.parse(raw.startsWith("base64-") ? atob(raw.slice(7)) : raw);
  const ref = key.replace("sb-", "").replace("-auth-token", "");
  const base = `https://${ref}.supabase.co/rest/v1/`;

  let anon = null;
  for (const s of [...document.querySelectorAll("script[src]")].map((x) => x.src)) {
    const t = await (await fetch(s)).text();
    const m = t.match(/sb_publishable_[A-Za-z0-9_-]+/);
    if (m) { anon = m[0]; break; }
  }
  const head = (extra) => ({ apikey: anon, Authorization: "Bearer " + sess.access_token, ...extra });

  const asOf = (await (await fetch(base + "settings?select=as_of", { headers: head({}) })).json())[0]?.as_of;

  /* fetchAll と同じ並び（date 昇順 → id 昇順）で id だけ取る */
  const url = base + `actuals?select=id,date&date=gte.${asOf}&order=date.asc%2Cid.asc`;
  const seen = new Set();
  const dup = [];
  let offset = 0, pages = 0, rows = 0, total = null, outOfOrder = 0;
  let prev = null;

  for (let i = 0; i < 500; i++) {
    const r = await fetch(url, {
      headers: head({
        "Range-Unit": "items",
        Range: `${offset}-${offset + 999}`,
        ...(i === 0 ? { Prefer: "count=exact" } : {}),
      }),
    });
    if (i === 0) {
      const cr = r.headers.get("content-range");
      if (cr) total = Number(cr.split("/")[1]);
    }
    const got = await r.json();
    for (const row of got) {
      if (seen.has(row.id)) dup.push(row.id);
      seen.add(row.id);
      /* 並びが崩れていないか。崩れていると分割の境界で取りこぼす */
      const k = row.date + "|" + row.id;
      if (prev !== null && k < prev) outOfOrder += 1;
      prev = k;
    }
    pages += 1;
    rows += got.length;
    offset += got.length;
    if (pages % 10 === 0) console.log(`  …${pages} 往復 / ${rows} 件`);
    if (got.length === 0) break;
    if (total !== null && rows >= total) break;
  }

  say("===== AC-34 重複と欠落 =====");
  say(`総件数（サーバー申告）  ${total?.toLocaleString() ?? "-"}`);
  say(`受け取った行数          ${rows.toLocaleString()}`);
  say(`ユニークな id           ${seen.size.toLocaleString()}`);
  say(`重複した id             ${dup.length}${dup.length ? "  例: " + dup.slice(0, 3).join(", ") : ""}`);
  say(`欠落（総件数 − ユニーク）${(total ?? rows) - seen.size}`);
  say(`並びが逆転した箇所      ${outOfOrder}`);
  say(`往復回数                ${pages}`);
  say("");
  say(
    dup.length === 0 && seen.size === (total ?? rows) && outOfOrder === 0
      ? "重複なし・欠落なし・並びの逆転なし。"
      : "**不一致あり。** 上の数字をそのまま報告してください。",
  );

  const text = out.join("\n");
  window.__DUP = text;
  console.log(text);
  try { if (typeof copy === "function") copy(text); } catch {}
  return text;
})();
