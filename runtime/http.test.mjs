import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHttp, CloudflareError, encodeForm } from "./http.mjs";

let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/echo") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ method: req.method, ua: req.headers["user-agent"], ct: req.headers["content-type"] ?? null, body }));
      } else if (req.url === "/redirect") {
        res.writeHead(302, { Location: "/echo" });
        res.end();
      } else if (req.url === "/cf") {
        res.writeHead(403, { "Content-Type": "text/html" });
        res.end("<html><head><title>Just a moment...</title></head></html>");
      } else if (req.url === "/plain403") {
        res.writeHead(403);
        res.end("forbidden");
      } else {
        res.writeHead(404);
        res.end("nope");
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const http = () => createHttp({ userAgent: "AhogeTest/1" });

test("encodeForm encodes keys and values in order", () => {
  assert.equal(encodeForm({ "vars[s]": "a b", page: 0 }), "vars%5Bs%5D=a%20b&page=0");
});

test("get sends user agent and returns body", async () => {
  const res = await http().get(`${base}/echo`);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).ua, "AhogeTest/1");
  assert.equal(res.headers["content-type"], "application/json");
});

test("caller user agent wins", async () => {
  const res = await http().get(`${base}/echo`, { headers: { "User-Agent": "Custom" } });
  assert.equal(JSON.parse(res.body).ua, "Custom");
});

test("post with object body is form encoded", async () => {
  const res = await http().post(`${base}/echo`, { body: { a: "1", b: "x y" } });
  const echo = JSON.parse(res.body);
  assert.equal(echo.method, "POST");
  assert.equal(echo.ct, "application/x-www-form-urlencoded");
  assert.equal(echo.body, "a=1&b=x%20y");
});

test("redirects are followed and final url reported", async () => {
  const res = await http().get(`${base}/redirect`);
  assert.equal(res.url, `${base}/echo`);
});

test("non-2xx resolves", async () => {
  const res = await http().get(`${base}/missing`);
  assert.equal(res.status, 404);
  assert.equal(res.body, "nope");
});

test("plain 403 is not a Cloudflare challenge", async () => {
  const res = await http().get(`${base}/plain403`);
  assert.equal(res.status, 403);
});

test("Cloudflare challenge rejects with CloudflareError", async () => {
  await assert.rejects(http().get(`${base}/cf`), (e) => e instanceof CloudflareError && e.url === `${base}/cf`);
});
