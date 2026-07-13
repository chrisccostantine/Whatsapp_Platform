import { AppError } from "./errors.js";

export function routeParam(value: string | string[] | undefined, name = "id") {
  const result = Array.isArray(value) ? value[0] : value;
  if (!result) throw new AppError(400, "INVALID_ROUTE_PARAMETER", `Route parameter ${name} is required`);
  return result;
}
