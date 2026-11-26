/**
 * The round mark of a person: the first letters (always there), and over them the picture when there is one (their own, or the Google one). A picture that cannot be loaded (its address ran out) draws nothing, so the letters show: an image with
 * an empty text has no broken-picture mark. The picture is decoration next to the name, so it has no text of its own. No script of its own: it is drawn by the server and inside the menu alike.
 */
export function Avatar({ url, letters, className }: { url: string | null; letters: string; className: string }) {
  return (
    <span aria-hidden="true" className={`${className} relative overflow-hidden`}>
      {letters}
      {url ? (
        // the picture is a CSS background, not an <img>: a link that has run out (Google's photo links do) then draws nothing, where an <img> that cannot load shows the browser's broken-picture mark over the letters (seen on the live app, 26 Nov). A background needs no script and is allowed by the same img-src.
        <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${JSON.stringify(url)})` }} />
      ) : null}
    </span>
  );
}
