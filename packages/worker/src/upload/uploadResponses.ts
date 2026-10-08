import { WorkerError } from "../types";

export async function readUploadResponse(
  response: Response,
  fallbackCode: string,
): Promise<Record<string, unknown>> {
  const value: unknown = await response.json().catch(() => null);
  const body =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  if (!response.ok || body?.success === false) {
    throw new WorkerError(
      typeof body?.error === "string"
        ? body.error
        : "Upload storage request failed",
      typeof body?.code === "string" ? body.code : fallbackCode,
      response.ok ? 409 : response.status,
    );
  }
  if (!body)
    throw new WorkerError("Invalid upload storage response", fallbackCode, 502);
  return body;
}
