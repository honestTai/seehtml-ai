interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}
export function Button({ variant = 'primary', size = 'md', className = '', children, ...rest }: Props) {
  const base = 'inline-flex items-center justify-center rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const variants = {
    primary: 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white',
    secondary: 'bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-border)] text-[var(--color-text-primary)] border border-[var(--color-border)]',
    ghost: 'hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)]',
  };
  const sizes = { sm: 'px-2 py-1 text-xs', md: 'px-3 py-1.5 text-sm', lg: 'px-4 py-2 text-base' };
  return <button className={[`${base} ${variants[variant]} ${sizes[size]}`, className].join(' ')} {...rest}>{children}</button>;
}
