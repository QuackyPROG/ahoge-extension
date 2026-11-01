// Shape of the optional `source.filters()` list (see docs/HOST_API.md, "Filters"). The app decodes the
// same shape; check.mjs uses these to reject a malformed list before it reaches a phone.

const KEYED = new Set(["text", "checkbox", "tristate", "select", "sort", "group"]);
const GROUP_CHILDREN = new Set(["text", "checkbox", "tristate"]);

export function validateFilters(list, path = "filters") {
  if (!Array.isArray(list)) return [`${path} must be an array`];
  const errors = [];
  const keys = new Set();
  list.forEach((f, i) => {
    const at = `${path}[${i}]`;
    if (!f || typeof f !== "object") return errors.push(`${at} must be an object`);
    if (f.type === "header" || f.type === "separator") return;
    if (!KEYED.has(f.type)) return errors.push(`${at} has unknown type ${JSON.stringify(f.type)}`);
    if (typeof f.key !== "string" || !f.key) errors.push(`${at} needs a key`);
    else if (keys.has(f.key)) errors.push(`${at} repeats key ${f.key}`);
    else keys.add(f.key);
    if (typeof f.name !== "string") errors.push(`${at} needs a name`);
    if (f.type === "select" || f.type === "sort") {
      if (!Array.isArray(f.options) || !f.options.length) errors.push(`${at} needs options`);
      else if (f.options.some((o) => typeof o?.value !== "string" || typeof o?.label !== "string")) errors.push(`${at} options need string value and label`);
    }
    if (f.type === "group") {
      if (!Array.isArray(f.filters)) return errors.push(`${at} needs filters`);
      f.filters.forEach((child, j) => {
        if (!GROUP_CHILDREN.has(child?.type)) errors.push(`${at}.filters[${j}] must be text, checkbox or tristate`);
      });
      errors.push(...validateFilters(f.filters, `${at}.filters`));
    }
  });
  return errors;
}

// The values the app sends when the user has changed nothing.
export function defaultFilterValues(list) {
  const values = {};
  for (const f of list) {
    switch (f.type) {
      case "text": values[f.key] = ""; break;
      case "checkbox": values[f.key] = f.default === true; break;
      case "tristate": values[f.key] = 0; break;
      case "select": values[f.key] = f.default ?? f.options[0].value; break;
      case "sort": values[f.key] = f.default ?? { value: f.options[0].value, ascending: false }; break;
      case "group": values[f.key] = defaultFilterValues(f.filters); break;
    }
  }
  return values;
}
