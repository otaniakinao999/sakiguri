import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, Legend,
} from "recharts";

/* ========================= 基本ユーティリティ ========================= */
const pad = (n) => String(n).padStart(2, "0");
const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYMD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const lastDayOf = (y, m) => new Date(y, m + 1, 0).getDate();
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const yen = (n) => (n < 0 ? "−" : "") + "¥" + Math.abs(Math.round(n)).toLocaleString("ja-JP");
const yenPlain = (n) => Math.round(n).toLocaleString("ja-JP");
const man = (n) => {
  const a = Math.abs(n);
  if (a >= 100000000) return (n / 100000000).toFixed(2) + "億";
  if (a >= 10000) return (n / 10000).toFixed(a >= 1000000 ? 0 : 1) + "万";
  return String(Math.round(n));
};
const mdLabel = (s) => (String(s).length === 7 ? `${Number(s.slice(5, 7))}月` : `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`);
const uid = () => Math.random().toString(36).slice(2, 9);
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(String(v).replace(/[^\d]/g, "") || 0)));

/* ========================= マスタ ========================= */
const CATS = {
  income: ["事業売上", "給与・報酬", "その他収入"],
  fixed: ["住居費", "通信費", "保険料", "サブスク", "社会保険料", "税金", "事務所費", "ツール・システム", "借入返済"],
  variable: ["食費", "水道光熱費", "日用品", "交通費", "交際費", "医療費", "教育・教養", "外注費", "広告宣伝費", "消耗品費", "旅費交通費", "その他"],
};
const allCats = [...CATS.income, ...CATS.fixed, ...CATS.variable];
const catList = (e) => (e.type === "income" ? CATS.income : e.costType === "fixed" ? CATS.fixed : CATS.variable);
const groupOf = (e) => (e.type === "income" ? "income" : e.costType === "fixed" ? "fixed" : "variable");
const GROUP_LABEL = { income: "収入", fixed: "固定費", variable: "変動費" };
const ratioOf = (e) => Math.max(0, Math.min(100, e.bizRatio ?? 0));
const share = (e, scope) =>
  scope === "business" ? (e.amount * ratioOf(e)) / 100
    : scope === "household" ? (e.amount * (100 - ratioOf(e))) / 100
      : e.amount;

/* ========================= カードの引き落とし日 ========================= */
const isCard = (a) => a && a.kind === "card";
const paydayOf = (card, y, mIdx) => toYMD(new Date(y, mIdx, Math.min(card.payDay, lastDayOf(y, mIdx))));
function settleDateOf(card, dateStr) {
  const d = parseYMD(dateStr);
  const closeIdx = d.getDate() <= card.closingDay ? d.getMonth() : d.getMonth() + 1;
  const p = new Date(d.getFullYear(), closeIdx + (card.payMonthOffset ?? 1), 1);
  return paydayOf(card, p.getFullYear(), p.getMonth());
}
function firstPaydayAfter(card, ymd) {
  const d = parseYMD(ymd);
  for (let i = 0; i < 4; i++) {
    const p = new Date(d.getFullYear(), d.getMonth() + i, 1);
    const day = paydayOf(card, p.getFullYear(), p.getMonth());
    if (day >= ymd) return day;
  }
  return ymd;
}

/* ========================= 初期データ ========================= */
const R = (id, name, type, costType, category, amount, day, bizRatio, accountId, months = null, extra = {}) =>
  ({ id, name, type, costType, category, amount, day, bizRatio, accountId, months, active: true, ...extra });

function seedBase() {
  return {
    version: 2,
    asOf: "2026-04-01",
    reserveLine: 600000,
    accounts: [
      { id: "a1", name: "生活口座", kind: "bank", balance: 380000 },
      { id: "a2", name: "事業口座", kind: "bank", balance: 1150000 },
      { id: "c1", name: "メインカード", kind: "card", balance: 142000, closingDay: 15, payMonthOffset: 1, payDay: 10, settleAccountId: "a1" },
    ],
    recurring: [
      R("rh1", "家賃", "expense", "fixed", "住居費", 120000, 27, 25, "a1"),
      R("rh2", "通信費（携帯・回線）", "expense", "fixed", "通信費", 9800, 25, 40, "c1"),
      R("rh3", "生命保険", "expense", "fixed", "保険料", 14000, 27, 0, "a1"),
      R("rh4", "サブスク各種", "expense", "fixed", "サブスク", 4300, 10, 30, "c1"),
      R("rh5", "国民健康保険", "expense", "fixed", "社会保険料", 38200, 31, 0, "a1"),
      R("rh6", "国民年金", "expense", "fixed", "社会保険料", 17510, 31, 0, "a1"),
      R("rh7", "住民税", "expense", "fixed", "税金", 62000, 31, 0, "a1", [6, 8, 10, 1]),
      R("rh8", "食費", "expense", "variable", "食費", 68000, 15, 0, "c1"),
      R("rh9", "水道光熱費", "expense", "variable", "水道光熱費", 18000, 20, 20, "c1"),
      R("rh10", "日用品", "expense", "variable", "日用品", 14000, 15, 0, "c1"),
      R("rh11", "交通費", "expense", "variable", "交通費", 9000, 15, 50, "c1"),
      R("rh12", "交際費・娯楽", "expense", "variable", "交際費", 22000, 20, 0, "c1"),
      R("rb1", "A社 業務委託料", "income", null, "事業売上", 450000, 25, 100, "a2"),
      R("rb2", "B社 顧問料", "income", null, "事業売上", 180000, 31, 100, "a2"),
      R("rb3", "事務所家賃", "expense", "fixed", "事務所費", 55000, 27, 100, "a2"),
      R("rb4", "クラウド・SaaS", "expense", "fixed", "ツール・システム", 13200, 5, 100, "c1"),
      R("rb5", "外注費", "expense", "variable", "外注費", 85000, 31, 100, "a2"),
      R("rb6", "広告費", "expense", "variable", "広告宣伝費", 30000, 10, 100, "a2"),
      R("rt1", "生活費振替（事業主貸）", "transfer", null, null, 380000, 26, 0, "a2", null, { toAccountId: "a1" }),
    ],
    oneoffs: [
      { id: "o1", date: "2026-06-10", name: "冷蔵庫買い替え", type: "expense", costType: "variable", category: "日用品", amount: 185000, bizRatio: 0, accountId: "c1" },
      { id: "o2", date: "2026-09-15", name: "PC買い替え", type: "expense", costType: "variable", category: "消耗品費", amount: 268000, bizRatio: 80, accountId: "c1" },
      { id: "o3", date: "2026-10-20", name: "C社 スポット案件", type: "income", costType: null, category: "事業売上", amount: 600000, bizRatio: 100, accountId: "a2" },
      { id: "o4", date: "2026-11-30", name: "所得税 予定納税（1期）", type: "expense", costType: "fixed", category: "税金", amount: 152000, bizRatio: 0, accountId: "a1" },
      { id: "o5", date: "2026-12-28", name: "年末年始・帰省", type: "expense", costType: "variable", category: "交際費", amount: 130000, bizRatio: 0, accountId: "c1" },
      { id: "o6", date: "2027-01-12", name: "業務ソフト年間契約", type: "expense", costType: "fixed", category: "ツール・システム", amount: 96000, bizRatio: 100, accountId: "a2" },
      { id: "o7", date: "2027-02-26", name: "所得税 予定納税（2期）", type: "expense", costType: "fixed", category: "税金", amount: 152000, bizRatio: 0, accountId: "a1" },
      { id: "o8", date: "2027-03-16", name: "確定申告 納付", type: "expense", costType: "fixed", category: "税金", amount: 218000, bizRatio: 0, accountId: "a1" },
    ],
    actuals: [],
    overrides: {},
  };
}

function jitter(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return ((h % 2401) - 1200) / 10000;
}

function seedData(today) {
  const base = seedBase();
  const fc = buildForecast(base, parseYMD(base.asOf), addDays(today, -1));
  base.actuals = fc.map((f) => {
    const vary = f.type === "expense" && f.costType === "variable";
    const amt = vary ? Math.round((f.amount * (1 + jitter(f.key))) / 100) * 100 : f.amount;
    return { ...f, id: uid(), amount: amt, src: "actual" };
  });
  const skipKey = base.actuals.map((a) => a.key).filter((k) => k && k.startsWith("r:rh5:")).pop();
  if (skipKey) {
    const d = parseYMD(skipKey.slice(-10));
    base.overrides = { [skipKey]: { date: toYMD(addDays(d, 14)), note: "資金繰りの都合で延期" } };
    base.actuals = base.actuals.filter((a) => a.key !== skipKey);
  }
  return base;
}

/* ========================= 予定の展開 ========================= */
function expandRecurring(r, from, to) {
  if (!r.active) return [];
  const out = [];
  let cur = new Date(from.getFullYear(), from.getMonth(), 1);
  const guard = new Date(to.getFullYear(), to.getMonth() + 1, 1);
  while (cur <= guard) {
    const y = cur.getFullYear(), m = cur.getMonth();
    if (!r.months || r.months.includes(m + 1)) {
      const d = new Date(y, m, Math.min(r.day, lastDayOf(y, m)));
      out.push({
        key: `r:${r.id}:${toYMD(d)}`, date: toYMD(d), name: r.name, type: r.type,
        costType: r.costType, category: r.category, amount: r.amount, bizRatio: r.bizRatio,
        accountId: r.accountId, toAccountId: r.toAccountId, src: "recurring", srcId: r.id,
      });
    }
    cur = addMonths(cur, 1);
  }
  return out;
}

function buildForecast(data, from, to) {
  const ov = data.overrides || {};
  const raw = [
    ...data.recurring.flatMap((r) => expandRecurring(r, from, to)),
    ...data.oneoffs.map((o) => ({ ...o, key: `o:${o.id}`, src: "oneoff", srcId: o.id })),
  ];
  const f = toYMD(from), t = toYMD(to);
  return raw
    .map((e) => {
      const o = ov[e.key];
      if (!o) return e;
      if (o.skipped) return null;
      return { ...e, date: o.date || e.date, amount: o.amount ?? e.amount, ov: o, origDate: e.date };
    })
    .filter((e) => e && e.date >= f && e.date <= t)
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.name).localeCompare(String(b.name)));
}

/* ========================= 残高エンジン（カード引落ラグ込み） ========================= */
const signed = (e) => (e.type === "income" ? e.amount : e.type === "expense" ? -e.amount : 0);

function toCashEvents(events, accounts, asOf) {
  const accById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const cash = [];
  const buckets = new Map();
  events.forEach((e) => {
    const acc = accById[e.accountId];
    if (isCard(acc) && e.type !== "transfer") {
      const sd = settleDateOf(acc, e.date);
      const k = `${acc.id}|${sd}`;
      buckets.set(k, (buckets.get(k) || 0) - signed(e));
    } else cash.push(e);
  });
  accounts.filter(isCard).forEach((c) => {
    if (!c.balance) return;
    const k = `${c.id}|${firstPaydayAfter(c, asOf)}`;
    buckets.set(k, (buckets.get(k) || 0) + c.balance);
  });
  const settlements = [...buckets.entries()]
    .filter(([, amt]) => Math.round(amt) !== 0)
    .map(([k, amt]) => {
      const [cardId, date] = k.split("|");
      const card = accById[cardId];
      return {
        key: `s:${k}`, date, name: `${card.name} 引落`, type: amt >= 0 ? "expense" : "income",
        costType: null, category: null, amount: Math.abs(amt), bizRatio: 0,
        accountId: card.settleAccountId, cardId, src: "settle",
      };
    });
  return [...cash, ...settlements].sort((a, b) => a.date.localeCompare(b.date));
}

const acctDelta = (e, id) => {
  if (e.type === "transfer") return e.accountId === id ? -e.amount : e.toAccountId === id ? e.amount : 0;
  if (e.accountId !== id) return 0;
  return e.type === "income" ? e.amount : -e.amount;
};

function buildSeries(data, forecast, from, to, today) {
  const matched = new Set(data.actuals.filter((a) => a.key).map((a) => a.key));
  const unmatchedFc = forecast.filter((f) => !matched.has(f.key));
  const projRaw = [...data.actuals, ...unmatchedFc];

  const projCash = toCashEvents(projRaw, data.accounts, data.asOf);
  const actCash = toCashEvents(data.actuals, data.accounts, data.asOf);

  const cashAccts = data.accounts.filter((a) => !isCard(a));
  const cards = data.accounts.filter(isCard);
  const ids = cashAccts.map((a) => a.id);

  const bucket = new Map();
  const touch = (d) => {
    if (!bucket.has(d)) bucket.set(d, {
      proj: 0, act: 0,
      acc: Object.fromEntries(ids.map((i) => [i, 0])),
      card: Object.fromEntries(cards.map((c) => [c.id, 0])),
    });
    return bucket.get(d);
  };
  projCash.forEach((e) => {
    const b = touch(e.date);
    ids.forEach((i) => { const d = acctDelta(e, i); b.proj += d; b.acc[i] += d; });
  });
  actCash.forEach((e) => { const b = touch(e.date); ids.forEach((i) => (b.act += acctDelta(e, i))); });
  projRaw.forEach((e) => {
    const acc = data.accounts.find((a) => a.id === e.accountId);
    if (isCard(acc) && e.type !== "transfer") touch(e.date).card[acc.id] -= signed(e);
  });
  projCash.filter((e) => e.src === "settle").forEach((e) => { touch(e.date).card[e.cardId] -= e.amount; });

  const base = cashAccts.reduce((s, a) => s + a.balance, 0);
  const run = Object.fromEntries(cashAccts.map((a) => [a.id, a.balance]));
  const cardRun = Object.fromEntries(cards.map((c) => [c.id, c.balance || 0]));
  let proj = base, act = base;
  const lastActual = data.actuals.reduce((m, a) => (a.date > m ? a.date : m), data.asOf);
  const actEnd = lastActual > toYMD(today) ? lastActual : toYMD(today);

  const rows = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
    const k = toYMD(d);
    const b = bucket.get(k);
    if (b) {
      proj += b.proj; act += b.act;
      ids.forEach((i) => (run[i] += b.acc[i]));
      cards.forEach((c) => (cardRun[c.id] += b.card[c.id]));
    }
    const row = { date: k, proj, act: k <= actEnd ? act : null };
    ids.forEach((i) => (row["acc_" + i] = run[i]));
    cards.forEach((c) => (row["card_" + c.id] = cardRun[c.id]));
    rows.push(row);
  }
  return { rows, unmatchedFc, actEnd, projCash, actCash, projRaw };
}

/** 月次資金繰り表 */
function monthlyCashflow(series, from, to) {
  const months = [];
  for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= to; d = addMonths(d, 1)) {
    months.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  }
  const agg = {};
  series.projCash.forEach((e) => {
    const ym = e.date.slice(0, 7);
    agg[ym] = agg[ym] || { in: 0, out: 0 };
    if (e.type === "income") agg[ym].in += e.amount;
    else if (e.type === "expense") agg[ym].out += e.amount;
  });
  let prev = null;
  return months.map((ym) => {
    const days = series.rows.filter((r) => r.date.startsWith(ym));
    if (!days.length) return null;
    const inn = agg[ym]?.in || 0, out = agg[ym]?.out || 0;
    const close = days[days.length - 1].proj;
    const open = prev == null ? close - inn + out : prev;
    const low = days.reduce((m, r) => Math.min(m, r.proj), Infinity);
    prev = close;
    return { ym, open, in: inn, out, net: inn - out, close, low, lowDate: days.find((r) => r.proj === low)?.date };
  }).filter(Boolean);
}

/* P/L集計（家事按分あり） */
function aggregate(events, scope) {
  const m = {};
  events.forEach((e) => {
    if (e.type === "transfer" || e.src === "settle") return;
    const v = share(e, scope);
    if (!v) return;
    const ym = e.date.slice(0, 7), g = groupOf(e);
    m[ym] = m[ym] || { income: {}, fixed: {}, variable: {} };
    m[ym][g][e.category] = (m[ym][g][e.category] || 0) + v;
  });
  return m;
}

/* ========================= CSV ========================= */
function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
function normDate(s) {
  const t = String(s).trim().replace(/["']/g, "");
  let m = t.match(/^(\d{4})[/\-年.](\d{1,2})[/\-月.](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
const normAmt = (s) => {
  const t = String(s).replace(/[¥,、\s円"]/g, "").replace(/[▲△]/, "-");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
function detectColumns(rows) {
  const head = rows[0] || [];
  const find = (re) => head.findIndex((h) => re.test(String(h)));
  let date = find(/日付|年月日|取引日|利用日|ご利用日|日時/);
  let name = find(/摘要|内容|お取引内容|利用店名|ご利用先|店名|備考|明細/);
  const inc = find(/入金|お預り|お預入|預入/);
  const out = find(/出金|お支払|お引出|引出|支払金額/);
  let amt = find(/金額/);
  if (date < 0) date = head.findIndex((c) => normDate(c));
  if (amt < 0 && inc < 0 && out < 0) {
    const nums = head.map((c, i) => [c, i]).filter(([c]) => normAmt(c) !== null).map(([, i]) => i);
    amt = nums.length ? nums[nums.length - 1] : -1;
  }
  if (name < 0) name = head.findIndex((c, i) => i !== date && normAmt(c) === null && String(c).trim() !== "");
  const hasHeader = !normDate(head[date] ?? "");
  return { date: Math.max(date, 0), name: Math.max(name, 0), inc, out, amt, sign: "outMinus", hasHeader };
}
function guessFromHistory(name, data) {
  const pool = [...data.recurring, ...data.oneoffs, ...data.actuals];
  const n = String(name);
  for (const p of pool) {
    if (!p.name) continue;
    const k = String(p.name).replace(/[（(].*?[）)]/g, "").trim().slice(0, 4);
    if (k.length >= 2 && n.includes(k)) return p;
  }
  return null;
}

/* ========================= スタイル ========================= */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&family=Cormorant+Garamond:wght@600;700&family=Noto+Serif+JP:wght@400;600&display=swap');

/* ============================================================
   Design tokens ── Vastra Design System
   1.2 Primitive Colors / 1.3 Semantic Colors / 2 Typography / 3 Spacing
   ============================================================ */
:root{
  /* --- primitive: blue --- */
  --blue-100:#065D63; --blue-090:#1F6E73; --blue-070:#518E92; --blue-050:#82AEB1;
  --blue-030:#B4CED0; --blue-015:#DAE7E8; --blue-010:#E6EEEF;
  /* --- primitive: green --- */
  --green-100:#06631E; --green-090:#1F7335; --green-070:#519262; --green-050:#82B18E;
  --green-030:#B4D0BB; --green-015:#DAE8DE; --green-010:#E6EFE8;
  /* --- primitive: purple --- */
  --purple-100:#63063E; --purple-090:#731F52; --purple-070:#925178; --purple-050:#B1829E;
  --purple-030:#D0B4C5; --purple-015:#E8DAE2; --purple-010:#EFE6EB;
  /* --- primitive: lightblue --- */
  --lightblue-100:#068891; --lightblue-090:#1F949C; --lightblue-070:#51ACB3;
  --lightblue-050:#82C3C8; --lightblue-030:#B4DBDE; --lightblue-015:#DAEDEF; --lightblue-010:#E6F3F4;
  /* --- primitive: lightgreen --- */
  --lightgreen-100:#069149; --lightgreen-090:#1F9C5C; --lightgreen-070:#51B380;
  --lightgreen-030:#B4DEC8; --lightgreen-015:#DAEFE4; --lightgreen-010:#E6F4EC;
  /* --- primitive: lightpurple --- */
  --lightpurple-100:#91066E; --lightpurple-090:#9C1F7D; --lightpurple-070:#B3519A;
  --lightpurple-030:#D3A7C8; --lightpurple-015:#EFDAEA; --lightpurple-010:#F4E6F0;
  /* --- primitive: graytone --- */
  --gray-100:#333333; --gray-090:#484848; --gray-070:#717171; --gray-050:#999999;
  --gray-030:#C1C1C1; --gray-015:#E1E1E1; --gray-010:#EAEAEA;
  --base-black:#111111; --base-white:#FFFFFF; --thin-gray:#EEEEEE;

  /* --- semantic: object --- */
  --object-base-high:var(--gray-100);
  --object-base-mid:var(--gray-070);
  --object-base-low:var(--gray-030);
  --object-base-high-inverse:var(--base-white);
  --object-base-mid-inverse:var(--blue-030);
  --object-accent-dim:var(--blue-100);
  --object-accent-bright:var(--lightblue-100);
  --object-error-dim:var(--purple-100);
  --object-error-bright:var(--lightpurple-100);
  --object-caution-dim:var(--green-100);
  --object-caution-bright:var(--lightgreen-100);
  --object-success-dim:var(--blue-100);
  --object-success-bright:var(--lightblue-100);

  /* --- semantic: surface --- */
  --surface-base-primary:var(--base-white);
  --surface-base-secondary:var(--thin-gray);
  --surface-base-primary-inverse:var(--blue-100);
  --surface-overlay-hoverd:var(--gray-010);
  --surface-overlay-selected:var(--blue-010);
  --surface-accent-thin:var(--blue-015);
  --surface-accent-subtle:var(--blue-010);
  --surface-success-subtle:var(--lightblue-010);
  --surface-caution-subtle:var(--green-010);
  --surface-error-subtle:var(--purple-010);

  /* --- semantic: border --- */
  --border-base-high:var(--gray-030);
  --border-base-low:var(--gray-015);
  --border-accent-high:var(--blue-030);
  --border-error-high:var(--purple-030);
  --border-caution-high:var(--green-030);
  --border-success-high:var(--lightblue-030);

  /* --- typography --- */
  --family-ui:'Inter','Hiragino Kaku Gothic ProN','Yu Gothic',Meiryo,system-ui,sans-serif;
  --family-display-en:'Cormorant Garamond','Times New Roman',serif;
  --family-display-jp:'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho',serif;
  --w-light:300; --w-normal:400; --w-semibold:600; --w-bold:700;
  --size-headline-xlg:34px; --size-headline-lg:28px; --size-headline-md:24px;
  --size-headline-sm:20px; --size-headline-xs:18px;
  --size-body-xlg:20px; --size-body-lg:18px; --size-body-md:16px; --size-body-xmd:15px;
  --size-body-sm:14px; --size-body-xs:13px; --size-body-xxs:12px;
  --tracking-wide:0.025em; --tracking-normal:0; --tracking-tight:-0.025em;

  /* --- spacing (linear scale) --- */
  --sp-4:4px; --sp-8:8px; --sp-12:12px; --sp-16:16px; --sp-24:24px;
  --sp-32:32px; --sp-40:40px; --sp-48:48px; --sp-56:56px; --sp-64:64px;
  --radius:4px;
}

*{box-sizing:border-box}

.wrap{
  background:var(--surface-base-secondary);
  color:var(--object-base-high);
  font-family:var(--family-ui);
  font-size:var(--size-body-sm);
  font-weight:var(--w-normal);
  line-height:1.5;
  min-height:100vh;
  -webkit-font-smoothing:antialiased;
}

/* ---------- ui/body/xs ---------- */
.num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
.pos{color:var(--object-success-bright)}
.neg{color:var(--object-error-dim)}
.mute{color:var(--object-base-mid)}

/* ---------- app shell ---------- */
.app{display:flex;min-height:100vh;background:var(--surface-base-secondary)}

/* left navigation */
.side{flex:0 0 216px;width:216px;background:var(--surface-base-primary-inverse);color:var(--base-white);
  padding:var(--sp-24) var(--sp-12);position:sticky;top:0;height:100vh;
  display:flex;flex-direction:column;gap:var(--sp-24)}
.app[data-nav="0"] .side{display:none}
.brand{display:flex;flex-direction:column;gap:var(--sp-4);padding:0 var(--sp-8)}
.brand .mark{font-family:var(--family-display-en);font-weight:var(--w-bold);font-size:var(--size-headline-md);
  letter-spacing:var(--tracking-wide);line-height:1}
.brand .sub{font-family:var(--family-display-jp);font-weight:var(--w-normal);font-size:var(--size-body-xxs);
  color:var(--blue-030);line-height:1.5}
.nav{display:flex;flex-direction:column;gap:var(--sp-4)}
.nav button{display:block;width:100%;text-align:left;border:0;background:none;color:var(--blue-030);
  font-family:var(--family-ui);font-size:var(--size-body-sm);padding:var(--sp-8) var(--sp-12);
  border-radius:var(--radius);cursor:pointer;line-height:1.5;white-space:nowrap}
.nav button:hover{background:rgba(255,255,255,.12);color:var(--base-white)}
.nav button[data-on="1"]{background:var(--base-white);color:var(--blue-100);font-weight:var(--w-semibold)}
.nav button:focus{outline:2px solid var(--base-white);outline-offset:-2px}
.side-foot{margin-top:auto;padding:0 var(--sp-8);font-size:var(--size-body-xxs);
  color:var(--blue-030);line-height:1.8;border-top:1px solid rgba(255,255,255,.18);padding-top:var(--sp-12)}

/* content column */
.content{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}
.topstrip{background:var(--surface-base-primary);border-bottom:1px solid var(--border-base-low);
  padding:var(--sp-16) var(--sp-24);display:flex;align-items:flex-end;gap:var(--sp-32);
  flex-wrap:wrap;position:sticky;top:0;z-index:5}
.navtoggle{align-self:center;padding:var(--sp-4) var(--sp-8);border:1px solid var(--border-base-high);
  background:var(--surface-base-primary);border-radius:var(--radius);cursor:pointer;
  color:var(--object-base-mid);font-family:var(--family-ui);font-size:var(--size-body-sm);line-height:1.4}
.navtoggle:hover{background:var(--surface-overlay-hoverd)}
.bal-main .lbl{font-size:var(--size-body-xxs);letter-spacing:var(--tracking-wide);
  color:var(--object-base-mid);margin-bottom:var(--sp-4)}
.bal-main .v{font-size:var(--size-headline-xlg);font-weight:var(--w-semibold);letter-spacing:var(--tracking-tight);
  font-variant-numeric:tabular-nums;line-height:1;color:var(--object-base-high)}
.bal-sub{font-size:var(--size-body-xxs);color:var(--object-base-mid)}
.bal-sub .v{font-size:var(--size-body-lg);font-weight:var(--w-semibold);font-variant-numeric:tabular-nums;
  color:var(--object-base-high);display:block;letter-spacing:var(--tracking-tight)}
.bal-sub .v.cardv{color:var(--object-error-bright)}

/* ---------- layout ---------- */
.main{padding:var(--sp-24) var(--sp-24) var(--sp-64);max-width:1180px;width:100%}
.grid{display:grid;gap:var(--sp-12)}

/* ---------- card ---------- */
.card{background:var(--surface-base-primary);border:1px solid var(--border-base-low);border-radius:var(--radius)}
.card>h3{margin:0;padding:var(--sp-12) var(--sp-16);border-bottom:1px solid var(--border-base-low);
  font-family:var(--family-display-jp);font-weight:var(--w-semibold);font-size:var(--size-body-md);
  line-height:1.4;color:var(--object-base-high);display:flex;justify-content:space-between;align-items:center;gap:var(--sp-8)}
.card>.body{padding:var(--sp-16)}
.eyebrow{font-size:var(--size-body-xxs);letter-spacing:var(--tracking-wide);color:var(--object-base-mid);margin-bottom:var(--sp-4)}
.kpi{font-size:var(--size-headline-lg);font-weight:var(--w-semibold);letter-spacing:var(--tracking-tight);font-variant-numeric:tabular-nums;line-height:1.2}

/* ---------- table ---------- */
table{border-collapse:collapse;width:100%;font-size:var(--size-body-xs);line-height:1.4}
th,td{padding:var(--sp-8) var(--sp-12);border-bottom:1px solid var(--border-base-low);text-align:left;white-space:nowrap;vertical-align:middle}
th{font-size:var(--size-body-xxs);font-weight:var(--w-semibold);letter-spacing:var(--tracking-wide);color:var(--object-base-mid);background:var(--surface-base-secondary)}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
tr.grp td{background:var(--surface-accent-subtle);font-weight:var(--w-semibold)}
tr.tot td{border-top:2px solid var(--object-base-high);font-weight:var(--w-semibold);background:var(--surface-accent-subtle)}
tr.moved td{background:var(--surface-caution-subtle)}
.scroll{overflow-x:auto}

/* ---------- Tag (design system: Tag / size sm) ---------- */
.pill{display:inline-block;padding:2px var(--sp-8);border-radius:var(--radius);font-size:var(--size-body-xxs);
  line-height:1.5;border:1px solid;font-weight:var(--w-semibold);letter-spacing:var(--tracking-normal)}
.p-inc{color:var(--object-success-bright);border-color:var(--border-success-high);background:var(--surface-success-subtle)}
.p-fixed{color:var(--object-accent-dim);border-color:var(--border-accent-high);background:var(--surface-accent-subtle)}
.p-var{color:var(--object-caution-dim);border-color:var(--border-caution-high);background:var(--surface-caution-subtle)}
.p-set{color:var(--object-error-bright);border-color:var(--lightpurple-030);background:var(--lightpurple-010)}
.p-tr{color:var(--object-base-mid);border-color:var(--border-base-low);background:var(--gray-010)}
.p-ratio{color:var(--object-error-bright);border-color:var(--lightpurple-030);background:var(--lightpurple-010)}
.p-plan{color:var(--object-base-mid);border-color:var(--border-base-high);background:var(--surface-base-primary);border-style:dashed}
.p-act{color:var(--base-white);border-color:var(--object-base-high);background:var(--object-base-high)}

/* ---------- Button (design system: btn / color white,black,line_gray / size md,sm) ---------- */
.btn{font-family:var(--family-ui);font-size:var(--size-body-xs);font-weight:var(--w-semibold);
  padding:var(--sp-8) var(--sp-16);border:1px solid var(--border-base-high);background:var(--surface-base-primary);
  color:var(--object-base-high);border-radius:var(--radius);cursor:pointer;line-height:1.4}
.btn:hover{background:var(--surface-overlay-hoverd)}
.btn-p{background:var(--object-base-high);color:var(--base-white);border-color:var(--object-base-high)}
.btn-p:hover{background:var(--gray-090)}
.btn-d{color:var(--object-error-dim);border-color:var(--border-error-high)}
.btn-d:hover{background:var(--surface-error-subtle)}
.btn-x{padding:var(--sp-4) var(--sp-8);font-size:var(--size-body-xxs)}

/* ---------- form ---------- */
input,select,textarea{font-family:var(--family-ui);font-size:var(--size-body-xs);
  padding:var(--sp-4) var(--sp-8);border:1px solid var(--border-base-high);border-radius:var(--radius);
  background:var(--surface-base-primary);color:var(--object-base-high);width:100%;line-height:1.5}
input.n{text-align:right;font-variant-numeric:tabular-nums}
textarea{font-size:var(--size-body-xxs);min-height:104px;resize:vertical;font-variant-numeric:tabular-nums}
input:focus,select:focus,textarea:focus,.btn:focus,.tab:focus{outline:2px solid var(--object-accent-bright);outline-offset:1px}
input:disabled,select:disabled{background:var(--gray-010);color:var(--object-base-low)}
.frm{display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:var(--sp-8);align-items:end}
.f label{display:block;font-size:var(--size-body-xxs);font-weight:var(--w-semibold);letter-spacing:var(--tracking-normal);color:var(--object-base-mid);margin-bottom:var(--sp-4)}

/* ---------- controls ---------- */
.ctl{display:flex;gap:var(--sp-8);align-items:center;flex-wrap:wrap;margin-bottom:var(--sp-12)}
.seg{display:flex;border:1px solid var(--border-base-high);border-radius:var(--radius);overflow:hidden;background:var(--surface-base-primary)}
.seg button{border:0;background:none;padding:var(--sp-8) var(--sp-12);font-size:var(--size-body-xs);
  font-family:var(--family-ui);cursor:pointer;color:var(--object-base-mid);line-height:1.4}
.seg button:hover{background:var(--surface-overlay-hoverd)}
.seg button[data-on="1"]{background:var(--object-base-high);color:var(--base-white);font-weight:var(--w-semibold)}

/* ---------- Notification (design system: Notification) ---------- */
.warn{border-left:4px solid var(--object-error-dim);background:var(--surface-error-subtle);
  padding:var(--sp-12);font-size:var(--size-body-xs);border-radius:var(--radius);color:var(--object-base-high)}
.info{border-left:4px solid var(--object-accent-dim);background:var(--surface-accent-subtle);
  padding:var(--sp-12);font-size:var(--size-body-xs);border-radius:var(--radius);color:var(--object-base-high)}
.note{font-size:var(--size-body-xxs);color:var(--object-base-mid);line-height:1.5}
.empty{padding:var(--sp-24);text-align:center;color:var(--object-base-mid);font-size:var(--size-body-xs)}

@media(max-width:899px){
  .app{flex-direction:column}
  .side{position:static;width:auto;flex:none;height:auto;padding:var(--sp-12) var(--sp-16) 0;gap:var(--sp-12)}
  .app[data-nav="0"] .side{display:flex}
  .brand{flex-direction:row;align-items:baseline;gap:var(--sp-12);padding:0}
  .nav{flex-direction:row;overflow-x:auto;gap:var(--sp-4)}
  .nav button{border-radius:0;border-bottom:2px solid transparent}
  .nav button[data-on="1"]{background:none;color:var(--base-white);border-bottom-color:var(--base-white)}
  .side-foot{display:none}
  .topstrip{position:static;padding:var(--sp-16);gap:var(--sp-16)}
  .navtoggle{display:none}
  .main{padding:var(--sp-16) var(--sp-12) var(--sp-64)}
  .bal-main .v{font-size:var(--size-headline-lg)}
}
`;

/* ========================= 共通部品 ========================= */
const Card = ({ title, children, right }) => (
  <div className="card">
    {title && <h3><span>{title}</span>{right}</h3>}
    <div className="body">{children}</div>
  </div>
);
const Seg = ({ value, onChange, options }) => (
  <div className="seg">
    {options.map((o) => <button key={o.v} data-on={value === o.v ? "1" : "0"} onClick={() => onChange(o.v)}>{o.l}</button>)}
  </div>
);
const GroupPill = ({ e }) => {
  if (e.src === "settle") return <span className="pill p-set">引落</span>;
  if (e.type === "transfer") return <span className="pill p-tr">振替</span>;
  const g = groupOf(e);
  return <span className={"pill " + (g === "income" ? "p-inc" : g === "fixed" ? "p-fixed" : "p-var")}>{GROUP_LABEL[g]}</span>;
};
const RatioPill = ({ e }) => {
  const r = ratioOf(e);
  if (!r || e.type === "transfer" || e.src === "settle") return null;
  return <span className="pill p-ratio">事業{r}%</span>;
};

/* 予定を「この回だけ」動かす */
function OverrideRow({ e, data, setData, close, cols }) {
  const ov = (data.overrides || {})[e.key] || {};
  const [date, setDate] = useState(e.date);
  const [amount, setAmount] = useState(String(e.amount));
  const save = (patch) => {
    setData((d) => {
      const next = { ...(d.overrides || {}) };
      if (patch === null) delete next[e.key];
      else next[e.key] = { ...ov, ...patch };
      return { ...d, overrides: next };
    });
    close();
  };
  return (
    <tr>
      <td colSpan={cols} style={{ background: "var(--surface-base-secondary)" }}>
        <div className="frm f" style={{ maxWidth: 640 }}>
          <div><label>支払日を変更</label><input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} /></div>
          <div><label>金額を変更</label><input className="n" value={amount} onChange={(ev) => setAmount(ev.target.value.replace(/[^\d]/g, ""))} /></div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn btn-p" onClick={() => save({ date, amount: Number(amount) })}>この回だけ変更</button>
            <button className="btn" onClick={() => save({ skipped: true })}>今回は無し</button>
            {Object.keys(ov).length > 0 && <button className="btn btn-d" onClick={() => save(null)}>元に戻す</button>}
            <button className="btn" onClick={close}>閉じる</button>
          </div>
        </div>
        <div className="note" style={{ marginTop: 6 }}>この回だけ動かします。定期項目そのものは変わりません。</div>
      </td>
    </tr>
  );
}

/* ========================= ダッシュボード ========================= */
function Dashboard({ data, forecast, series, today }) {
  const t = toYMD(today), ym = t.slice(0, 7);
  const cur = series.rows.find((r) => r.date === t)?.act ?? 0;
  const win = series.rows.filter((r) => r.date >= t && r.date <= toYMD(addDays(today, 90)));
  const low = win.reduce((m, r) => (r.proj < m.proj ? r : m), win[0] || { proj: 0, date: t });

  const mFc = forecast.filter((e) => e.date.slice(0, 7) === ym);
  const mAc = data.actuals.filter((e) => e.date.slice(0, 7) === ym);
  const sum = (arr, g) => arr.filter((e) => e.type !== "transfer" && groupOf(e) === g).reduce((s, e) => s + e.amount, 0);
  const rows = [{ g: "income", l: "収入" }, { g: "fixed", l: "固定費" }, { g: "variable", l: "変動費" }]
    .map((r) => ({ ...r, plan: sum(mFc, r.g), act: sum(mAc, r.g) }));
  const pNet = rows[0].plan - rows[1].plan - rows[2].plan;
  const aNet = rows[0].act - rows[1].act - rows[2].act;

  const pending = series.unmatchedFc.filter((f) => f.date < t).sort((a, b) => b.date.localeCompare(a.date));
  const upcoming = series.projCash.filter((e) => e.date >= t && e.date <= toYMD(addDays(today, 75)) && e.type !== "transfer")
    .sort((a, b) => b.amount - a.amount).slice(0, 6);
  const cards = data.accounts.filter(isCard);
  const moved = forecast.filter((e) => e.ov && !e.ov.skipped);

  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(292px,1fr))" }}>
      <Card title="今後90日の資金繰り">
        <div className="eyebrow">最低残高（予測）</div>
        <div className={"kpi " + (low.proj < data.reserveLine ? "neg" : "")}>{yen(low.proj)}</div>
        <div className="note" style={{ marginTop: 4 }}>{low.date.slice(0, 4)}年{mdLabel(low.date)} 時点 ／ 現在 {yen(cur)}</div>
        <div style={{ marginTop: 12 }}>
          {low.proj < 0 ? <div className="warn">残高がマイナスになる予測です。支払時期の調整か資金手当てを検討してください。</div>
            : low.proj < data.reserveLine ? <div className="warn">生活防衛ライン（{yen(data.reserveLine)}）を下回る予測です。</div>
              : <div className="note">90日先まで防衛ラインを維持できる見込みです。</div>}
        </div>
      </Card>

      <Card title={`${Number(ym.slice(5))}月の予実（発生ベース・按分前）`}>
        <table>
          <thead><tr><th></th><th className="n">予定</th><th className="n">実績</th><th className="n">差異</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const d = r.g === "income" ? r.act - r.plan : r.plan - r.act;
              return (
                <tr key={r.g}><td>{r.l}</td><td className="n mute">{yenPlain(r.plan)}</td><td className="n">{yenPlain(r.act)}</td>
                  <td className={"n " + (d >= 0 ? "pos" : "neg")}>{d >= 0 ? "+" : "−"}{yenPlain(Math.abs(d))}</td></tr>
              );
            })}
            <tr className="tot"><td>収支</td><td className="n mute">{yenPlain(pNet)}</td>
              <td className={"n " + (aNet >= 0 ? "pos" : "neg")}>{yenPlain(aNet)}</td>
              <td className={"n " + (aNet - pNet >= 0 ? "pos" : "neg")}>{aNet - pNet >= 0 ? "+" : "−"}{yenPlain(Math.abs(aNet - pNet))}</td></tr>
          </tbody>
        </table>
      </Card>

      <Card title="口座・カード">
        <table>
          <tbody>
            {data.accounts.filter((a) => !isCard(a)).map((a) => {
              const v = series.rows.find((r) => r.date === t)?.["acc_" + a.id] ?? 0;
              return <tr key={a.id}><td>{a.name}</td><td className={"n " + (v < 0 ? "neg" : "")}>{yenPlain(v)}</td></tr>;
            })}
            <tr className="tot"><td>現預金 合計</td><td className="n">{yenPlain(cur)}</td></tr>
            {cards.map((c) => {
              const v = series.rows.find((r) => r.date === t)?.["card_" + c.id] ?? 0;
              const next = series.projCash.filter((e) => e.cardId === c.id && e.date >= t)[0];
              return (
                <tr key={c.id}>
                  <td>{c.name}<div className="note">次回引落 {next ? `${mdLabel(next.date)} ${yenPlain(next.amount)}円` : "—"}</div></td>
                  <td className="n neg">{yenPlain(v)}<div className="note">未払</div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title={`実績が未入力の予定（${pending.length}件）`}>
        {pending.length === 0 ? <div className="empty">未入力はありません。</div> : (
          <div style={{ maxHeight: 180, overflowY: "auto" }}>
            <table><tbody>
              {pending.slice(0, 12).map((f) => (
                <tr key={f.key}><td className="num mute" style={{ width: 52 }}>{mdLabel(f.date)}</td><td>{f.name}</td><td className="n">{yenPlain(f.amount)}</td></tr>
              ))}
            </tbody></table>
          </div>
        )}
        <div className="note" style={{ marginTop: 8 }}>予定額のまま予測に残っています。実績入力で消し込むか、支払日をずらせます。</div>
      </Card>

      <Card title="これから75日の大きな入出金（現金ベース）">
        <table><tbody>
          {upcoming.map((e, i) => (
            <tr key={e.key + i}><td className="num mute" style={{ width: 52 }}>{mdLabel(e.date)}</td><td>{e.name}</td>
              <td><GroupPill e={e} /></td>
              <td className={"n " + (e.type === "income" ? "pos" : "")}>{e.type === "income" ? "+" : "−"}{yenPlain(e.amount)}</td></tr>
          ))}
        </tbody></table>
      </Card>

      {moved.length > 0 && (
        <Card title={`支払日を動かした予定（${moved.length}件）`}>
          <table><tbody>
            {moved.slice(0, 10).map((e) => (
              <tr key={e.key}><td className="num mute">{mdLabel(e.origDate)} → <b>{mdLabel(e.date)}</b></td><td>{e.name}</td><td className="n">{yenPlain(e.amount)}</td></tr>
            ))}
          </tbody></table>
        </Card>
      )}
    </div>
  );
}

/* ========================= 入出金予定表（期間指定・月グループ） ========================= */
const ymLabel = (ym) => `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月`;
const KINDS = [
  { v: "all", l: "すべて" }, { v: "income", l: "入金" }, { v: "fixed", l: "固定費" },
  { v: "variable", l: "変動費" }, { v: "settle", l: "カード引落" }, { v: "transfer", l: "振替" },
];

function Ledger({ data, setData, series, today, accById }) {
  const t = toYMD(today);
  const curYM = t.slice(0, 7);
  const allYMs = useMemo(() => [...new Set(series.rows.map((r) => r.date.slice(0, 7)))], [series]);
  const [span, setSpan] = useState(3);
  const [fromYM, setFromYM] = useState(curYM);
  const [toYMv, setToYMv] = useState(curYM);
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [closed, setClosed] = useState({});
  const [editKey, setEditKey] = useState(null);

  const [start, stop] = useMemo(() => {
    if (span === "custom") return fromYM <= toYMv ? [fromYM, toYMv] : [toYMv, fromYM];
    const i = Math.max(0, allYMs.indexOf(curYM));
    return [curYM, allYMs[Math.min(i + span - 1, allYMs.length - 1)] || curYM];
  }, [span, fromYM, toYMv, allYMs, curYM]);

  const rows = useMemo(() => {
    const actKeys = new Set(series.actCash.map((a) => a.key).filter(Boolean));
    return [
      ...series.actCash.map((a) => ({ ...a, status: "act" })),
      ...series.projCash.filter((e) => !actKeys.has(e.key)).map((e) => ({ ...e, status: "plan" })),
    ]
      .filter((e) => { const ym = e.date.slice(0, 7); return ym >= start && ym <= stop; })
      .filter((e) => status === "all" || e.status === status)
      .filter((e) => {
        if (kind === "all") return true;
        if (kind === "settle") return e.src === "settle";
        if (e.src === "settle") return false;
        if (kind === "transfer") return e.type === "transfer";
        if (e.type === "transfer") return false;
        return groupOf(e) === kind;
      })
      .sort((a, b) => a.date.localeCompare(b.date) || String(a.name).localeCompare(String(b.name)));
  }, [series, start, stop, kind, status]);

  const balAt = useMemo(() => Object.fromEntries(series.rows.map((r) => [r.date, r.proj])), [series]);
  const groups = useMemo(() => {
    const g = new Map();
    rows.forEach((e) => { if (!g.has(e.date.slice(0, 7))) g.set(e.date.slice(0, 7), []); g.get(e.date.slice(0, 7)).push(e); });
    return [...g.entries()].map(([ym, items]) => {
      const inn = items.filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0);
      const out = items.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);
      const days = series.rows.filter((r) => r.date.startsWith(ym));
      return { ym, items, in: inn, out, close: days.length ? days[days.length - 1].proj : null, low: days.reduce((m, r) => Math.min(m, r.proj), Infinity) };
    });
  }, [rows, series]);

  const total = { in: rows.filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0), out: rows.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0) };
  const opts = allYMs.map((y) => <option key={y} value={y}>{ymLabel(y)}</option>);

  return (
    <Card title={`入出金予定表（${ymLabel(start)}～${ymLabel(stop)}・現金ベース）`}
      right={<span className="note">{rows.length}件 ／ 入金 {yenPlain(total.in)} ／ 出金 {yenPlain(total.out)}</span>}>
      <div className="ctl">
        <Seg value={span} onChange={setSpan}
          options={[{ v: 1, l: "今月" }, { v: 3, l: "3ヶ月" }, { v: 6, l: "6ヶ月" }, { v: 12, l: "12ヶ月" }, { v: "custom", l: "期間を指定" }]} />
        {span === "custom" && (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <select style={{ width: 118 }} value={fromYM} onChange={(e) => setFromYM(e.target.value)}>{opts}</select>
            <span className="mute">〜</span>
            <select style={{ width: 118 }} value={toYMv} onChange={(e) => setToYMv(e.target.value)}>{opts}</select>
          </span>
        )}
      </div>
      <div className="ctl">
        <Seg value={kind} onChange={setKind} options={KINDS.map((k) => ({ v: k.v, l: k.l }))} />
        <Seg value={status} onChange={setStatus} options={[{ v: "all", l: "予定+実績" }, { v: "plan", l: "予定のみ" }, { v: "act", l: "実績のみ" }]} />
        <button className="btn" onClick={() => setClosed(Object.keys(closed).length ? {} : Object.fromEntries(groups.map((g) => [g.ym, true])))}>
          {Object.keys(closed).length ? "すべて展開" : "すべて折りたたむ"}
        </button>
      </div>

      {groups.length === 0 ? <div className="empty">この条件に合う入出金はありません。</div> : (
        <div className="scroll" style={{ maxHeight: 520, overflowY: "auto" }}>
          <table>
            <thead><tr><th>日付</th><th>内容</th><th>区分</th><th>費目</th><th>口座</th><th className="n">入出金</th><th className="n">残高</th><th>状態</th><th></th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <React.Fragment key={g.ym}>
                  <tr className="grp" style={{ cursor: "pointer" }} onClick={() => setClosed((c) => ({ ...c, [g.ym]: !c[g.ym] }))}>
                    <td colSpan={2}>{closed[g.ym] ? "▸" : "▾"} {ymLabel(g.ym)}<span className="note">　{g.items.length}件</span></td>
                    <td colSpan={3} className="note">
                      {g.low < data.reserveLine && <span className="neg">月中最低 {yenPlain(g.low)}</span>}
                    </td>
                    <td className="n"><span className="pos">+{yenPlain(g.in)}</span> <span className="neg">−{yenPlain(g.out)}</span></td>
                    <td className={"n " + (g.close != null && g.close < 0 ? "neg" : "")}>{g.close != null ? yenPlain(g.close) : ""}</td>
                    <td colSpan={2} className="note">月末残高</td>
                  </tr>
                  {!closed[g.ym] && g.items.map((e, i) => (
                    <React.Fragment key={e.key + "_" + i}>
                      <tr className={e.ov ? "moved" : ""}>
                        <td className="num mute">{mdLabel(e.date)}{e.ov && e.origDate && <span className="note"> ←{mdLabel(e.origDate)}</span>}</td>
                        <td>{e.name}</td>
                        <td><GroupPill e={e} /> <RatioPill e={e} /></td>
                        <td className="mute">{e.category || "—"}</td>
                        <td className="mute">{accById[e.accountId]?.name || "—"}</td>
                        <td className={"n " + (e.type === "income" ? "pos" : e.type === "transfer" ? "mute" : "")}>
                          {e.type === "transfer" ? "±" : e.type === "income" ? "+" : "−"}{yenPlain(e.amount)}
                        </td>
                        <td className={"n " + ((balAt[e.date] ?? 0) < 0 ? "neg" : "")}>{yenPlain(balAt[e.date] ?? 0)}</td>
                        <td><span className={"pill " + (e.status === "act" ? "p-act" : "p-plan")}>{e.status === "act" ? "実績" : "予定"}</span></td>
                        <td>{e.status === "plan" && e.src !== "settle" &&
                          <button className="btn btn-x" onClick={() => setEditKey(editKey === e.key ? null : e.key)}>日付変更</button>}</td>
                      </tr>
                      {editKey === e.key && <OverrideRow e={e} data={data} setData={setData} close={() => setEditKey(null)} cols={9} />}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="note" style={{ marginTop: 10 }}>
        カード払いの明細はここには出ません。締め日ごとにまとまった「引落」として現れます。月の見出しを押すと折りたためます。
      </div>
    </Card>
  );
}

/* ========================= キャッシュフロー ========================= */
function Cashflow({ data, setData, series, today, accById }) {
  const [range, setRange] = useState(6);
  const [grain, setGrain] = useState("day");
  const [byAcct, setByAcct] = useState(false);
  const t = toYMD(today);
  const from = parseYMD(data.asOf);
  const end = toYMD(addMonths(today, range));
  const rows = series.rows.filter((r) => r.date <= end);
  const monthly = useMemo(() => monthlyCashflow(series, from, parseYMD(end)), [series, data.asOf, end]);

  const chartData = grain === "day" ? rows : monthly.map((m) => {
    const last = series.rows.filter((r) => r.date.startsWith(m.ym)).slice(-1)[0];
    return { date: m.ym, proj: m.close, act: last && last.act != null ? last.act : null, in: m.in, out: -m.out, low: m.low };
  });

  const minV = Math.min(0, ...chartData.map((r) => r.proj));

  return (
    <>
      <div className="ctl">
        <Seg value={grain} onChange={setGrain} options={[{ v: "day", l: "日次" }, { v: "month", l: "月次" }]} />
        <Seg value={range} onChange={setRange} options={[{ v: 3, l: "3ヶ月" }, { v: 6, l: "6ヶ月" }, { v: 12, l: "12ヶ月" }, { v: 20, l: "全期間" }]} />
        {grain === "day" && <button className="btn" onClick={() => setByAcct(!byAcct)}>{byAcct ? "口座別を隠す" : "口座別を表示"}</button>}
        <span className="note">実線＝実績　破線＝予測</span>
      </div>

      <Card title={grain === "day" ? "残高推移（日次）" : "残高推移と月間収支（月次）"}>
        <div style={{ height: 330, marginLeft: -14 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 6, right: 12, bottom: 4, left: 8 }}>
              <CartesianGrid stroke="#E1E1E1" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#717171" }} tickFormatter={mdLabel}
                minTickGap={grain === "day" ? 38 : 4} axisLine={{ stroke: "#C1C1C1" }} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#717171" }} tickFormatter={man} width={54} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v, n) => [v == null ? "—" : yen(v), n]}
                contentStyle={{ fontSize: 12, borderRadius: 3, border: "1px solid #C1C1C1", fontFamily: "var(--family-ui)", fontVariantNumeric: "tabular-nums" }} />
              {minV < 0 && <ReferenceArea y1={minV} y2={0} fill="#63063E" fillOpacity={0.07} />}
              <ReferenceLine y={0} stroke="#63063E" strokeWidth={1.5} />
              <ReferenceLine y={data.reserveLine} stroke="#06631E" strokeDasharray="2 3"
                label={{ value: "防衛ライン", fontSize: 11, fill: "#06631E", position: "insideTopLeft" }} />
              {grain === "day" && <ReferenceLine x={t} stroke="#333333" strokeDasharray="3 3" label={{ value: "今日", fontSize: 11, fill: "#333333", position: "top" }} />}
              <Legend wrapperStyle={{ fontSize: 12, fontFamily: "var(--family-ui)" }} />
              {grain === "month" && <Bar dataKey="in" name="入金" fill="#068891" fillOpacity={0.25} barSize={12} />}
              {grain === "month" && <Bar dataKey="out" name="出金" fill="#91066E" fillOpacity={0.25} barSize={12} />}
              {grain === "month" && <Line type="monotone" dataKey="low" name="月中最低" stroke="#069149" strokeWidth={1} strokeDasharray="1 3" dot={false} />}
              <Line type={grain === "day" ? "stepAfter" : "monotone"} dataKey="proj" name="予測残高" stroke="#065D63" strokeWidth={1.7} strokeDasharray="4 3" dot={false} />
              <Line type={grain === "day" ? "stepAfter" : "monotone"} dataKey="act" name="実績残高" stroke="#333333" strokeWidth={2} dot={false} connectNulls={false} />
              {grain === "day" && byAcct && data.accounts.filter((a) => !isCard(a)).map((a, i) => (
                <Line key={a.id} type="stepAfter" dataKey={"acc_" + a.id} name={a.name} stroke={i === 0 ? "#069149" : "#9C1F7D"} strokeWidth={1} strokeOpacity={0.6} dot={false} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div style={{ height: 12 }} />

      {grain === "month" && (
        <>
          <Card title="月次資金繰り表">
            <div className="scroll">
              <table>
                <thead><tr><th>月</th><th className="n">前月繰越</th><th className="n">入金</th><th className="n">出金</th><th className="n">収支</th><th className="n">月末残高</th><th className="n">月中最低</th><th></th></tr></thead>
                <tbody>
                  {monthly.map((m) => (
                    <tr key={m.ym}>
                      <td className="num">{m.ym}</td>
                      <td className="n mute">{yenPlain(m.open)}</td>
                      <td className="n pos">{yenPlain(m.in)}</td>
                      <td className="n">{yenPlain(m.out)}</td>
                      <td className={"n " + (m.net >= 0 ? "pos" : "neg")}>{m.net >= 0 ? "+" : "−"}{yenPlain(Math.abs(m.net))}</td>
                      <td className={"n " + (m.close < 0 ? "neg" : "")} style={{ fontWeight: 600 }}>{yenPlain(m.close)}</td>
                      <td className={"n " + (m.low < data.reserveLine ? "neg" : "mute")}>{yenPlain(m.low)}</td>
                      <td className="note">{m.low < data.reserveLine ? `${mdLabel(m.lowDate)}に${m.low < 0 ? "資金ショート" : "防衛ライン割れ"}` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="note" style={{ marginTop: 10 }}>カード利用は利用日ではなく引き落とし日で出金に計上しています。</div>
          </Card>
          <div style={{ height: 12 }} />
        </>
      )}

      <Ledger data={data} setData={setData} series={series} today={today} accById={accById} />
    </>
  );
}

/* ========================= 年月別収支（P/L） ========================= */
function PL({ data, forecast, today }) {
  const years = useMemo(() => [...new Set(forecast.map((e) => e.date.slice(0, 4)))].sort(), [forecast]);
  const [year, setYear] = useState(String(today.getFullYear()));
  const [scope, setScope] = useState("all");
  const [mode, setMode] = useState("mix");
  const yr = years.includes(year) ? year : years[0];
  const plan = useMemo(() => aggregate(forecast, scope), [forecast, scope]);
  const act = useMemo(() => aggregate(data.actuals, scope), [data.actuals, scope]);
  const months = Array.from({ length: 12 }, (_, i) => `${yr}-${pad(i + 1)}`);
  const tYM = toYMD(today).slice(0, 7);

  const catsIn = (g) => {
    const s = new Set();
    months.forEach((m) => { Object.keys(plan[m]?.[g] || {}).forEach((c) => s.add(c)); Object.keys(act[m]?.[g] || {}).forEach((c) => s.add(c)); });
    return allCats.filter((c) => s.has(c));
  };
  const val = (src, m, g, c) => (c ? src[m]?.[g]?.[c] || 0 : Object.values(src[m]?.[g] || {}).reduce((a, b) => a + b, 0));
  const useAct = (m) => m <= tYM && mode !== "plan";

  const Cell = ({ m, g, c, bold }) => {
    const p = val(plan, m, g, c), a = val(act, m, g, c), past = m <= tYM;
    const diff = g === "income" ? a - p : p - a;
    if (mode === "plan") return <td className="n">{p ? yenPlain(p) : <span className="mute">—</span>}</td>;
    if (mode === "act") return <td className="n">{past ? (a ? yenPlain(a) : <span className="mute">—</span>) : <span className="mute">·</span>}</td>;
    if (mode === "diff") return <td className={"n " + (!past ? "mute" : diff >= 0 ? "pos" : "neg")}>
      {!past ? "·" : diff === 0 ? "0" : (diff > 0 ? "+" : "−") + yenPlain(Math.abs(diff))}</td>;
    return (
      <td className="n">
        <div style={{ fontWeight: bold ? 600 : 400 }}>{past ? (a ? yenPlain(a) : "—") : <span className="mute">{p ? yenPlain(p) : "—"}</span>}</div>
        {past && p !== 0 && <div style={{ fontSize: 12, color: "var(--object-base-mid)" }}>予 {yenPlain(p)}</div>}
      </td>
    );
  };
  const net = (src, m) => val(src, m, "income") - val(src, m, "fixed") - val(src, m, "variable");
  const yearSum = (g, c) => months.reduce((s, m) => s + (useAct(m) ? val(act, m, g, c) : val(plan, m, g, c)), 0);

  return (
    <>
      <div className="ctl">
        <Seg value={yr} onChange={setYear} options={years.map((y) => ({ v: y, l: y + "年" }))} />
        <Seg value={scope} onChange={setScope} options={[{ v: "all", l: "合算" }, { v: "household", l: "家計" }, { v: "business", l: "事業" }]} />
        <Seg value={mode} onChange={setMode} options={[{ v: "mix", l: "実績+予定" }, { v: "plan", l: "予定" }, { v: "act", l: "実績" }, { v: "diff", l: "差異" }]} />
      </div>
      {scope !== "all" && <div className="info" style={{ marginBottom: 12 }}>
        家事按分を反映しています。{scope === "business" ? "事業割合ぶんだけを経費として" : "事業割合を差し引いた残りを"}集計しています。
      </div>}
      <Card title={`年月別 収支（${scope === "all" ? "家計+事業 合算" : scope === "household" ? "家計" : "事業"}）`}>
        <div className="scroll">
          <table>
            <thead><tr>
              <th style={{ position: "sticky", left: 0, background: "var(--surface-base-secondary)", minWidth: 118 }}>費目</th>
              {months.map((m) => <th key={m} className="n">{Number(m.slice(5))}月</th>)}
              <th className="n">年計</th>
            </tr></thead>
            <tbody>
              {["income", "fixed", "variable"].map((g) => (
                <React.Fragment key={g}>
                  <tr className="grp">
                    <td style={{ position: "sticky", left: 0, background: "var(--surface-accent-subtle)" }}>{GROUP_LABEL[g]}</td>
                    {months.map((m) => <Cell key={m} m={m} g={g} bold />)}
                    <td className="n" style={{ fontWeight: 600 }}>{yenPlain(yearSum(g))}</td>
                  </tr>
                  {catsIn(g).map((c) => (
                    <tr key={c}>
                      <td style={{ position: "sticky", left: 0, background: "var(--surface-base-primary)", paddingLeft: 24, color: "var(--object-base-mid)" }}>{c}</td>
                      {months.map((m) => <Cell key={m} m={m} g={g} c={c} />)}
                      <td className="n mute">{yenPlain(yearSum(g, c))}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              <tr className="tot">
                <td style={{ position: "sticky", left: 0, background: "var(--surface-accent-subtle)" }}>{scope === "business" ? "事業所得" : "収支"}</td>
                {months.map((m) => {
                  const v = useAct(m) ? net(act, m) : net(plan, m);
                  return <td key={m} className={"n " + (v >= 0 ? "pos" : "neg")}>{yenPlain(v)}</td>;
                })}
                <td className="n">{yenPlain(months.reduce((s, m) => s + (useAct(m) ? net(act, m) : net(plan, m)), 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="note" style={{ marginTop: 10 }}>
          過去月は実績、未来月は予定です。発生日ベース（カードは利用日）で集計し、口座間振替とカード引落は含めていません。
        </div>
      </Card>
    </>
  );
}

/* ========================= 実績入力 ========================= */
function Entry({ data, setData, series, today }) {
  const t = toYMD(today);
  const pend = series.unmatchedFc.filter((f) => f.date <= toYMD(addDays(today, 7))).sort((a, b) => a.date.localeCompare(b.date));
  const [editKey, setEditKey] = useState(null);
  const blank = { date: t, name: "", type: "expense", costType: "variable", category: "食費", amount: "", bizRatio: 0, accountId: data.accounts[0]?.id, key: null };
  const [f, setF] = useState(blank);
  const up = (k, v) => setF((s) => {
    const n = { ...s, [k]: v };
    if (k === "type" || k === "costType") { const l = catList(n); if (!l.includes(n.category)) n.category = l[0]; }
    return n;
  });
  const add = () => {
    if (!f.name || !f.amount) return;
    setData((d) => ({ ...d, actuals: [...d.actuals, { ...f, id: uid(), amount: Number(f.amount), bizRatio: Number(f.bizRatio) || 0, src: "actual" }] }));
    setF({ ...blank, date: f.date, accountId: f.accountId });
  };
  const confirmAsIs = (p) => setData((d) => ({ ...d, actuals: [...d.actuals, { ...p, id: uid(), src: "actual" }] }));
  const del = (id) => setData((d) => ({ ...d, actuals: d.actuals.filter((a) => a.id !== id) }));
  const recent = [...data.actuals].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);

  return (
    <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
      <Card title={`消し込み待ちの予定（${pend.length}件）`}>
        {pend.length === 0 ? <div className="empty">消し込み待ちはありません。</div> : (
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            <table><tbody>
              {pend.map((p) => (
                <React.Fragment key={p.key}>
                  <tr className={p.ov ? "moved" : ""}>
                    <td className="num mute" style={{ width: 50 }}>{mdLabel(p.date)}</td>
                    <td>{p.name}</td>
                    <td className="n">{yenPlain(p.amount)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <button className="btn btn-x" onClick={() => confirmAsIs(p)}>予定どおり</button>{" "}
                      <button className="btn btn-x" onClick={() => setF({ ...p, amount: String(p.amount) })}>金額を直す</button>{" "}
                      <button className="btn btn-x" onClick={() => setEditKey(editKey === p.key ? null : p.key)}>払えなかった</button>
                    </td>
                  </tr>
                  {editKey === p.key && <OverrideRow e={p} data={data} setData={setData} close={() => setEditKey(null)} cols={4} />}
                </React.Fragment>
              ))}
            </tbody></table>
          </div>
        )}
        <div className="note" style={{ marginTop: 8 }}>「払えなかった」を押すと、その回だけ支払日や金額を動かせます。</div>
      </Card>

      <Card title={f.key ? "実績を入力（予定を消し込み）" : "実績を入力"}>
        <div className="frm f">
          <div><label>日付</label><input type="date" value={f.date} onChange={(e) => up("date", e.target.value)} /></div>
          <div><label>内容</label><input value={f.name} onChange={(e) => up("name", e.target.value)} placeholder="スーパー" /></div>
          <div><label>金額</label><input className="n" inputMode="numeric" value={f.amount} onChange={(e) => up("amount", e.target.value.replace(/[^\d]/g, ""))} /></div>
          <div><label>収支</label><select value={f.type} onChange={(e) => up("type", e.target.value)}>
            <option value="expense">支出</option><option value="income">収入</option><option value="transfer">振替</option></select></div>
          <div><label>固定/変動</label><select value={f.costType || ""} onChange={(e) => up("costType", e.target.value || null)} disabled={f.type !== "expense"}>
            <option value="variable">変動費</option><option value="fixed">固定費</option></select></div>
          <div><label>費目</label><select value={f.category || ""} onChange={(e) => up("category", e.target.value)}>
            {catList(f).map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label>事業割合 %</label><input className="n" value={f.bizRatio} onChange={(e) => up("bizRatio", clampNum(e.target.value, 0, 100))} /></div>
          <div><label>支払方法</label><select value={f.accountId} onChange={(e) => up("accountId", e.target.value)}>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-p" onClick={add}>登録</button>
            {f.key && <button className="btn" onClick={() => setF(blank)}>解除</button>}
          </div>
        </div>
        {f.key && <div className="note" style={{ marginTop: 10 }}>この予定に紐づけて登録します。予測からは自動で除かれます。</div>}
      </Card>

      <Card title="最近の実績">
        <div style={{ maxHeight: 380, overflowY: "auto" }}>
          <table><tbody>
            {recent.map((a) => (
              <tr key={a.id}>
                <td className="num mute" style={{ width: 50 }}>{mdLabel(a.date)}</td>
                <td>{a.name}</td>
                <td><GroupPill e={a} /> <RatioPill e={a} /></td>
                <td className={"n " + (a.type === "income" ? "pos" : "")}>{a.type === "income" ? "+" : a.type === "transfer" ? "±" : "−"}{yenPlain(a.amount)}</td>
                <td style={{ textAlign: "right" }}><button className="btn btn-x btn-d" onClick={() => del(a.id)}>削除</button></td>
              </tr>
            ))}
          </tbody></table>
        </div>
      </Card>
    </div>
  );
}

/* ========================= CSV取込 ========================= */
function Import({ data, setData, series, today }) {
  const [raw, setRaw] = useState([]);
  const [map, setMap] = useState(null);
  const [prev, setPrev] = useState(null);
  const [acct, setAcct] = useState(data.accounts[0]?.id);
  const fileRef = useRef();

  const load = (text) => {
    const rows = parseCSV(text);
    if (!rows.length) return;
    setRaw(rows); setMap(detectColumns(rows)); setPrev(null);
  };
  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const buf = await file.arrayBuffer();
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch { try { text = new TextDecoder("shift_jis").decode(buf); } catch { text = new TextDecoder().decode(buf); } }
    load(text.replace(/^﻿/, ""));
  };

  const build = () => {
    const body = map.hasHeader ? raw.slice(1) : raw;
    const cands = series.unmatchedFc.filter((f) => f.date >= toYMD(addDays(today, -150)));
    const out = [];
    body.forEach((r, idx) => {
      const date = normDate(r[map.date] ?? "");
      if (!date) return;
      let amt = null;
      if (map.inc >= 0 || map.out >= 0) {
        const i = map.inc >= 0 ? normAmt(r[map.inc]) : null;
        const o = map.out >= 0 ? normAmt(r[map.out]) : null;
        amt = i ? i : o ? -Math.abs(o) : null;
      } else {
        const v = normAmt(r[map.amt]);
        if (v != null) amt = map.sign === "outMinus" ? v : -v;
      }
      if (amt == null || amt === 0) return;
      const name = String(r[map.name] ?? "").trim() || "（摘要なし）";
      const g = guessFromHistory(name, data);
      const type = amt > 0 ? "income" : "expense";
      const costType = type === "income" ? null : (g?.costType || "variable");
      const category = g?.category && catList({ type, costType }).includes(g.category)
        ? g.category : (type === "income" ? "その他収入" : "その他");
      const abs = Math.abs(amt);
      const hit = cands.find((c) => c.amount === abs
        && Math.abs(parseYMD(c.date) - parseYMD(date)) <= 12 * 864e5
        && (c.type === "income") === (type === "income"));
      out.push({
        rid: idx, use: true, date, name, type, costType, category,
        bizRatio: g?.bizRatio ?? 0, amount: abs, accountId: acct, key: hit?.key || null, hitName: hit?.name || null,
      });
    });
    setPrev(out);
  };

  const upRow = (rid, k, v) => setPrev((p) => p.map((r) => {
    if (r.rid !== rid) return r;
    const n = { ...r, [k]: v };
    if (k === "type" || k === "costType") { const l = catList(n); if (!l.includes(n.category)) n.category = l[0]; }
    return n;
  }));
  const commit = () => {
    const rows = prev.filter((r) => r.use).map((r) => ({
      id: uid(), date: r.date, name: r.name, type: r.type, costType: r.costType,
      category: r.category, amount: r.amount, bizRatio: r.bizRatio, accountId: r.accountId,
      key: r.key, src: "actual",
    }));
    setData((d) => ({ ...d, actuals: [...d.actuals, ...rows] }));
    setPrev(null); setRaw([]); setMap(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const cols = raw[0] || [];
  const colOpts = cols.map((c, i) => <option key={i} value={i}>{i + 1}: {String(c).slice(0, 14) || "（空）"}</option>);
  const matched = prev?.filter((r) => r.key).length ?? 0;

  return (
    <>
      <Card title="1. ファイルを選ぶ">
        <div className="frm f" style={{ marginBottom: 10 }}>
          <div><label>取り込む口座・カード</label>
            <select value={acct} onChange={(e) => setAcct(e.target.value)}>
              {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{isCard(a) ? "（カード）" : ""}</option>)}
            </select></div>
          <div><label>CSVファイル</label><input ref={fileRef} type="file" accept=".csv,.txt,text/csv" onChange={onFile} /></div>
        </div>
        <label className="note">貼り付けでも取り込めます</label>
        <textarea placeholder={"日付,摘要,入金,出金\n2026/08/25,ｽｰﾊﾟｰ ﾏﾙｴﾂ,,4820\n2026/08/25,ｶ)ｴｰｼﾔ ｷﾞﾖｳﾑｲﾀｸ,450000,"}
          onChange={(e) => e.target.value.trim() && load(e.target.value)} />
        <div className="note" style={{ marginTop: 6 }}>
          Shift_JIS のファイルもそのまま読めます。カードを選ぶと、利用日で取り込んだうえで引き落とし日に自動で寄せます。
        </div>
      </Card>

      {map && (
        <>
          <div style={{ height: 12 }} />
          <Card title="2. 列を対応づける" right={<button className="btn btn-p btn-x" onClick={build}>読み取る</button>}>
            <div className="frm f">
              <div><label>日付の列</label><select value={map.date} onChange={(e) => setMap({ ...map, date: Number(e.target.value) })}>{colOpts}</select></div>
              <div><label>摘要の列</label><select value={map.name} onChange={(e) => setMap({ ...map, name: Number(e.target.value) })}>{colOpts}</select></div>
              <div><label>入金の列</label><select value={map.inc} onChange={(e) => setMap({ ...map, inc: Number(e.target.value) })}><option value={-1}>なし</option>{colOpts}</select></div>
              <div><label>出金の列</label><select value={map.out} onChange={(e) => setMap({ ...map, out: Number(e.target.value) })}><option value={-1}>なし</option>{colOpts}</select></div>
              <div><label>金額1列の場合</label><select value={map.amt} onChange={(e) => setMap({ ...map, amt: Number(e.target.value) })}><option value={-1}>なし</option>{colOpts}</select></div>
              <div><label>金額の符号</label><select value={map.sign} onChange={(e) => setMap({ ...map, sign: e.target.value })}>
                <option value="outMinus">出金がマイナス</option><option value="outPlus">出金がプラス</option></select></div>
              <div><label>1行目</label><select value={map.hasHeader ? "1" : "0"} onChange={(e) => setMap({ ...map, hasHeader: e.target.value === "1" })}>
                <option value="1">見出し</option><option value="0">データ</option></select></div>
            </div>
            <div className="scroll" style={{ marginTop: 12 }}>
              <table><tbody>
                {raw.slice(0, 3).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="mute">{String(c).slice(0, 16)}</td>)}</tr>)}
              </tbody></table>
            </div>
          </Card>
        </>
      )}

      {prev && (
        <>
          <div style={{ height: 12 }} />
          <Card title={`3. 確認して取り込む（${prev.length}件・うち予定と一致 ${matched}件）`}
            right={<button className="btn btn-p btn-x" onClick={commit}>{prev.filter((r) => r.use).length}件を登録</button>}>
            <div className="scroll" style={{ maxHeight: 460, overflowY: "auto" }}>
              <table>
                <thead><tr><th>取込</th><th>日付</th><th style={{ minWidth: 150 }}>摘要</th><th className="n">金額</th><th>収支</th><th>固定/変動</th><th>費目</th><th>事業%</th><th>消し込み先</th></tr></thead>
                <tbody>
                  {prev.map((r) => (
                    <tr key={r.rid}>
                      <td><input type="checkbox" checked={r.use} style={{ width: 16 }} onChange={(e) => upRow(r.rid, "use", e.target.checked)} /></td>
                      <td className="num mute">{mdLabel(r.date)}</td>
                      <td>{r.name}</td>
                      <td className={"n " + (r.type === "income" ? "pos" : "")}>{r.type === "income" ? "+" : "−"}{yenPlain(r.amount)}</td>
                      <td><select value={r.type} onChange={(e) => upRow(r.rid, "type", e.target.value)}><option value="expense">支出</option><option value="income">収入</option></select></td>
                      <td><select value={r.costType || ""} onChange={(e) => upRow(r.rid, "costType", e.target.value || null)} disabled={r.type !== "expense"}>
                        <option value="variable">変動費</option><option value="fixed">固定費</option></select></td>
                      <td><select value={r.category} onChange={(e) => upRow(r.rid, "category", e.target.value)}>{catList(r).map((c) => <option key={c}>{c}</option>)}</select></td>
                      <td style={{ width: 62 }}><input className="n" value={r.bizRatio} onChange={(e) => upRow(r.rid, "bizRatio", clampNum(e.target.value, 0, 100))} /></td>
                      <td className="note">{r.hitName ? <><span className="pill p-act">自動</span> {r.hitName}</> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="note" style={{ marginTop: 10 }}>
              金額と日付が近い予定を自動で探して紐づけています。紐づいた行を取り込むと、その予定は予測から外れます。費目は過去の名前から推測しているので、違うものだけ直してください。
            </div>
          </Card>
        </>
      )}
    </>
  );
}

/* ========================= 設定 ========================= */
function Settings({ data, setData, resetAll }) {
  const fix = (e) => { const l = catList(e); return l.includes(e.category) ? e : { ...e, category: l[0] }; };
  const upR = (id, k, v) => setData((d) => ({ ...d, recurring: d.recurring.map((r) => (r.id === id ? fix({ ...r, [k]: v }) : r)) }));
  const upO = (id, k, v) => setData((d) => ({ ...d, oneoffs: d.oneoffs.map((o) => (o.id === id ? fix({ ...o, [k]: v }) : o)) }));
  const upA = (id, k, v) => setData((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? { ...a, [k]: v } : a)) }));
  const addR = () => setData((d) => ({ ...d, recurring: [...d.recurring, R(uid(), "新しい定期項目", "expense", "variable", "その他", 0, 25, 0, d.accounts[0].id)] }));
  const addO = () => setData((d) => ({ ...d, oneoffs: [...d.oneoffs, { id: uid(), date: toYMD(new Date()), name: "新しい予定", type: "expense", costType: "variable", category: "その他", amount: 0, bizRatio: 0, accountId: d.accounts[0].id }] }));
  const addA = (kind) => setData((d) => ({
    ...d, accounts: [...d.accounts, kind === "card"
      ? { id: uid(), name: "新しいカード", kind: "card", balance: 0, closingDay: 15, payMonthOffset: 1, payDay: 10, settleAccountId: d.accounts.find((a) => !isCard(a))?.id }
      : { id: uid(), name: "新しい口座", kind: "bank", balance: 0 }],
  }));
  const delA = (id) => setData((d) => ({ ...d, accounts: d.accounts.filter((a) => a.id !== id) }));
  const banks = data.accounts.filter((a) => !isCard(a));
  const ovList = Object.entries(data.overrides || {});

  const Row = ({ e, on }) => (
    <>
      <td><select value={e.type} onChange={(ev) => on("type", ev.target.value)}>
        <option value="expense">支出</option><option value="income">収入</option><option value="transfer">振替</option></select></td>
      <td><select value={e.costType || ""} onChange={(ev) => on("costType", ev.target.value || null)} disabled={e.type !== "expense"}>
        <option value="variable">変動費</option><option value="fixed">固定費</option></select></td>
      <td><select value={e.category || ""} onChange={(ev) => on("category", ev.target.value)} disabled={e.type === "transfer"}>
        {catList(e).map((c) => <option key={c}>{c}</option>)}</select></td>
      <td><input className="n" value={e.amount} onChange={(ev) => on("amount", clampNum(ev.target.value, 0, 1e12))} /></td>
      <td style={{ width: 62 }}><input className="n" value={e.bizRatio ?? 0} onChange={(ev) => on("bizRatio", clampNum(ev.target.value, 0, 100))} /></td>
      <td><select value={e.accountId} onChange={(ev) => on("accountId", ev.target.value)}>
        {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></td>
    </>
  );

  return (
    <>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", marginBottom: 12 }}>
        <Card title="基準日と防衛ライン">
          <div className="frm f">
            <div><label>基準日</label><input type="date" value={data.asOf} onChange={(e) => setData((d) => ({ ...d, asOf: e.target.value }))} /></div>
            <div><label>生活防衛ライン</label><input className="n" value={data.reserveLine} onChange={(e) => setData((d) => ({ ...d, reserveLine: clampNum(e.target.value, 0, 1e12) }))} /></div>
          </div>
          <div className="note" style={{ marginTop: 10 }}>使い始めるときは、基準日に今日の日付、各口座に通帳残高、カードに現在の未払額を入れてください。</div>
          <div style={{ marginTop: 12 }}><button className="btn btn-d" onClick={resetAll}>サンプルデータに戻す</button></div>
        </Card>

        <Card title={`この回だけ変更した予定（${ovList.length}件）`}>
          {ovList.length === 0 ? <div className="empty">変更はありません。</div> : (
            <table><tbody>
              {ovList.map(([k, o]) => (
                <tr key={k}>
                  <td className="num mute" style={{ fontSize: 10 }}>{k.replace(/^r:/, "")}</td>
                  <td>{o.skipped ? "今回は無し" : `${o.date || "日付そのまま"} / ${o.amount != null ? yenPlain(o.amount) + "円" : "金額そのまま"}`}</td>
                  <td><button className="btn btn-x btn-d" onClick={() => setData((d) => { const n = { ...d.overrides }; delete n[k]; return { ...d, overrides: n }; })}>解除</button></td>
                </tr>
              ))}
            </tbody></table>
          )}
        </Card>
      </div>

      <Card title="口座・カード" right={<span style={{ display: "flex", gap: 6 }}>
        <button className="btn btn-x" onClick={() => addA("bank")}>＋ 口座</button>
        <button className="btn btn-x" onClick={() => addA("card")}>＋ カード</button></span>}>
        <div className="scroll">
          <table>
            <thead><tr><th style={{ minWidth: 140 }}>名前</th><th>種類</th><th className="n" style={{ minWidth: 104 }}>基準日の残高／未払</th><th>締日</th><th>支払月</th><th>支払日</th><th>引落口座</th><th></th></tr></thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={a.id}>
                  <td><input value={a.name} onChange={(e) => upA(a.id, "name", e.target.value)} /></td>
                  <td><select value={a.kind} onChange={(e) => upA(a.id, "kind", e.target.value)}>
                    <option value="bank">銀行</option><option value="cash">現金</option><option value="card">カード</option></select></td>
                  <td><input className="n" value={a.balance} onChange={(e) => upA(a.id, "balance", clampNum(e.target.value, 0, 1e12))} /></td>
                  {isCard(a) ? (
                    <>
                      <td style={{ width: 60 }}><input className="n" value={a.closingDay ?? 15} onChange={(e) => upA(a.id, "closingDay", clampNum(e.target.value, 1, 31))} /></td>
                      <td><select value={a.payMonthOffset ?? 1} onChange={(e) => upA(a.id, "payMonthOffset", Number(e.target.value))}>
                        <option value={0}>当月</option><option value={1}>翌月</option><option value={2}>翌々月</option></select></td>
                      <td style={{ width: 60 }}><input className="n" value={a.payDay ?? 10} onChange={(e) => upA(a.id, "payDay", clampNum(e.target.value, 1, 31))} /></td>
                      <td><select value={a.settleAccountId} onChange={(e) => upA(a.id, "settleAccountId", e.target.value)}>
                        {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></td>
                    </>
                  ) : <td colSpan={4} className="note">—</td>}
                  <td><button className="btn btn-x btn-d" onClick={() => delA(a.id)}>削除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note" style={{ marginTop: 8 }}>
          例：15日締め・翌月10日払いなら 締日15／支払月「翌月」／支払日10。カードで払った支出は、利用日ではなくこの日に口座から出ていく前提で残高を計算します。
        </div>
      </Card>

      <div style={{ height: 12 }} />
      <Card title="定期項目" right={<button className="btn btn-x" onClick={addR}>＋ 追加</button>}>
        <div className="scroll">
          <table>
            <thead><tr><th style={{ minWidth: 150 }}>内容</th><th>収支</th><th>固定/変動</th><th>費目</th><th className="n" style={{ minWidth: 92 }}>金額</th><th>事業%</th><th>支払方法</th><th>日</th><th style={{ minWidth: 96 }}>対象月</th><th></th></tr></thead>
            <tbody>
              {data.recurring.map((r) => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.45 }}>
                  <td><input value={r.name} onChange={(e) => upR(r.id, "name", e.target.value)} /></td>
                  <Row e={r} on={(k, v) => upR(r.id, k, v)} />
                  <td style={{ width: 56 }}><input className="n" value={r.day} onChange={(e) => upR(r.id, "day", clampNum(e.target.value, 1, 31))} /></td>
                  <td><input value={r.months ? r.months.join(",") : ""} placeholder="毎月"
                    onChange={(e) => { const v = e.target.value.trim(); upR(r.id, "months", v ? v.split(/[,、\s]+/).map(Number).filter((n) => n >= 1 && n <= 12) : null); }} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-x" onClick={() => upR(r.id, "active", !r.active)}>{r.active ? "停止" : "再開"}</button>{" "}
                    <button className="btn btn-x btn-d" onClick={() => setData((d) => ({ ...d, recurring: d.recurring.filter((x) => x.id !== r.id) }))}>削除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note" style={{ marginTop: 8 }}>
          「日」に31で月末に寄せます。「対象月」に 6,8,10,1 と書くとその月だけ発生します（住民税など）。「事業%」が家事按分です。100なら全額経費、0なら家計、40なら4割を事業経費として集計します。
        </div>
      </Card>

      <div style={{ height: 12 }} />
      <Card title="単発の予定" right={<button className="btn btn-x" onClick={addO}>＋ 追加</button>}>
        <div className="scroll">
          <table>
            <thead><tr><th style={{ minWidth: 126 }}>日付</th><th style={{ minWidth: 150 }}>内容</th><th>収支</th><th>固定/変動</th><th>費目</th><th className="n" style={{ minWidth: 92 }}>金額</th><th>事業%</th><th>支払方法</th><th></th></tr></thead>
            <tbody>
              {[...data.oneoffs].sort((a, b) => a.date.localeCompare(b.date)).map((o) => (
                <tr key={o.id}>
                  <td><input type="date" value={o.date} onChange={(e) => upO(o.id, "date", e.target.value)} /></td>
                  <td><input value={o.name} onChange={(e) => upO(o.id, "name", e.target.value)} /></td>
                  <Row e={o} on={(k, v) => upO(o.id, k, v)} />
                  <td><button className="btn btn-x btn-d" onClick={() => setData((d) => ({ ...d, oneoffs: d.oneoffs.filter((x) => x.id !== o.id) }))}>削除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* ========================= ルート ========================= */
const KEY = "cashflow:v2";

export default function App() {
  const today = useMemo(() => new Date(), []);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("dash");
  const [navOpen, setNavOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(KEY, false);
        const p = JSON.parse(r.value);
        setData(p && p.version === 2 ? p : seedData(today));
      } catch { setData(seedData(today)); }
      finally { setReady(true); }
    })();
  }, [today]);

  useEffect(() => {
    if (!ready || !data) return;
    const id = setTimeout(async () => {
      try { await window.storage.set(KEY, JSON.stringify(data), false); }
      catch { setErr("保存できませんでした。入力内容はこの画面でだけ保持されています。"); }
    }, 400);
    return () => clearTimeout(id);
  }, [data, ready]);

  const resetAll = () => { if (confirm("入力内容を消してサンプルに戻します。よろしいですか？")) setData(seedData(today)); };

  const from = data ? parseYMD(data.asOf) : today;
  const to = useMemo(() => addDays(addMonths(today, 21), -1), [today]);
  const forecast = useMemo(() => (data ? buildForecast(data, from, to) : []), [data, to]);
  const series = useMemo(() => (data ? buildSeries(data, forecast, from, to, today) : null), [data, forecast, to, today]);
  const accById = useMemo(() => Object.fromEntries((data?.accounts || []).map((a) => [a.id, a])), [data]);

  if (!ready || !data || !series) return <div className="wrap"><style>{CSS}</style><div className="empty" style={{ paddingTop: 80 }}>読み込み中…</div></div>;

  const t = toYMD(today);
  const row = series.rows.find((r) => r.date === t);
  const cur = row?.act ?? 0;
  const in30 = series.rows.find((r) => r.date === toYMD(addDays(today, 30)))?.proj ?? cur;
  const in90 = series.rows.find((r) => r.date === toYMD(addDays(today, 90)))?.proj ?? cur;
  const cardDue = data.accounts.filter(isCard).reduce((s, c) => s + (row?.["card_" + c.id] ?? 0), 0);

  const TABS = [["dash", "ダッシュボード"], ["cf", "キャッシュフロー"], ["pl", "年月別 収支"], ["entry", "実績入力"], ["imp", "CSV取込"], ["set", "予定の設定"]];

  return (
    <div className="wrap">
      <style>{CSS}</style>
      <div className="app" data-nav={navOpen ? "1" : "0"}>
        <aside className="side">
          <div className="brand">
            <span className="mark">Sakiguri</span>
            <span className="sub">個人事業主の資金繰り帳</span>
          </div>
          <nav className="nav">
            {TABS.map(([k, l]) => (
              <button key={k} data-on={tab === k ? "1" : "0"} onClick={() => setTab(k)}>{l}</button>
            ))}
          </nav>
          <div className="side-foot">
            基準日 {data.asOf}<br />
            防衛ライン {yen(data.reserveLine)}
          </div>
        </aside>

        <div className="content">
          <div className="topstrip">
            <button className="navtoggle" aria-label="ナビゲーションの表示切替"
              onClick={() => setNavOpen(!navOpen)}>{navOpen ? "«" : "»"}</button>
            <div className="bal-main">
              <div className="lbl">現預金残高（{mdLabel(t)}）</div>
              <div className="v">{yen(cur)}</div>
            </div>
            <div className="bal-sub"><span className="v">{yen(in30)}</span>30日後の予測</div>
            <div className="bal-sub"><span className="v">{yen(in90)}</span>90日後の予測</div>
            {cardDue > 0 && <div className="bal-sub"><span className="v cardv">{yen(cardDue)}</span>カード未払</div>}
          </div>

          <div className="main">
            {err && <div className="warn" style={{ marginBottom: 12 }}>{err}</div>}
            {tab === "dash" && <Dashboard data={data} forecast={forecast} series={series} today={today} />}
            {tab === "cf" && <Cashflow data={data} setData={setData} series={series} today={today} accById={accById} />}
            {tab === "pl" && <PL data={data} forecast={forecast} today={today} />}
            {tab === "entry" && <Entry data={data} setData={setData} series={series} today={today} />}
            {tab === "imp" && <Import data={data} setData={setData} series={series} today={today} />}
            {tab === "set" && <Settings data={data} setData={setData} resetAll={resetAll} />}
          </div>
        </div>
      </div>
    </div>
  );
}
