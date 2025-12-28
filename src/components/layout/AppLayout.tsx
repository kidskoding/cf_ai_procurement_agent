import React from "react";
// Deprecated: Layout moved to Page level for streamlined single-column procurement interface.
// Retained as empty stub to prevent import breaks during migration.
type AppLayoutProps = {
  children: React.ReactNode;
  container?: boolean;
  className?: string;
  contentClassName?: string;
};
export function AppLayout({ children }: AppLayoutProps): JSX.Element {
  return <>{children}</>;
}