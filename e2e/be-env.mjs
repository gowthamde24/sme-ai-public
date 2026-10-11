// Imported FIRST (ES modules run in import order): the real-stack run's own addresses. Never 3000 or 8000 (the owner's demo) or 8001 (another lane's API); be-lib.mjs refuses those.
process.env.E2E_WEB_URL ||= "http://localhost:3002";
process.env.E2E_API_URL ||= "http://localhost:8002";
process.env.E2E_SHOTS ||= new URL("./shots-be", import.meta.url).pathname;
