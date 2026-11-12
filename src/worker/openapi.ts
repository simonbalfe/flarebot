import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv } from "./env";

export interface OperationDoc {
  id: string;
  tag: string;
  summary: string;
  description?: string;
  body?: z.ZodType;
  rawBody?: string;
  query?: z.ZodType;
  returns?: string;
}

type JsonObject = Record<string, unknown>;

const httpMethods = ["get", "post", "put", "patch", "delete"];
const documented = new WeakMap<object, OperationDoc>();

export function doc(operation: OperationDoc): MiddlewareHandler<AppEnv> {
  const passThrough: MiddlewareHandler<AppEnv> = async (_c, next) => {
    await next();
  };
  documented.set(passThrough, operation);
  return passThrough;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonSchema(schema: z.ZodType): JsonObject {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io: "input" });
  return rest;
}

function pathParameters(routePath: string): { path: string; parameters: JsonObject[] } {
  const parameters: JsonObject[] = [];
  const path = routePath.replace(/:([A-Za-z]+)(?:\{([^}]+)\})?/g, (_match, name: string, pattern: string | undefined) => {
    const choices = pattern !== undefined && /^[\w|-]+$/.test(pattern) ? pattern.split("|") : undefined;
    parameters.push({ name, in: "path", required: true, schema: choices === undefined ? { type: "string" } : { type: "string", enum: choices } });
    return `{${name}}`;
  });
  return { path, parameters };
}

function queryParameters(schema: z.ZodType | undefined): JsonObject[] {
  if (schema === undefined) return [];
  const { properties, required } = jsonSchema(schema);
  if (!isObject(properties)) return [];
  const requiredNames = Array.isArray(required) ? required : [];
  return Object.entries(properties).map(([name, property]) => {
    const { description, ...rest } = isObject(property) ? property : {};
    return { name, in: "query", required: requiredNames.includes(name), description: typeof description === "string" ? description : "", schema: rest };
  });
}

function requestBody(operation: OperationDoc): JsonObject | undefined {
  if (operation.body !== undefined) return { required: true, content: { "application/json": { schema: jsonSchema(operation.body) } } };
  if (operation.rawBody !== undefined) return { required: true, description: operation.rawBody, content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } };
  return undefined;
}

export function openApiDocument(routes: readonly { method: string; path: string; handler: unknown }[], serverUrl: string): JsonObject {
  const paths: Record<string, JsonObject> = {};
  const tags = new Set<string>();
  for (const route of routes) {
    const method = route.method.toLowerCase();
    const operation = typeof route.handler === "function" ? documented.get(route.handler) : undefined;
    if (operation === undefined || !httpMethods.includes(method)) continue;
    const { path, parameters } = pathParameters(route.path);
    const body = requestBody(operation);
    tags.add(operation.tag);
    paths[path] = {
      ...paths[path],
      [method]: {
        operationId: operation.id,
        tags: [operation.tag],
        summary: operation.summary,
        ...(operation.description === undefined ? {} : { description: operation.description }),
        parameters: [...parameters, ...queryParameters(operation.query)],
        ...(body === undefined ? {} : { requestBody: body }),
        responses: {
          "2XX": { description: operation.returns ?? "Done, with no body" },
          "4XX": { description: "A JSON object with an error message" },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "flarebot API",
      version: "1.0.0",
      description: "Control flarebot Bots. Send Authorization: Bearer <FLAREBOT_API_KEY>. Bodies and replies are JSON unless an operation says otherwise.",
    },
    servers: [{ url: serverUrl }],
    security: [{ apiKey: [] }],
    components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer" } } },
    tags: [...tags].map((name) => ({ name })),
    paths,
  };
}
