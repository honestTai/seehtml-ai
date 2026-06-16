interface Props { children: React.ReactNode }
export function AppShell({ children }: Props) {
  return (
    <div className='flex min-h-0 flex-1 overflow-hidden border-t border-[var(--color-border)] bg-[var(--color-bg-primary)] max-lg:flex-col max-lg:overflow-y-auto'>{children}</div>
  );
}
