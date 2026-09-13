# 0009. Account を判別可能なユニオンにする

## 文脈

要件定義書 §3.2 の Account は、必須列に「card時○」と書かれた項目を4つ持つ。

| 項目 | 必須 |
|---|---|
| closingDay | card時○ |
| payMonthOffset | card時○ |
| payDay | card時○ |
| settleAccountId | card時○ |

表をそのまま1つの interface に写すと、この4項目は省略可能（`closingDay?: number`）になる。すると CL-2 でカードを扱うたびに、`kind === 'card'` を確かめたうえで、4項目が実際に入っているかを別途確かめることになる。

引落日の計算は `closingDay` と `payMonthOffset` と `payDay` の3つすべてを使う。1つでも欠けると、既定値で補うか例外を投げるかの判断がその場ごとに要る。CL-2 だけでなく、CL-8（借入返済）や将来の画面からも同じ検査を書くことになる。

## 判断

`kind` を判別子とする**判別可能なユニオン**にする。

```ts
export interface DepositAccount extends AccountBase { kind: "bank" | "cash" }
export interface CardAccount extends AccountBase {
  kind: "card";
  closingDay: number;
  payMonthOffset: number;
  payDay: number;
  settleAccountId: string;
}
export type Account = DepositAccount | CardAccount;

export function isCard(a: Account): a is CardAccount { return a.kind === "card"; }
```

## 理由

**「card時○」は要件定義書が書いている制約そのものである。** 型で表せるものを型で表しただけで、仕様を足していない。

`isCard()` を1回通せば4項目が揃っていることが確定する。CL-2 の `settleDateOf` は `CardAccount` を受け取るので、呼ぶ側でしか検査が要らず、検査は型検査で済む。[ADR-0007](0007-coreは壊れた入力を投げて止める.md) で「壊れた入力は投げる」と決めたが、投げる必要のある箇所をひとつ減らせる。

CL-9（売掛金の入金予定）の Counterparty も同じ構造（締日・支払月・支払日）を持つ。v2.0 で型を起こすときに同じ形を使える。

## 却下した選択肢

**要件定義書の表どおり、省略可能な項目を持つ1つの interface にする。** 表との対応は分かりやすい。ただしカードを扱うすべての箇所で `card.closingDay!` の非 null 断言か実行時検査が要る。非 null 断言は、断言が外れたときに `undefined` が計算に流れ込み、`NaN` の日付や `Invalid Date` を生む。金額の計算で最も避けたい壊れ方。

**そのままにして、境界で zod により検証する。** 保存データを読む時点で検証する案。境界での検証自体は将来必要になるが、それは「保存データが仕様に合っているか」の話であり、「型の上でカードなら4項目が揃っている」こととは別の問題。両方あってよいが、後者を前者で代替はできない。

**カード固有の設定を別テーブル（`CardSetting`）に分ける。** 正規化としては筋がよい。ただし要件定義書 §3.2 が Account 1つで表現しており、エンティティを増やすとデータモデルが仕様と食い違う。仕様に無い構造を作らない（CLAUDE.md §1）。

## 影響

- `Account` を組み立てるコードは `kind` に応じて必要な項目を揃える必要がある。揃っていなければ型検査で落ちる
- `accounts.filter(isCard)` は `CardAccount[]` に絞り込まれる。`accounts.filter(a => !isCard(a))` は `Account[]` のままなので、預金口座だけを型で得たい場合は述語を書く必要がある。現状は `balance` しか使わないため問題にしていない
- 要件定義書 §3.2 の表とは形が違う。表を読んでこの型を「直す」ことがないよう、`types.ts` にも理由を書いてある
- Supabase のテーブル設計（フェーズ3・タスク#12）では1テーブルに収まる。ユニオンはアプリ側の表現であり、永続化の形とは別

関連：[[0007-coreは壊れた入力を投げて止める]]
