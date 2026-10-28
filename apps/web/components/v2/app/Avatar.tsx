/**
 * The round mark of a person: the first letters (always there), and over them the picture when there is one (their own, or the Google one). A picture that cannot be loaded (its address ran out) draws nothing, so the letters show: an image with
 * an empty text has no broken-picture mark. The picture is decoration next to the name, so it has no text of its own. No script of its own: it is drawn by the server and inside the menu alike.
 */
export function Avatar({ url, letters, className }: { url: string | null; letters: string; className: string }) {
  return (
    <span aria-hidden="true" className={`${className} relative overflow-hidden`}>
      {letters}
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a signed link into the project's own Storage or Google's photo address (both named in img-src), shown as it is
        <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
      ) : null}
    </span>
  );
}
