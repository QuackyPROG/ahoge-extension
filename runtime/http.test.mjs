import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createHttp, CloudflareError, encodeForm, isCloudflareChallenge } from "./http.mjs";

const vectors = JSON.parse(readFileSync(new URL("./host-api-conformance.json", import.meta.url), "utf8")).http;

let server;
let base;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/echo") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ method: req.method, ua: req.headers["user-agent"], ct: req.headers["content-type"] ?? null, cl: req.headers["content-length"] ?? null, cookie: req.headers.cookie ?? null, body }));
      } else if (req.url === "/set") {
        res.setHeader("Set-Cookie", ["a=1; Path=/; HttpOnly; Secure; SameSite=Lax", "b=two=2; Max-Age=3600", "gone=x"]);
        res.end("set");
      } else if (req.url === "/delete") {
        res.setHeader("Set-Cookie", ["a=; Max-Age=0", "gone=; Expires=Thu, 01 Jan 1970 00:00:00 GMT"]);
        res.end("deleted");
      } else if (req.url === "/dups") {
        res.setHeader("Content-Type", "text/plain; charset=iso-8859-1");
        res.setHeader("Set-Cookie", ["p=1; Expires=Wed, 21 Oct 2037 07:28:00 GMT", "q=2"]);
        res.appendHeader("X-Dup", "one");
        res.appendHeader("X-Dup", "two");
        res.end(Buffer.from("café 日本", "utf8"));
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

test("encodeForm matches conformance vectors", () => {
  for (const v of vectors.encodeForm) assert.equal(encodeForm(v.input), v.expected, v.name);
});

test("isCloudflareChallenge matches conformance vectors", () => {
  for (const v of vectors.isCloudflareChallenge) assert.equal(isCloudflareChallenge(v.status, v.headers, v.body), v.expected, v.name);
});

test("string body is sent as UTF-8 bytes with no Content-Type", async () => {
  const res = await http().post(`${base}/echo`, { body: "café=1" });
  const echo = JSON.parse(res.body);
  assert.equal(echo.ct, null);
  assert.equal(echo.cl, "7");
  assert.equal(echo.body, "café=1");
});

test("string body keeps a caller Content-Type", async () => {
  const res = await http().post(`${base}/echo`, { body: "{}", headers: { "content-type": "application/json" } });
  assert.equal(JSON.parse(res.body).ct, "application/json");
});

test("response headers: lowercase names, duplicates joined, set-cookie joined by newline", async () => {
  const res = await http().get(`${base}/dups`);
  assert.equal(res.headers["x-dup"], "one, two");
  assert.equal(res.headers["set-cookie"], "p=1; Expires=Wed, 21 Oct 2037 07:28:00 GMT\nq=2");
  assert.ok(Object.keys(res.headers).every((k) => k === k.toLowerCase()));
});

test("body is always decoded as UTF-8", async () => {
  const res = await http().get(`${base}/dups`);
  assert.equal(res.body, "café 日本");
});

test("cookies are stored per host and sent back", async () => {
  const h = http();
  await h.get(`${base}/set`);
  const echo = JSON.parse((await h.get(`${base}/echo`)).body);
  assert.equal(echo.cookie, "a=1; b=two=2; gone=x");
});

test("a fresh runtime has an empty jar", async () => {
  const echo = JSON.parse((await http().get(`${base}/echo`)).body);
  assert.equal(echo.cookie, null);
});

test("a caller Cookie header wins over the jar", async () => {
  const h = http();
  await h.get(`${base}/set`);
  const echo = JSON.parse((await h.get(`${base}/echo`, { headers: { Cookie: "mine=1" } })).body);
  assert.equal(echo.cookie, "mine=1");
});

test("Max-Age=0 and a past Expires delete cookies", async () => {
  const h = http();
  await h.get(`${base}/set`);
  await h.get(`${base}/delete`);
  const echo = JSON.parse((await h.get(`${base}/echo`)).body);
  assert.equal(echo.cookie, "b=two=2");
});

test("a new value for the same name replaces the old one", async () => {
  const h = http();
  await h.get(`${base}/set`);
  await h.get(`${base}/set`);
  const echo = JSON.parse((await h.get(`${base}/echo`)).body);
  assert.equal(echo.cookie, "a=1; b=two=2; gone=x");
});

function cookieHttp() {
  const sent = [];
  const queue = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url: String(url), cookie: init.headers.Cookie ?? init.headers.cookie ?? null });
    const headers = new Headers();
    for (const c of queue.shift() ?? []) headers.append("Set-Cookie", c);
    return new Response("ok", { headers });
  };
  return { http: createHttp({ userAgent: "t", fetchImpl }), sent, queue };
}

test("host-only cookies are not sent to other hosts or subdomains", async () => {
  const { http: h, sent, queue } = cookieHttp();
  queue.push(["a=1"]);
  await h.get("https://example.com/x");
  await h.get("https://example.com/y");
  await h.get("https://www.example.com/");
  await h.get("https://other.test/");
  assert.deepEqual(sent.map((s) => s.cookie), [null, "a=1", null, null]);
});

test("Domain cookies apply to the domain and its subdomains", async () => {
  const { http: h, sent, queue } = cookieHttp();
  queue.push(["d=1; Domain=.Example.com; Path=/"]);
  await h.get("https://www.example.com/");
  await h.get("https://example.com/");
  await h.get("https://api.v2.example.com/");
  await h.get("https://notexample.com/");
  assert.deepEqual(sent.map((s) => s.cookie), [null, "d=1", "d=1", null]);
});

test("a Domain that does not cover the request host is ignored", async () => {
  const { http: h, sent, queue } = cookieHttp();
  queue.push(["d=1; Domain=other.test"]);
  await h.get("https://example.com/");
  await h.get("https://other.test/");
  await h.get("https://example.com/");
  assert.deepEqual(sent.map((s) => s.cookie), [null, null, null]);
});

test("a Domain cookie can be deleted by name and domain", async () => {
  const { http: h, sent, queue } = cookieHttp();
  queue.push(["d=1; Domain=example.com"]);
  queue.push(["d=; Domain=example.com; Max-Age=0"]);
  await h.get("https://www.example.com/");
  await h.get("https://www.example.com/");
  await h.get("https://www.example.com/");
  assert.deepEqual(sent.map((s) => s.cookie), [null, "d=1", null]);
});

test("malformed Set-Cookie values (no name=value) are ignored", async () => {
  const { http: h, sent, queue } = cookieHttp();
  queue.push(["novalue", "=x", " ok = 1 ; Path=/"]);
  await h.get("https://example.com/");
  await h.get("https://example.com/");
  assert.deepEqual(sent.map((s) => s.cookie), [null, "ok=1"]);
});
