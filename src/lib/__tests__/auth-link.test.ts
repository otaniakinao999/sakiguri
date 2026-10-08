import { describe, expect, it } from "vitest";

import { resolveAuthLink } from "../auth-link";

/**
 * AC-52。**順位そのものを対象にする。**
 *
 * 各経路を別々に試すだけでは、**順位が入れ替わっても落ちない。**
 * `token_hash` の経路はいま実際のリンクでは使われない（`emailRedirectTo` で
 * 断片が来る）ので、順位が壊れても誰も気づかない。SMTP を入れて
 * テンプレートを書き換えたときに初めて壊れているのが分かる。
 */

const HASH = "access_token=at-1&refresh_token=rt-1&type=signup&expires_in=3600";

describe("AC-52 順位：クエリの token_hash が断片より先", () => {
  it("**両方が揃っていたら token_hash を選ぶ**", () => {
    const got = resolveAuthLink("?token_hash=th-1&type=recovery", `#${HASH}`);

    expect(got).toEqual({ kind: "verify", tokenHash: "th-1", type: "recovery" });
  });

  it("両方が揃っていても、断片の値は結果に出ない", () => {
    const got = resolveAuthLink("?token_hash=th-1&type=signup", `#${HASH}`);

    expect(JSON.stringify(got)).not.toContain("at-1");
    expect(JSON.stringify(got)).not.toContain("rt-1");
  });

  it("token_hash があって種別が未知なら、断片に落とさず拒む", () => {
    /* **落とすと2つの機構が競う。** 1つ目で決まったら2つ目を見ない */
    const got = resolveAuthLink("?token_hash=th-1&type=magiclink", `#${HASH}`);

    expect(got).toEqual({ kind: "reject", reason: "unknownType" });
  });
});

describe("AC-52 それぞれの経路", () => {
  it("クエリだけなら verify", () => {
    expect(resolveAuthLink("?token_hash=th-1&type=signup", "")).toEqual({
      kind: "verify",
      tokenHash: "th-1",
      type: "signup",
    });
  });

  it("断片だけなら session", () => {
    expect(resolveAuthLink("", `#${HASH}`)).toEqual({
      kind: "session",
      accessToken: "at-1",
      refreshToken: "rt-1",
      type: "signup",
    });
  });

  it("recovery も受ける", () => {
    const hash = HASH.replace("type=signup", "type=recovery");

    expect(resolveAuthLink("", `#${hash}`)).toMatchObject({
      kind: "session",
      type: "recovery",
    });
  });

  it("`#` と `?` が付いていなくても読める", () => {
    expect(resolveAuthLink("token_hash=th-1&type=signup", "")).toMatchObject({
      kind: "verify",
    });
    expect(resolveAuthLink("", HASH)).toMatchObject({ kind: "session" });
  });
});

describe("AC-52 既定で通さない", () => {
  it("断片の error= は受けるが、何も実行しない", () => {
    const got = resolveAuthLink(
      "",
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid",
    );

    expect(got).toEqual({ kind: "reject", reason: "linkError" });
  });

  it("error_code だけでも拒む", () => {
    expect(resolveAuthLink("", "#error_code=otp_expired")).toEqual({
      kind: "reject",
      reason: "linkError",
    });
  });

  it("断片の種別が未知なら拒む", () => {
    const hash = HASH.replace("type=signup", "type=magiclink");

    expect(resolveAuthLink("", `#${hash}`)).toEqual({
      kind: "reject",
      reason: "unknownType",
    });
  });

  it("refresh_token が欠けていたら拒む", () => {
    expect(resolveAuthLink("", "#access_token=at-1&type=signup")).toEqual({
      kind: "reject",
      reason: "missing",
    });
  });

  it("何も無ければ拒む", () => {
    expect(resolveAuthLink("", "")).toEqual({ kind: "reject", reason: "missing" });
  });

  it("関係のないクエリだけでも拒む", () => {
    expect(resolveAuthLink("?utm_source=mail", "")).toEqual({
      kind: "reject",
      reason: "missing",
    });
  });
});
