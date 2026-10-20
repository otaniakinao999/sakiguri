import { DevShell } from "../dev-shell";

export default function DevScreensLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <DevShell>{children}</DevShell>;
}
