/* Stack19 web call widget (STUB, job DT): the button a business puts on its own website.
 * Usage: <script src="https://stack19.com/widget.js" data-key="PUBLIC_WIDGET_KEY" async></script>
 * Today it only shows the button and the greeting from a fake media channel: no microphone is opened and nothing is sent. Real audio and the session call (app/parity/widget.py) are not wired yet. */
(function () {
  var s = document.currentScript;
  if (!s || !s.getAttribute("data-key")) return;
  var b = document.createElement("button");
  b.type = "button";
  b.textContent = "Talk to our assistant";
  b.setAttribute("aria-label", "Talk to our AI assistant (preview)");
  b.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483000;padding:12px 18px;border:0;border-radius:999px;background:#c2410c;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer";
  b.addEventListener("click", function () {
    window.alert("Preview: the voice assistant is not connected yet. No microphone was used and nothing was sent.");
  });
  document.body.appendChild(b);
})();
