import { ApiErrorCodeSchema } from "../src/schemas.ts";

type JsonObject = Record<string, unknown>;

const contractUrl = new URL("../openapi.yaml", import.meta.url);
const source = await Bun.file(contractUrl).text();

let document: JsonObject;

try {
  document = JSON.parse(source) as JsonObject;
} catch (error) {
  throw new Error(
    `openapi.yaml is not valid JSON-compatible YAML: ${String(error)}`,
  );
}

function objectAt(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as JsonObject;
}

function resolveReference(reference: string): unknown {
  if (!reference.startsWith("#/")) {
    throw new Error(`Only local OpenAPI references are allowed: ${reference}`);
  }

  return reference
    .slice(2)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((current, segment) => {
      const container = objectAt(current, `Reference segment ${segment}`);

      if (!(segment in container)) {
        throw new Error(`Unresolved OpenAPI reference: ${reference}`);
      }

      return container[segment];
    }, document);
}

function visit(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(visit);
    return;
  }

  if (value === null || typeof value !== "object") {
    return;
  }

  const object = value as JsonObject;
  if (typeof object.$ref === "string") {
    resolveReference(object.$ref);
  }

  Object.values(object).forEach(visit);
}

if (document.openapi !== "3.1.1") {
  throw new Error("The contract must declare OpenAPI 3.1.1.");
}

objectAt(document.info, "info");
const paths = objectAt(document.paths, "paths");
const expectedOperations = {
  "/healthz": ["get"],
  "/api/v3/pairing/sessions": ["post"],
  "/api/v3/pairing/sessions/{sessionId}/proof": ["post"],
  "/api/v3/pairing/sessions/{sessionId}/complete": ["post"],
  "/api/v3/state": ["get"],
  "/api/v3/settings": ["patch"],
  "/api/v3/mode": ["put"],
  "/api/v3/heater-permission": ["put"],
  "/api/v3/faults/over-temperature/dismiss": ["post"],
  "/api/v3/temperature-calibrations/current": [
    "post",
    "patch",
    "put",
    "delete",
  ],
  "/api/v3/temperature-calibrations/current/lease": ["post"],
  "/api/v3/scale-calibrations/current": ["post", "put", "delete"],
  "/api/v3/scale/warnings/acknowledge": ["post"],
  "/api/v3/extractions": ["post"],
  "/api/v3/extractions/current": ["delete"],
  "/api/v3/extractions/current/stream": ["get"],
  "/api/v3/cooldowns": ["post"],
  "/api/v3/cooldowns/current": ["delete"],
  "/api/v3/firmware-updates": ["post"],
} as const;

if (
  Object.keys(paths).sort().join("\n") !==
  Object.keys(expectedOperations).sort().join("\n")
) {
  throw new Error("OpenAPI paths must exactly match the approved PRD endpoints.");
}

for (const [path, methods] of Object.entries(expectedOperations)) {
  const pathItem = objectAt(paths[path], path);
  const declaredMethods = Object.keys(pathItem)
    .filter((key) => ["get", "post", "put", "patch", "delete"].includes(key))
    .sort();
  if (declaredMethods.join("\n") !== [...methods].sort().join("\n")) {
    throw new Error(`${path} declares methods outside the v3 contract.`);
  }

  for (const method of methods) {
    const operation = objectAt(
      pathItem[method],
      `${method.toUpperCase()} ${path}`,
    );
    const responses = objectAt(
      operation.responses,
      `${method.toUpperCase()} ${path} responses`,
    );

    const successStatus = path === "/api/v3/firmware-updates" ? "202" : "200";
    if (!(successStatus in responses)) {
      throw new Error(
        `${method.toUpperCase()} ${path} must document a ${successStatus} response.`,
      );
    }

    const returnsState =
      !isPublicPath(path) &&
      path !== "/api/v3/extractions/current/stream" &&
      path !== "/api/v3/firmware-updates";
    if (returnsState) {
      const success = objectAt(
        responses["200"],
        `${method.toUpperCase()} ${path} 200 response`,
      );
      if (success.$ref !== "#/components/responses/State") {
        throw new Error(
          `${method.toUpperCase()} ${path} must return the complete v3 state.`,
        );
      }
    }

    const isPublic = isPublicPath(path);
    const security = operation.security;

    if (isPublic && (!Array.isArray(security) || security.length !== 0)) {
      throw new Error(
        `${method.toUpperCase()} ${path} must be explicitly public.`,
      );
    }

    if (
      !isPublic &&
      (!Array.isArray(security) ||
        security.length !== 1 ||
        !("bearerAuth" in objectAt(security[0], `${path} security`)))
    ) {
      throw new Error(
        `${method.toUpperCase()} ${path} must require bearerAuth.`,
      );
    }
  }
}

const components = objectAt(document.components, "components");
const schemas = objectAt(components.schemas, "components.schemas");
objectAt(components.responses, "components.responses");
const securitySchemes = objectAt(
  components.securitySchemes,
  "components.securitySchemes",
);
const bearerAuth = objectAt(securitySchemes.bearerAuth, "bearerAuth");

if (bearerAuth.type !== "http" || bearerAuth.scheme !== "bearer") {
  throw new Error("bearerAuth must use the HTTP bearer security scheme.");
}

const error = objectAt(schemas.Error, "components.schemas.Error");
const errorProperties = objectAt(error.properties, "Error properties");
const errorBody = objectAt(errorProperties.error, "Error.error");
const errorBodyProperties = objectAt(
  errorBody.properties,
  "Error.error properties",
);
const errorCode = objectAt(errorBodyProperties.code, "Error.error.code");
const documentedErrorCodes = Array.isArray(errorCode.enum)
  ? errorCode.enum
  : [];
if (
  documentedErrorCodes.join("\n") !== ApiErrorCodeSchema.options.join("\n")
) {
  throw new Error("OpenAPI and Zod must declare the same v3 error codes.");
}

const streamOperation = objectAt(
  objectAt(paths["/api/v3/extractions/current/stream"], "stream path").get,
  "stream operation",
);
const streamResponses = objectAt(streamOperation.responses, "stream responses");
const streamSuccess = objectAt(streamResponses["200"], "stream 200 response");
const streamContent = objectAt(streamSuccess.content, "stream content");
const eventStream = objectAt(
  streamContent["text/event-stream"],
  "text/event-stream content",
);
const eventData = objectAt(eventStream["x-eventDataSchema"], "SSE event data");
if (eventData.$ref !== "#/components/schemas/TelemetryPage") {
  throw new Error("The SSE stream must declare strict TelemetryPage event data.");
}

visit(document);

console.log("OpenAPI 3.1.1 syntax, paths, security, and local references are valid.");

function isPublicPath(path: string): boolean {
  return (
    path === "/healthz" ||
    path === "/api/v3/pairing/sessions" ||
    path === "/api/v3/pairing/sessions/{sessionId}/proof" ||
    path === "/api/v3/pairing/sessions/{sessionId}/complete"
  );
}
