interface Props { size?: 'sm' | 'md' | 'lg'; label?: string }
export function LoadingSpinner({ size = 'md', label }: Props) {
  const sizes = { sm: 'w-3 h-3', md: 'w-5 h-5', lg: 'w-8 h-8' };
  return (
    <div className="flex items-center gap-2 text-[var(--color-text-secondary)]">
      <div className={`animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] ${sizes[size]}`} />
      {label && <span className="text-xs">{label}</span>}
    </div>
  );
}
