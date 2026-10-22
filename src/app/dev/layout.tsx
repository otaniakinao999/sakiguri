/**
 * /dev 配下を本番から外す
 *
 * この下のページは **AuthGate の外**に置いてある。Supabase に繋がらない
 * 環境でも開けるようにするためで（確認用）、本番に出す意図はない。
 * リポジトリも Vercel の本番 URL も公開なので、ここで塞がないと
 * URL を知っている人は誰でも開ける。中身は架空の数字だけだが、出さない。
 *
 * **塞ぐのは本番だけ。** プレビューとローカルでは開ける（VERCEL_ENV が
 * "production" 以外、または未設定）。確認はそちらでする。
 */

import { notFound } from "next/navigation";

export default function DevLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (process.env.VERCEL_ENV === "production") {
    notFound();
  }
  return <>{children}</>;
}
