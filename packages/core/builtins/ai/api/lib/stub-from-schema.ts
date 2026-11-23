type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | JsonSchema[];
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
};

function primaryType(schema: JsonSchema): string | undefined {
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) {
    return schema.type.find((t) => t !== 'null') ?? schema.type[0];
  }
  return undefined;
}

/**
 * Build a deterministic stub object from a JSON Schema for the mock language model.
 */
export function stubFromJsonSchema(
  schema: unknown,
  extras: Record<string, unknown> = {},
): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return extras.prompt ?? null;
  }
  return fillSchema(schema as JsonSchema, extras);
}

function fillSchema(
  schema: JsonSchema,
  extras: Record<string, unknown>,
): unknown {
  if (schema.const !== undefined) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  if (schema.default !== undefined) return schema.default;

  const branch = schema.anyOf?.[0] ?? schema.oneOf?.[0];
  if (branch) return fillSchema(branch, extras);

  const type = primaryType(schema);

  if (type === 'object' || schema.properties) {
    const out: Record<string, unknown> = {};
    const props = schema.properties ?? {};
    const required = new Set(schema.required ?? Object.keys(props));
    for (const key of required) {
      const prop = props[key];
      if (!prop) continue;
      if (key in extras && typeof extras[key] === primaryType(prop)) {
        out[key] = extras[key];
        continue;
      }
      if (
        primaryType(prop) === 'string' &&
        typeof extras.prompt === 'string' &&
        (key === 'prompt' || key === 'summary' || key === 'text')
      ) {
        out[key] = extras.prompt;
        continue;
      }
      if (
        primaryType(prop) === 'boolean' &&
        key === 'hasFiles' &&
        typeof extras.hasFiles === 'boolean'
      ) {
        out[key] = extras.hasFiles;
        continue;
      }
      if (
        primaryType(prop) === 'number' &&
        key === 'fileCount' &&
        typeof extras.fileCount === 'number'
      ) {
        out[key] = extras.fileCount;
        continue;
      }
      out[key] = fillSchema(prop, extras);
    }
    return out;
  }

  if (type === 'array') {
    const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    if (!items) return [];
    return [fillSchema(items, extras)];
  }

  switch (type) {
    case 'string':
      return typeof extras.prompt === 'string' ? extras.prompt : 'mock';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'null':
      return null;
    default:
      return typeof extras.prompt === 'string' ? extras.prompt : null;
  }
}
