/**
 * The sign-in providers' marks, as the providers publish them (owner, 26 Nov 2026: "Continue with Google" had no Google "G"). Inline SVG, the shapes and colours unaltered, drawn 18 px inside a 22 px white badge so the mark has its clear space and keeps its own colours on the light and the dark button alike (Google's rules: the "G" is never recoloured, and on a dark surface it sits on a light one).
 * Decorative: the button's own words ("Continue with Google") are its name, so the icon is hidden from screen readers and takes no focus.
 */
const badge = "inline-flex size-[22px] shrink-0 items-center justify-center rounded-full bg-white";

export function GoogleG() {
  return (
    <span data-provider-icon="google" aria-hidden="true" className={badge}>
      <svg width="18" height="18" viewBox="0 0 48 48" focusable="false" xmlns="http://www.w3.org/2000/svg">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
    </span>
  );
}

export function FacebookF() {
  return (
    <span data-provider-icon="facebook" aria-hidden="true" className={badge}>
      <svg width="20" height="20" viewBox="0 0 24 24" focusable="false" xmlns="http://www.w3.org/2000/svg">
        <path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        <path fill="#fff" d="M16.671 15.543l.532-3.47h-3.328v-2.25c0-.949.465-1.874 1.956-1.874h1.513V4.996s-1.374-.235-2.686-.235c-2.741 0-4.533 1.662-4.533 4.669v2.643H7.078v3.47h3.047v8.385a12.1 12.1 0 003.75 0v-8.385h2.796z" />
      </svg>
    </span>
  );
}
