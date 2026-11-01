export function validateMeta(meta, templates) {
  const errors = [];
  if (typeof meta.id !== "string" || !/^[a-z]{2,3}(-[a-z]{2,4})?\.[a-z0-9]+$/.test(meta.id)) {
    errors.push("id must look like <lang>.<name> using a-z0-9");
  } else if (typeof meta.lang === "string" && !meta.id.startsWith(meta.lang + ".")) {
    errors.push(`id must start with lang '${meta.lang}.'`);
  }
  if (typeof meta.name !== "string" || meta.name.trim() === "") errors.push("name is required");
  if (typeof meta.lang !== "string" || !/^[a-z]{2,3}(-[a-z]{2,4})?$/.test(meta.lang)) errors.push("lang must be a language code");
  if (typeof meta.version !== "string" || !/^\d+\.\d+\.\d+$/.test(meta.version)) errors.push("version must be MAJOR.MINOR.PATCH");
  if (typeof meta.baseUrl !== "string" || !/^https:\/\/[^/]+$/.test(meta.baseUrl)) errors.push("baseUrl must be https without trailing slash");
  if (typeof meta.nsfw !== "boolean") errors.push("nsfw must be boolean");
  if (meta.template !== undefined && !templates.includes(meta.template)) errors.push(`template '${meta.template}' does not exist`);
  if (meta.upstream !== undefined && typeof meta.upstream !== "string") errors.push("upstream must be a path string");
  return errors;
}
