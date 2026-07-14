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
  "/healthz": "get",
  "/api/v1/device": "get",
  "/api/v1/state": "get",
  "/api/v1/settings/temperatures": "patch",
  "/api/v1/mode": "put",
  "/api/v1/heater": "put",
  "/api/v1/faults/over-temperature/dismiss": "post",
  "/api/v2/state": "get",
  "/api/v2/profiles": "get",
  "/api/v2/extractions/start": "post",
  "/api/v2/extractions/stop": "post",
  "/api/v2/cooldowns/start": "post",
  "/api/v2/cooldowns/stop": "post",
} as const;

const expectedAdditionalOperations = {
  "/api/v2/profiles": "put",
} as const;

if (
  Object.keys(paths).sort().join("\n") !==
  Object.keys(expectedOperations).sort().join("\n")
) {
  throw new Error("OpenAPI paths must exactly match the approved PRD endpoints.");
}

for (const [path, method] of Object.entries(expectedOperations)) {
  const pathItem = objectAt(paths[path], path);
  const operation = objectAt(pathItem[method], `${method.toUpperCase()} ${path}`);
  const responses = objectAt(operation.responses, `${method.toUpperCase()} ${path} responses`);

  if (!("200" in responses)) {
    throw new Error(`${method.toUpperCase()} ${path} must document a 200 response.`);
  }

  const isPublic = path === "/healthz" || path === "/api/v1/device";
  const security = operation.security;

  if (isPublic && (!Array.isArray(security) || security.length !== 0)) {
    throw new Error(`${method.toUpperCase()} ${path} must be explicitly public.`);
  }

  if (
    !isPublic &&
    (!Array.isArray(security) ||
      security.length !== 1 ||
      !("bearerAuth" in objectAt(security[0], `${path} security`)))
  ) {
    throw new Error(`${method.toUpperCase()} ${path} must require bearerAuth.`);
  }
}

for (const [path, method] of Object.entries(expectedAdditionalOperations)) {
  const pathItem = objectAt(paths[path], path);
  const operation = objectAt(pathItem[method], `${method.toUpperCase()} ${path}`);
  const responses = objectAt(
    operation.responses,
    `${method.toUpperCase()} ${path} responses`,
  );

  if (!("200" in responses)) {
    throw new Error(`${method.toUpperCase()} ${path} must document a 200 response.`);
  }

  const security = operation.security;
  if (
    !Array.isArray(security) ||
    security.length !== 1 ||
    !("bearerAuth" in objectAt(security[0], `${path} security`))
  ) {
    throw new Error(`${method.toUpperCase()} ${path} must require bearerAuth.`);
  }
}

const components = objectAt(document.components, "components");
objectAt(components.schemas, "components.schemas");
objectAt(components.responses, "components.responses");
const securitySchemes = objectAt(
  components.securitySchemes,
  "components.securitySchemes",
);
const bearerAuth = objectAt(securitySchemes.bearerAuth, "bearerAuth");

if (bearerAuth.type !== "http" || bearerAuth.scheme !== "bearer") {
  throw new Error("bearerAuth must use the HTTP bearer security scheme.");
}

visit(document);

console.log("OpenAPI 3.1.1 syntax, paths, security, and local references are valid.");
