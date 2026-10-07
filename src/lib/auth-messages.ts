/**
 * 認証の画面に出す文面（AC-51・AC-53）
 *
 * 一次情報：docs/要件定義書.md §5.3、AC-51、AC-53
 *
 * ## 原則：アカウントの状態ではなく、こちらが行った動作を書く
 *
 * | 書いてはいけない | 書く |
 * |---|---|
 * | 登録しました | このアドレス宛に確認メールをお送りしました |
 * | すでに登録されています | （同じ文面。状態に触れない） |
 * | そのアドレスは登録されていません | メールアドレスまたはパスワードが正しくありません |
 *
 * **状態を言うと、任意のアドレスを入れて登録の有無を調べられる。**
 * 認証基盤が同じ応答を返すのは制約ではなく設計で、こちらで区別し直すのは
 * その設計を無効にする行為である。
 *
 * **状態を言わない代償は、利用者が自力で進める導線で払う。**
 *
 * ## 「確認が済んでいない」だけは区別してよい
 *
 * 認証基盤がこの状態に専用の応答（`email_not_confirmed`）を返すため、
 * **アプリが隠しても列挙は防げない。** 隠した場合の損失だけが残る（§5.3）。
 *
 * **安全と使いやすさがぶつかったとき、「安全側に寄せる」の一言で決めない。
 * 隠して実際に何かが防げるかを、応答の形ごとに確かめて決める。**
 *
 * この層は純粋な変換。React を import しない。
 */

/** 画面に出す案内。`actions` は同じ場所に置く導線 */
export interface AuthMessage {
  text: string;
  /** 利用者が自力で進むための導線。状態を言わない代償をここで払う */
  actions: AuthAction[];
}

export type AuthAction = "signin" | "signup" | "resend" | "reset";

export const ACTION_LABEL: Record<AuthAction, string> = {
  signin: "サインインする",
  signup: "新規登録する",
  resend: "確認メールを再送する",
  reset: "パスワードを再設定する",
};

/**
 * 新規登録のあとに出す案内（AC-51）。
 *
 * **新規のアドレスでも既存のアドレスでも同じ文面。** 呼び出し側は応答の
 * 中身で分岐しない。引数を取らないのはそのためで、**分岐しようがない形に
 * してある。**
 *
 * 「すでに登録済みの可能性があります」は状態を断定していない。可能性として
 * 書くことで、既存の利用者は進む道が分かり、新規の利用者には何も漏れない。
 */
export function signUpNotice(): AuthMessage {
  return {
    text:
      "このメールアドレス宛に確認メールをお送りしました。" +
      "メールのリンクを開いて登録を完了してください。" +
      "メールが届かない場合は、すでに登録済みの可能性があります。",
    actions: ["signin", "reset"],
  };
}

/**
 * 認証の失敗を日本語にする（AC-53）。
 *
 * **認証基盤が返す英語をそのまま出さない。** 日本語の画面に
 * `Invalid login credentials` と出ると、そこで利用者が止まる。
 *
 * `code` は `AuthError.code`。未知のコードは共通の文面に寄せる。
 * **分からないものを「登録されていません」側に倒さない。**
 */
export function signInFailure(code: string | undefined): AuthMessage {
  if (code === "email_not_confirmed") {
    return {
      text:
        "メールアドレスの確認が済んでいません。" +
        "登録時にお送りした確認メールのリンクを開いてください。",
      actions: ["resend"],
    };
  }

  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
    return {
      text: "試行が続いたため、しばらく受け付けられません。時間をおいてからお試しください。",
      actions: [],
    };
  }

  /**
   * **パスワード違いと未登録を区別しない。**
   *
   * どちらも `invalid_credentials` が返る。区別して見せると、任意の
   * アドレスを入れて登録の有無を調べられる（AC-53）。
   *
   * 未知のコードもここに寄せる。
   */
  return {
    text: "メールアドレスまたはパスワードが正しくありません。",
    actions: ["reset", "signup"],
  };
}

/** 新規登録そのものが失敗したとき（弱いパスワードなど） */
export function signUpFailure(code: string | undefined): AuthMessage {
  if (code === "weak_password") {
    return {
      text: "パスワードが短すぎます。6文字以上にしてください。",
      actions: [],
    };
  }
  if (code === "validation_failed") {
    return {
      text: "メールアドレスの形式が正しくありません。",
      actions: [],
    };
  }
  if (code === "over_email_send_rate_limit") {
    return {
      text: "確認メールの送信が続いたため、しばらく受け付けられません。時間をおいてからお試しください。",
      actions: [],
    };
  }
  /* **ここに `user_already_exists` を書かない。** 書くと AC-51 を破る。
     既存アドレスは `signUp` がエラーを返さないので通常ここには来ないが、
     設定によっては来る。そのときも状態を言わない */
  return {
    text:
      "登録を受け付けられませんでした。" +
      "メールアドレスとパスワードを確かめて、もう一度お試しください。",
    actions: ["signin", "reset"],
  };
}

/**
 * 確認リンクの受け口（`/auth/confirm`）での失敗（AC-52）。
 *
 * **リンクについて書き、アカウントについて書かない。** 「そのアカウントは
 * 存在しません」と書くと、リンクを組み立てて登録の有無を調べられる。
 * 原則は §5.3 と同じで、**こちらが行った動作（検証）の結果だけを書く。**
 */
export function confirmFailure(code: string | undefined): AuthMessage {
  if (code === "otp_expired") {
    return {
      text:
        "リンクの有効期限が切れているか、すでに使われています。" +
        "サインインを試すか、確認メールを送り直してください。",
      actions: ["signin"],
    };
  }
  return {
    text:
      "リンクを確認できませんでした。" +
      "メールのリンクをもう一度開くか、サインインを試してください。",
    actions: ["signin"],
  };
}

/**
 * `type` が想定外のとき。
 *
 * **既定で通さない。** 知らない種類の検証を実行しない。
 */
export function confirmTypeUnknown(): AuthMessage {
  return {
    text: "このリンクは扱えません。メールのリンクをそのまま開いてください。",
    actions: ["signin"],
  };
}

/** パスワードを設定し直したあと */
export function passwordUpdated(): AuthMessage {
  return {
    text: "新しいパスワードを設定しました。",
    actions: [],
  };
}

/** 確認メールを再送したあと。**送ったという動作だけを書く** */
export function resendNotice(): AuthMessage {
  return {
    text:
      "このメールアドレス宛に確認メールをお送りしました。" +
      "届かない場合は、迷惑メールフォルダもご確認ください。",
    actions: [],
  };
}
