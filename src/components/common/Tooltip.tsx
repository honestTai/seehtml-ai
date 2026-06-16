interface Props { text: string; children: React.ReactNode }
export function Tooltip({ text, children }: Props) {
  return (
    <div className="relative group inline-block">
      {children}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-[var(--color-bg-tertiary)] border border-[var(--color-border)] rounded text-xs text-[var(--color-text-primary)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
        {text}
      </div>
    </div>
  );
}
