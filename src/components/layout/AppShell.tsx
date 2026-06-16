interface Props { children: React.ReactNode }
export function AppShell({ children }: Props) {
  return (
    <div className='flex min-h-0 flex-1 gap-3 overflow-hidden p-3 pb-2 max-lg:flex-col max-lg:overflow-y-auto'>{children}</div>
  );
}
