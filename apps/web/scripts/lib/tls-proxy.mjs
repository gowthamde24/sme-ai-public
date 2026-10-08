// A tiny local HTTPS front for `next start`, used only by the WebKit and Firefox audit runs. Why: the production CSP
// carries `upgrade-insecure-requests`, which Safari's engine applies even to http://127.0.0.1, so every script and
// stylesheet of a plain-http local run fails with "a TLS error". Serving the page over https keeps the CSP exactly as
// it ships (nothing is stripped) and exercises the Secure cookie path. The certificate is self-signed, valid one day,
// made with the system `openssl` into the OS temp folder (reused if present, never deleted), and trusted only by the
// audit's own browser context (ignoreHTTPSErrors). The proxy listens on 127.0.0.1 only and forwards to the app.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

export async function startTlsProxy(targetBase, port = Number(process.env.TLS_PORT ?? 4176)) {
  const dir = path.join(os.tmpdir(), "sme-ai-audit-tls");
  fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  const stale = !fs.existsSync(cert) || Date.now() - fs.statSync(cert).mtimeMs > 20 * 3600 * 1000;
  if (stale) {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  }
  const target = new URL(targetBase);
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const up = http.request(
      { host: target.hostname, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, "x-forwarded-proto": "https" } },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    up.on("error", () => {
      res.statusCode = 502;
      res.end();
    });
    req.pipe(up);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return { base: `https://127.0.0.1:${port}`, stop: () => server.close() };
}
