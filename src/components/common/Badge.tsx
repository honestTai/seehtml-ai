interface Props { variant?: 'success' | 'warning' | 'danger' | 'default'; children: React.ReactNode }
export function Badge({ variant = 'default', children }: Props) {
  const colors = {
    success: 'bg-green-900/30 text-green-400 border-green-800',
    warning: 'bg-yellow-900/30 text-yellow-400 border-yellow-800',
    danger: 'bg-red-900/30 text-red-400 border-red-800',
    default: 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] border-[var(--color-border)]',
  };
  return <span className={`inline-block px-2 py-0.5 rounded text-xs border ${colors[variant]}`}>{children}</span>;
}
