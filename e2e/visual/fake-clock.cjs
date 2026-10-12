// Preloaded into the web server of the visual tests (NODE_OPTIONS=--require): the server's clock stands still at FIXED_NOW, so "today", "5 minutes ago" and the greeting are the same in every picture.
// Only Date is replaced; timers still run. Test-only: it is never part of the app.
const FIXED = Date.parse(process.env.VISUAL_FIXED_NOW || "2026-10-14T05:00:00.000Z");
const RealDate = Date;
class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(FIXED);
    else super(...args);
  }
  static now() {
    return FIXED;
  }
}
// the proxy runs in its own sandbox that copies OWN properties of Date: give the fake every static of the real one
FakeDate.parse = RealDate.parse;
FakeDate.UTC = RealDate.UTC;
global.Date = FakeDate;
