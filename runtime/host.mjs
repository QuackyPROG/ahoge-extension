import vm from "node:vm";
import { parse } from "./html.mjs";
import { createHttp, CloudflareError } from "./http.mjs";

export const RUNTIME_VERSION = 1;
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const METHODS = ["popular", "latest", "search", "details", "chapters", "pages", "filters"];

export function loadSource(script, { fetchImpl = fetch, userAgent = DEFAULT_USER_AGENT, log = () => {}, callTimeoutMs = 30000 } = {}) {
  const context = vm.createContext({
    http: createHttp({ userAgent, fetchImpl }),
    html: { parse },
    console: { log: (...args) => log(args.map(String).join(" ")) },
    atob,
    btoa,
    CloudflareError,
  });
  vm.runInContext(script, context, { filename: "source.js", timeout: 5000 });
  const source = context.source;
  if (!source || typeof source !== "object") throw new Error("Script did not assign `source`");

  const call = async (name, args) => {
    // filters() is optional; a source without it has no filters, same as in the app.
    if (name === "filters" && typeof source.filters !== "function") return [];
    if (typeof source[name] !== "function") throw new Error(`Source does not implement ${name}`);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Source call ${name} timed out after ${callTimeoutMs} ms`)), callTimeoutMs);
    });
    let result;
    try {
      result = await Promise.race([Promise.resolve().then(() => source[name](...args)), timeout]);
    } finally {
      clearTimeout(timer);
    }
    return JSON.parse(JSON.stringify(result ?? null));
  };

  return Object.fromEntries(METHODS.map((name) => [name, (...args) => call(name, args)]));
}
