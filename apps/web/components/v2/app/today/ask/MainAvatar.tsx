/** The Main agent's face: the person at the head of the table in the 3D room (grey crop and beard, charcoal blazer, orange tie), drawn flat. Decorative: the name next to it is the label. */
export function MainAvatar({ className = "size-11" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="main-avatar-clip">
          <circle cx="24" cy="24" r="24" />
        </clipPath>
      </defs>
      <circle cx="24" cy="24" r="24" fill="var(--v2-brand-bg)" />
      <g clipPath="url(#main-avatar-clip)">
        <path d="M2 50c1-11 9-16 22-16s21 5 22 16z" fill="#34323a" />
        <path d="M19.5 33.5L24 41l4.5-7.5z" fill="#f4f2ee" />
        <path d="M22.8 35.5h2.4l1 8-2.2 2-2.2-2z" fill="#ff773c" />
        <rect x="20.5" y="26" width="7" height="8" rx="2.5" fill="#9c6a4a" />
        <ellipse cx="24" cy="19.5" rx="7.4" ry="8.4" fill="#b07a58" />
        <path d="M16.2 19.5c-.5-7 3.2-10.6 7.8-10.6s8.3 3.6 7.8 10.6c-1.3-3.2-3.4-4.6-7.8-4.6s-6.5 1.4-7.8 4.6z" fill="#5a5655" />
        <path d="M16.8 21c.4 6.4 3.2 9.6 7.2 9.6s6.8-3.2 7.2-9.6c-1.2 2.6-3.4 3.8-7.2 3.8s-6-1.2-7.2-3.8z" fill="#5a5655" />
        <circle cx="20.8" cy="19.6" r="1" fill="#2b1d14" />
        <circle cx="27.2" cy="19.6" r="1" fill="#2b1d14" />
        <path d="M22 26.3q2 1.1 4 0" stroke="#f4f2ee" strokeWidth=".9" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}
