import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMeta } from "./meta.mjs";

const good = { id: "en.manhuaplus", name: "ManhuaPlus", lang: "en", version: "1.0.0", nsfw: false, baseUrl: "https://manhuaplus.com", template: "madara" };

test("valid meta has no errors", () => assert.deepEqual(validateMeta(good, ["madara"]), []));

test("reports each invalid field", () => {
  const errors = validateMeta({ ...good, id: "Bad Id", version: "1.0", baseUrl: "http://x.com/", nsfw: "no", template: "nope", name: "" }, ["madara"]);
  assert.deepEqual(errors.sort(), [
    "baseUrl must be https without trailing slash",
    "id must look like <lang>.<name> using a-z0-9",
    "name is required",
    "nsfw must be boolean",
    "template 'nope' does not exist",
    "version must be MAJOR.MINOR.PATCH",
  ]);
});

test("id prefix must match lang", () => {
  assert.deepEqual(validateMeta({ ...good, lang: "es" }, ["madara"]), ["id must start with lang 'es.'"]);
});
