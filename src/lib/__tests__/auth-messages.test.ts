import { describe, expect, it } from "vitest";

import {
  ACTION_LABEL,
  confirmFailure,
  confirmTypeUnknown,
  passwordUpdated,
  resendNotice,
  signInFailure,
  signUpFailure,
  signUpNotice,
  type AuthAction,
  type AuthMessage,
} from "../auth-messages";

/**
 * AC-51 / AC-53。
 *
 * **ここで守りたいのは「状態を漏らさない」こと。** 文面が親切になる方向の
 * 変更は、たいてい状態を漏らす方向でもある。どちらに倒れても落ちるように、
 * **禁じた語を列挙して全文面に当てる。**
 */

/**
 * 状態を**断定する**語。1つでも出たら AC-51 / AC-53 を破っている。
 *
 * **「登録」という語そのものは禁じない。** AC-51 の文面は
 * 「すでに登録済みの**可能性があります**」を許している。断定していない
 * からである。禁じるのは言い切りの形だけで、ぼかした形は下の規則で見る。
 */
const FORBIDDEN = [
  "すでに登録されています",
  "既に登録されています",
  "登録済みです",
  "登録されていません",
  "登録がありません",
  "アカウントが見つかりません",
  "存在しません",
  "パスワードが違います",
  "パスワードが間違",
];

/**
 * 登録の有無に触れる語。**触れるなら、必ずぼかしていること。**
 *
 * 断定の形を全部列挙するのは無理なので、**「触れたら可能性と書く」**
 * という規則のほうを検査する。言い回しを変えても規則は残る。
 */
const HEDGE_REQUIRED = ["登録済み", "登録されて", "アカウントがあ"];

/* 認証基盤が返す英語。そのまま出さない（AC-53） */
const ENGLISH = [
  "Invalid login credentials",
  "Email not confirmed",
  "User already registered",
  "Password should be",
];

const ALL: { name: string; message: AuthMessage }[] = [
  { name: "signUpNotice", message: signUpNotice() },
  { name: "resendNotice", message: resendNotice() },
  { name: "signInFailure(email_not_confirmed)", message: signInFailure("email_not_confirmed") },
  { name: "signInFailure(invalid_credentials)", message: signInFailure("invalid_credentials") },
  { name: "signInFailure(user_not_found)", message: signInFailure("user_not_found") },
  { name: "signInFailure(undefined)", message: signInFailure(undefined) },
  { name: "signInFailure(over_request_rate_limit)", message: signInFailure("over_request_rate_limit") },
  { name: "signUpFailure(weak_password)", message: signUpFailure("weak_password") },
  { name: "signUpFailure(validation_failed)", message: signUpFailure("validation_failed") },
  { name: "signUpFailure(user_already_exists)", message: signUpFailure("user_already_exists") },
  { name: "signUpFailure(undefined)", message: signUpFailure(undefined) },
  { name: "confirmFailure(otp_expired)", message: confirmFailure("otp_expired") },
  { name: "confirmFailure(undefined)", message: confirmFailure(undefined) },
  { name: "confirmTypeUnknown", message: confirmTypeUnknown() },
  { name: "passwordUpdated", message: passwordUpdated() },
];

describe("AC-51/AC-53 どの文面もアカウントの状態を漏らさない", () => {
  it.each(ALL)("$name", ({ message }) => {
    for (const word of FORBIDDEN) {
      expect(message.text, `禁じた語「${word}」が出ている`).not.toContain(word);
    }
    for (const word of ENGLISH) {
      expect(message.text, `英語の原文「${word}」が出ている`).not.toContain(word);
    }
    for (const word of HEDGE_REQUIRED) {
      if (message.text.includes(word)) {
        expect(
          message.text,
          `「${word}」に触れているのに、ぼかしていない（「可能性」が無い）`,
        ).toContain("可能性");
      }
    }
  });

  it("「登録しました」と成立を断定しない（AC-51）", () => {
    expect(signUpNotice().text).not.toContain("登録しました");
    /* 「送った」という動作だけを書く */
    expect(signUpNotice().text).toContain("確認メールをお送りしました");
  });

  it("「すでに登録済みの可能性があります」は断定ではない（AC-51）", () => {
    expect(signUpNotice().text).toContain("可能性があります");
  });
});

describe("AC-53 区別してよいものとよくないもの", () => {
  it("確認が済んでいないときだけ専用の文面", () => {
    const unconfirmed = signInFailure("email_not_confirmed");

    expect(unconfirmed.text).toContain("確認が済んでいません");
    expect(unconfirmed.actions).toContain<AuthAction>("resend");
  });

  it("**パスワード違いと未登録は同一の文面**", () => {
    /* 認証基盤はどちらも invalid_credentials を返すが、将来べつの
       コードが来ても同じ文面に寄せる。**区別すると登録の有無が漏れる** */
    const a = signInFailure("invalid_credentials");
    const b = signInFailure("user_not_found");
    const c = signInFailure(undefined);

    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(a.text).toBe("メールアドレスまたはパスワードが正しくありません。");
  });

  it("その文面と同じ場所に、再設定と新規登録の両方の導線がある", () => {
    const actions = signInFailure("invalid_credentials").actions;

    expect(actions).toContain<AuthAction>("reset");
    expect(actions).toContain<AuthAction>("signup");
  });

  it("新規登録のあとは、サインインと再設定への導線がある（AC-51）", () => {
    const actions = signUpNotice().actions;

    expect(actions).toContain<AuthAction>("signin");
    expect(actions).toContain<AuthAction>("reset");
  });
});

describe("AC-52 受け口の文面はリンクについて書く", () => {
  it("アカウントの有無に触れない", () => {
    for (const message of [confirmFailure("otp_expired"), confirmFailure(undefined)]) {
      expect(message.text).toContain("リンク");
      expect(message.text).not.toContain("アカウント");
    }
  });

  it("知らない type は既定で通さない", () => {
    expect(confirmTypeUnknown().text).toContain("扱えません");
  });
});

describe("導線のラベルが全種類そろっている", () => {
  /* 列挙を集合と突き合わせる（CLAUDE.md §2.8）。
     AuthAction を増やしてラベルを足し忘れると落ちる */
  it("どの文面の導線にもラベルがある", () => {
    for (const { message } of ALL) {
      for (const action of message.actions) {
        expect(ACTION_LABEL[action], `${action} のラベルが無い`).toBeTruthy();
      }
    }
  });
});
