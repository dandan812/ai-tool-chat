import { describe, expect, it, vi } from "vitest";
import {
  handleUploadChunk,
  handleUploadComplete,
  handleUploadStatus,
} from "../handlers/uploadHandlers";
import { AccountDirectory, listUserFiles } from "../platform/accounts";
import { createMockEnv, MemoryDurableObjectState } from "../test/mocks";
import { ChunkStorage } from "./chunkStorage";
import { ownedFileId } from "./ownedFiles";
import {
  getUploadedFileChunkObjectKey,
  getUploadedFileObjectKey,
} from "./uploadedFileStorage";
import type { FileMetadata } from "./chunkStorageSupport";

function setup() {
  const env = createMockEnv();
  const states = new Map<string, MemoryDurableObjectState>();
  const objects = new Map<string, ChunkStorage>();
  const accountState = Object.assign(new MemoryDurableObjectState(), {
    blockConcurrencyWhile: <T>(operation: () => Promise<T>) => operation(),
  });
  const accounts = new AccountDirectory(
    accountState as unknown as DurableObjectState,
    env,
  );
  env.ACCOUNTS = {
    idFromName: (name: string) => name,
    get: () => accounts,
  } as unknown as DurableObjectNamespace;
  env.CHUNK_STORAGE = {
    idFromName: (name: string) => name,
    get: (id: string) => {
      if (!objects.has(id)) {
        const state = new MemoryDurableObjectState();
        states.set(id, state);
        objects.set(
          id,
          new ChunkStorage(state as unknown as DurableObjectState, env),
        );
      }
      return { fetch: (request: Request) => objects.get(id)!.fetch(request) };
    },
  } as unknown as DurableObjectNamespace;
  return { env, states, objects };
}

function chunkForm(overrides: Record<string, string> = {}, content = "ab") {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    fileId: "demo",
    fileName: "demo.txt",
    fileHash: "test-hash",
    fileSize: "5",
    totalChunks: "3",
    chunkSize: "2",
    chunkIndex: "0",
    mimeType: "text/plain",
    ...overrides,
  }))
    form.set(key, value);
  form.set("chunk", new File([content], "chunk"));
  return form;
}

const uploadRequest = (form: FormData) =>
  new Request("https://app.test/upload/chunk", {
    method: "POST",
    headers: { origin: "https://app.test" },
    body: form,
  });
const completeRequest = (
  body: unknown = { fileId: "demo", fileHash: "test-hash" },
) =>
  new Request("https://app.test/upload/complete", {
    method: "POST",
    headers: { origin: "https://app.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const statusRequest = () =>
  new Request("https://app.test/upload/status?fileId=demo&chunkSize=2");

describe("Upload lifecycle", () => {
  it("resumes a 20 MiB file across DO reconstruction and verifies the complete bytes", async () => {
    const { env, states, objects } = setup();
    const chunkSize = 5 * 1024 * 1024;
    const fileSize = 4 * chunkSize;
    async function send(index: number) {
      const form = chunkForm({
        fileSize: String(fileSize),
        totalChunks: "4",
        chunkSize: String(chunkSize),
        chunkIndex: String(index),
      });
      form.set(
        "chunk",
        new File([new Uint8Array(chunkSize).fill(index + 1)], "chunk"),
      );
      expect(
        (await handleUploadChunk(uploadRequest(form), env, "alice")).status,
      ).toBe(200);
    }
    await send(0);
    await send(1);
    const internal = await ownedFileId("alice", "demo");
    objects.set(
      internal,
      new ChunkStorage(
        states.get(internal)! as unknown as DurableObjectState,
        env,
      ),
    );
    expect(
      await (
        await handleUploadStatus(
          new Request(
            `https://app.test/upload/status?fileId=demo&chunkSize=${chunkSize}`,
          ),
          env,
          "alice",
        )
      ).json(),
    ).toMatchObject({ receivedIndices: [0, 1], receivedChunks: 2 });
    await send(2);
    await send(3);
    await handleUploadComplete(completeRequest(), env, "alice");
    const object = await env.UPLOADED_FILES.get(
      getUploadedFileObjectKey(internal),
    );
    const bytes = new Uint8Array(await object!.arrayBuffer());
    expect(bytes.length).toBe(fileSize);
    for (let index = 0; index < 4; index++) {
      expect(
        bytes
          .subarray(index * chunkSize, (index + 1) * chunkSize)
          .every((byte) => byte === index + 1),
      ).toBe(true);
    }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const expectedHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    expect(object!.customMetadata?.serverContentHash).toBe(expectedHash);
    expect(await listUserFiles(env, "alice")).toHaveLength(1);
  });

  it.each([
    { chunkIndex: "" },
    { chunkIndex: "0oops" },
    { chunkIndex: " 0" },
    { chunkIndex: "-1" },
    { chunkIndex: "0.5" },
    { chunkIndex: "3" },
    { totalChunks: "0" },
    { totalChunks: "257" },
    { fileSize: "NaN" },
    { fileSize: "1" },
    { chunkSize: "0" },
    { chunkSize: "3" },
    { chunkSize: "5242881" },
    { fileName: "" },
    { fileHash: "" },
    { fileId: "../escape" },
  ])(
    "rejects malformed requests before reserving capacity: %j",
    async (fields) => {
      const { env } = setup();
      const put = vi.spyOn(env.UPLOADED_FILES, "put");
      await expect(
        handleUploadChunk(uploadRequest(chunkForm(fields)), env, "alice"),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "UPLOAD_INVALID_REQUEST",
      });
      expect(await listUserFiles(env, "alice")).toEqual([]);
      expect(put).not.toHaveBeenCalled();
    },
  );

  it("rejects repeated form fields and a short non-final chunk before reserving", async () => {
    const { env } = setup();
    const form = chunkForm();
    form.append("chunkIndex", "1");
    await expect(
      handleUploadChunk(uploadRequest(form), env, "alice"),
    ).rejects.toThrow();
    await expect(
      handleUploadChunk(uploadRequest(chunkForm({}, "a")), env, "alice"),
    ).rejects.toThrow();
    expect(await listUserFiles(env, "alice")).toEqual([]);
  });

  it.each([
    null,
    [],
    { fileId: 1 },
    {},
    { fileId: "demo", fileHash: {} },
    { fileId: "demo", fileName: ["spoof"] },
  ])("rejects malformed complete JSON %j", async (body) => {
    const { env } = setup();
    await expect(
      handleUploadComplete(completeRequest(body), env, "alice"),
    ).rejects.toMatchObject({
      code: "UPLOAD_INVALID_REQUEST",
      statusCode: 400,
    });
  });

  it("retains a deletion manifest but does not ACK a failed R2 write; retry uploads normally", async () => {
    const { env, states } = setup();
    const write = vi
      .spyOn(env.UPLOADED_FILES, "put")
      .mockRejectedValueOnce(new Error("R2 offline"));
    await expect(
      handleUploadChunk(uploadRequest(chunkForm()), env, "alice"),
    ).rejects.toMatchObject({ code: "UPLOAD_STORAGE_FAILED", statusCode: 500 });
    const internal = await ownedFileId("alice", "demo");
    expect(
      await states.get(internal)!.storage.get("meta:" + internal),
    ).toMatchObject({ receivedIndices: [], receivedChunks: 0 });
    expect((await listUserFiles(env, "alice"))[0]).toMatchObject({
      bytes: 5,
      status: "uploading",
    });
    const status = await (
      await handleUploadStatus(statusRequest(), env, "alice")
    ).json();
    expect(status).toMatchObject({
      receivedChunks: 0,
      receivedIndices: [],
      percentage: 0,
    });
    expect(
      (await handleUploadChunk(uploadRequest(chunkForm()), env, "alice"))
        .status,
    ).toBe(200);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("recovers an R2 write whose metadata ACK failed without re-writing the chunk", async () => {
    const { env, states } = setup();
    await handleUploadChunk(uploadRequest(chunkForm()), env, "alice");
    const internal = await ownedFileId("alice", "demo");
    const storage = states.get(internal)!.storage;
    const put = vi
      .spyOn(storage, "put")
      .mockRejectedValueOnce(new Error("DO ACK interrupted"));
    const r2put = vi.spyOn(env.UPLOADED_FILES, "put");
    await expect(
      handleUploadChunk(
        uploadRequest(chunkForm({ chunkIndex: "1" }, "cd")),
        env,
        "alice",
      ),
    ).rejects.toThrow();
    expect(await storage.get("meta:" + internal)).toMatchObject({
      receivedIndices: [0],
    });
    put.mockRestore();
    expect(
      await (await handleUploadStatus(statusRequest(), env, "alice")).json(),
    ).toMatchObject({ receivedIndices: [0, 1], receivedChunks: 2 });
    const retry = await (
      await handleUploadChunk(
        uploadRequest(chunkForm({ chunkIndex: "1" }, "cd")),
        env,
        "alice",
      )
    ).json();
    expect(retry).toMatchObject({ duplicate: true, receivedIndices: [0, 1] });
    expect(r2put).toHaveBeenCalledTimes(1);
  });

  it("reconciles a missing R2 chunk and completes only after it has been restored", async () => {
    const { env } = setup();
    await handleUploadChunk(uploadRequest(chunkForm()), env, "alice");
    await handleUploadChunk(
      uploadRequest(chunkForm({ chunkIndex: "1" }, "cd")),
      env,
      "alice",
    );
    await handleUploadChunk(
      uploadRequest(chunkForm({ chunkIndex: "2" }, "e")),
      env,
      "alice",
    );
    const internal = await ownedFileId("alice", "demo");
    await env.UPLOADED_FILES.delete(getUploadedFileChunkObjectKey(internal, 1));
    await expect(
      handleUploadComplete(completeRequest(), env, "alice"),
    ).rejects.toMatchObject({ code: "UPLOAD_INCOMPLETE", statusCode: 409 });
    expect(
      await (await handleUploadStatus(statusRequest(), env, "alice")).json(),
    ).toMatchObject({ receivedIndices: [0, 2], receivedChunks: 2 });
    await handleUploadChunk(
      uploadRequest(chunkForm({ chunkIndex: "1" }, "cd")),
      env,
      "alice",
    );
    await handleUploadComplete(completeRequest(), env, "alice");
    expect(
      await (
        await env.UPLOADED_FILES.get(getUploadedFileObjectKey(internal))
      )?.text(),
    ).toBe("abcde");
    expect((await listUserFiles(env, "alice"))[0].status).toBe("complete");
    expect(await listUserFiles(env, "bob")).toEqual([]);
  });

  it("does not delete or silently repair corrupt metadata on status, upload, or completion", async () => {
    const { env, states } = setup();
    await handleUploadChunk(uploadRequest(chunkForm()), env, "alice");
    const internal = await ownedFileId("alice", "demo"),
      key = "meta:" + internal;
    const metadata = await states.get(internal)!.storage.get<FileMetadata>(key);
    const corrupt = { ...metadata, receivedIndices: [-1], receivedChunks: 1 };
    await states.get(internal)!.storage.put(key, corrupt);
    const deletion = vi.spyOn(env.UPLOADED_FILES, "delete");
    for (const request of [
      () => handleUploadStatus(statusRequest(), env, "alice"),
      () => handleUploadChunk(uploadRequest(chunkForm()), env, "alice"),
      () => handleUploadComplete(completeRequest(), env, "alice"),
    ])
      await expect(request()).rejects.toMatchObject({
        code: "UPLOAD_METADATA_INVALID",
        statusCode: 409,
      });
    expect(deletion).not.toHaveBeenCalled();
    expect(await states.get(internal)!.storage.get(key)).toEqual(corrupt);
    expect(
      await env.UPLOADED_FILES.head(getUploadedFileChunkObjectKey(internal, 0)),
    ).not.toBeNull();
  });

  it("rejects a changed layout even when totalChunks matches", async () => {
    const { env } = setup();
    await handleUploadChunk(
      uploadRequest(
        chunkForm({ fileSize: "8", totalChunks: "2", chunkSize: "4" }, "abcd"),
      ),
      env,
      "alice",
    );
    await expect(
      handleUploadStatus(
        new Request("https://app.test/upload/status?fileId=demo&chunkSize=5"),
        env,
        "alice",
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_METADATA_CONFLICT" });
    await expect(
      handleUploadChunk(
        uploadRequest(
          chunkForm(
            {
              fileSize: "8",
              totalChunks: "2",
              chunkSize: "5",
              chunkIndex: "1",
            },
            "fgh",
          ),
        ),
        env,
        "alice",
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_METADATA_CONFLICT" });
  });

  it("checks legacy R2 bytes against the requested layout without migrating metadata", async () => {
    const { env, states } = setup();
    const form = chunkForm({ fileSize: "8", totalChunks: "2" }, "abcd");
    form.delete("chunkSize");
    await handleUploadChunk(uploadRequest(form), env, "alice");
    const internal = await ownedFileId("alice", "demo");
    await expect(
      handleUploadStatus(
        new Request("https://app.test/upload/status?fileId=demo&chunkSize=5"),
        env,
        "alice",
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_SIZE_MISMATCH" });
    expect(
      await (
        await handleUploadStatus(
          new Request("https://app.test/upload/status?fileId=demo&chunkSize=4"),
          env,
          "alice",
        )
      ).json(),
    ).toMatchObject({ receivedIndices: [0] });
    expect(
      (
        await states
          .get(internal)!
          .storage.get<FileMetadata>("meta:" + internal)
      )?.chunkSize,
    ).toBeUndefined();
  });

  it("keeps chunks and quota after failed merge and releases its lease for retry", async () => {
    const { env } = setup();
    await handleUploadChunk(uploadRequest(chunkForm()), env, "alice");
    await handleUploadChunk(
      uploadRequest(chunkForm({ chunkIndex: "1" }, "cd")),
      env,
      "alice",
    );
    await handleUploadChunk(
      uploadRequest(chunkForm({ chunkIndex: "2" }, "e")),
      env,
      "alice",
    );
    vi.spyOn(env.UPLOADED_FILES, "put").mockRejectedValueOnce(
      new Error("Merge R2 offline"),
    );
    const deletion = vi.spyOn(env.UPLOADED_FILES, "delete");
    await expect(
      handleUploadComplete(completeRequest(), env, "alice"),
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(deletion).not.toHaveBeenCalled();
    expect((await listUserFiles(env, "alice"))[0]).toMatchObject({
      bytes: 5,
      status: "uploading",
    });
    expect(
      await (await handleUploadStatus(statusRequest(), env, "alice")).json(),
    ).toMatchObject({ receivedIndices: [0, 1, 2] });
    expect(
      (await handleUploadComplete(completeRequest(), env, "alice")).status,
    ).toBe(200);
  });

  it("recovers a merged object after its metadata commit fails, preserving server SHA-256", async () => {
    const { env, states } = setup();
    await handleUploadChunk(uploadRequest(chunkForm()), env, "alice");
    await handleUploadChunk(
      uploadRequest(chunkForm({ chunkIndex: "1" }, "cd")),
      env,
      "alice",
    );
    await handleUploadChunk(
      uploadRequest(chunkForm({ chunkIndex: "2" }, "e")),
      env,
      "alice",
    );
    const internal = await ownedFileId("alice", "demo"),
      storage = states.get(internal)!.storage;
    vi.spyOn(storage, "put").mockRejectedValueOnce(
      new Error("Merge commit offline"),
    );
    await expect(
      handleUploadComplete(completeRequest(), env, "alice"),
    ).rejects.toThrow();
    const object = await env.UPLOADED_FILES.get(
      getUploadedFileObjectKey(internal),
    );
    expect(object?.customMetadata?.serverContentHash).toMatch(/^[a-f0-9]{64}$/);
    await handleUploadComplete(completeRequest(), env, "alice");
    expect(await storage.get("meta:" + internal)).toMatchObject({
      isMerged: true,
      serverContentHash: object?.customMetadata?.serverContentHash,
    });
    expect(
      await env.UPLOADED_FILES.head(getUploadedFileChunkObjectKey(internal, 0)),
    ).toBeNull();
  });

  it("retries chunk cleanup after a committed merge without uploading again", async () => {
    const { env } = setup();
    await handleUploadChunk(
      uploadRequest(chunkForm({ fileSize: "2", totalChunks: "1" })),
      env,
      "alice",
    );
    const internal = await ownedFileId("alice", "demo");
    vi.spyOn(env.UPLOADED_FILES, "delete").mockRejectedValueOnce(
      new Error("Cleanup offline"),
    );
    await expect(
      handleUploadComplete(completeRequest(), env, "alice"),
    ).rejects.toThrow();
    expect(
      await env.UPLOADED_FILES.head(getUploadedFileObjectKey(internal)),
    ).not.toBeNull();
    await handleUploadComplete(completeRequest(), env, "alice");
    expect(
      await env.UPLOADED_FILES.head(getUploadedFileChunkObjectKey(internal, 0)),
    ).toBeNull();
  });

  it("rejects a conflicting duplicate without changing the original R2 bytes", async () => {
    const { env } = setup();
    await handleUploadChunk(uploadRequest(chunkForm()), env, "alice");
    await expect(
      handleUploadChunk(uploadRequest(chunkForm({}, "zz")), env, "alice"),
    ).rejects.toMatchObject({ code: "UPLOAD_CHUNK_CONFLICT", statusCode: 409 });
    const internal = await ownedFileId("alice", "demo");
    expect(
      await (
        await env.UPLOADED_FILES.get(getUploadedFileChunkObjectKey(internal, 0))
      )?.text(),
    ).toBe("ab");
  });

  it("rejects a wrong completion hash and byte-size mismatch without publishing a file", async () => {
    const { env } = setup();
    await handleUploadChunk(
      uploadRequest(chunkForm({ fileSize: "2", totalChunks: "1" })),
      env,
      "alice",
    );
    await expect(
      handleUploadComplete(
        completeRequest({ fileId: "demo", fileHash: "wrong" }),
        env,
        "alice",
      ),
    ).rejects.toMatchObject({ code: "UPLOAD_METADATA_CONFLICT" });
    const internal = await ownedFileId("alice", "demo");
    await env.UPLOADED_FILES.put(
      getUploadedFileChunkObjectKey(internal, 0),
      "different",
    );
    await expect(
      handleUploadComplete(completeRequest(), env, "alice"),
    ).rejects.toMatchObject({ code: "UPLOAD_SIZE_MISMATCH" });
    expect(
      await env.UPLOADED_FILES.head(getUploadedFileObjectKey(internal)),
    ).toBeNull();
  });

  it.each([
    { totalChunks: 0 },
    { totalChunks: 257 },
    { totalSize: -1 },
    { receivedIndices: [0, 0], receivedChunks: 2 },
    { receivedIndices: [0.5] },
    { receivedChunks: 2 },
    { receivedIndices: null },
    { receivedBytes: -1 },
    { chunkSize: 0 },
    { fileId: "someone-else" },
    { isMerged: "yes" },
  ])("fails explicitly on invalid stored schema: %j", async (corruptFields) => {
    const { env, states } = setup();
    await handleUploadChunk(uploadRequest(chunkForm()), env, "alice");
    const internal = await ownedFileId("alice", "demo"),
      storage = states.get(internal)!.storage;
    const metadata = await storage.get<FileMetadata>("meta:" + internal);
    await storage.put("meta:" + internal, { ...metadata, ...corruptFields });
    const deletion = vi.spyOn(env.UPLOADED_FILES, "delete");
    await expect(
      handleUploadStatus(statusRequest(), env, "alice"),
    ).rejects.toMatchObject({
      code: "UPLOAD_METADATA_INVALID",
      statusCode: 409,
    });
    expect(deletion).not.toHaveBeenCalled();
  });

  it("refuses an owned multipart fileId without a matching lease target", async () => {
    const { env } = setup();
    const form = chunkForm();
    form.set("fileId", await ownedFileId("alice", "demo"));
    const object = new ChunkStorage(
      new MemoryDurableObjectState() as unknown as DurableObjectState,
      env,
    );
    const response = await object.fetch(
      new Request("https://chunk-storage/?action=storeChunk", {
        method: "POST",
        body: form,
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "FILE_LEASE_REQUIRED",
    });
  });

  it("restores a verified hash in legacy merged metadata and fails explicitly if the merged body is gone", async () => {
    const { env, states } = setup();
    await handleUploadChunk(
      uploadRequest(chunkForm({ fileSize: "2", totalChunks: "1" })),
      env,
      "alice",
    );
    await handleUploadComplete(completeRequest(), env, "alice");
    const internal = await ownedFileId("alice", "demo"),
      key = "meta:" + internal;
    const storage = states.get(internal)!.storage;
    const metadata = (await storage.get<FileMetadata>(key))!;
    const legacy = { ...metadata };
    delete legacy.serverContentHash;
    await storage.put(key, legacy);
    await handleUploadComplete(completeRequest(), env, "alice");
    expect(await storage.get(key)).toMatchObject({
      serverContentHash: metadata.serverContentHash,
    });
    await env.UPLOADED_FILES.delete(getUploadedFileObjectKey(internal));
    await expect(
      handleUploadComplete(completeRequest(), env, "alice"),
    ).rejects.toMatchObject({ code: "FILE_VERSION_MISSING", statusCode: 410 });
    expect(await storage.get(key)).toMatchObject({
      isMerged: true,
      serverContentHash: metadata.serverContentHash,
    });
  });
});
