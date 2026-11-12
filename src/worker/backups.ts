import { errorMessage } from "./repos";

const partSize = 16 * 1024 * 1024;
const listLimit = 1000;
const botIdPattern = /^[A-Za-z0-9_-]+$/;
const binKeyPattern = /^bots\/([A-Za-z0-9_-]+)\/bin\.tar\.gz$/;
const tarWarningExitCode = 1;

export const restoredMarker = "/tmp/flarebot-restored";

interface Backup {
  key: string;
  dir: string;
  entry: string;
  exclude: readonly string[];
}

export const chromeBackup: Backup = {
  key: "computer/chrome.tar.gz",
  dir: "/workspace",
  entry: ".chrome",
  exclude: ["Cache", "Code Cache", "GPUCache", "CacheStorage", "Singleton*"],
};

function binBackup(botId: string): Backup {
  return { key: `bots/${botId}/bin.tar.gz`, dir: `/workspace/bots/${botId}`, entry: "bin", exclude: [] };
}

function logFailure(event: string, key: string, error: unknown): void {
  console.error(JSON.stringify({ event, key, error: errorMessage(error) }));
}

function textOf(stream: ReadableStream | null): Promise<string> {
  return stream === null ? Promise.resolve("") : new Response(stream).text();
}

async function listKeys(bucket: R2Bucket, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, limit: listLimit, ...(cursor === undefined ? {} : { cursor }) });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return keys;
}

async function upload(bucket: R2Bucket, key: string, stream: ReadableStream, finished: Promise<void>): Promise<void> {
  const multipart = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: "application/gzip" } });
  try {
    const parts: R2UploadedPart[] = [];
    const buffer = new Uint8Array(partSize);
    let filled = 0;
    const flush = async (): Promise<void> => {
      parts.push(await multipart.uploadPart(parts.length + 1, buffer.slice(0, filled)));
      filled = 0;
    };
    await stream.pipeTo(
      new WritableStream<Uint8Array>({
        async write(chunk) {
          let offset = 0;
          while (offset < chunk.length) {
            const take = Math.min(partSize - filled, chunk.length - offset);
            buffer.set(chunk.subarray(offset, offset + take), filled);
            filled += take;
            offset += take;
            if (filled === partSize) await flush();
          }
        },
      }),
    );
    if (filled > 0 || parts.length === 0) await flush();
    await finished;
    await multipart.complete(parts);
  } catch (error) {
    await multipart.abort().catch((abortError: unknown) => logFailure("backup_abort_failed", key, abortError));
    throw error;
  }
}

async function pack(container: Container, bucket: R2Bucket, backup: Backup): Promise<void> {
  const excludes = backup.exclude.map((pattern) => `--exclude=${pattern}`);
  const process = await container.exec(["tar", "-czf", "-", ...excludes, "-C", backup.dir, backup.entry], { stdout: "pipe", stderr: "pipe" });
  if (process.stdout === null) throw new Error("tar has no stdout");
  const stderr = textOf(process.stderr);
  const finished = process.exitCode.then(async (code) => {
    if (code > tarWarningExitCode) throw new Error((await stderr).trim() || `tar exited with ${code}`);
  });
  finished.catch(() => undefined);
  await upload(bucket, backup.key, process.stdout, finished);
}

async function unpack(container: Container, bucket: R2Bucket, backup: Backup): Promise<void> {
  const object = await bucket.get(backup.key);
  if (object === null) return;
  const process = await container.exec(["sh", "-c", 'mkdir -p "$1" && tar -xzf - -C "$1"', "unpack", backup.dir], {
    stdin: object.body,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([process.exitCode, textOf(process.stderr)]);
  if (code !== 0) throw new Error(stderr.trim() || `tar exited with ${code}`);
}

async function botsWithBin(container: Container): Promise<string[]> {
  const process = await container.exec(["bash", "-c", 'for dir in /workspace/bots/*/bin; do if [ -d "$dir" ]; then basename "$(dirname "$dir")"; fi; done']);
  const result = await process.output();
  return new TextDecoder().decode(result.stdout).split("\n").filter((id) => botIdPattern.test(id));
}

async function storedBinBackups(bucket: R2Bucket): Promise<Backup[]> {
  return (await listKeys(bucket, "bots/")).flatMap((key) => {
    const botId = binKeyPattern.exec(key)?.[1];
    return botId === undefined ? [] : [binBackup(botId)];
  });
}

export async function backupComputer(container: Container, bucket: R2Bucket, includeChrome: boolean): Promise<void> {
  let backups: Backup[];
  try {
    backups = [...(includeChrome ? [chromeBackup] : []), ...(await botsWithBin(container)).map(binBackup)];
  } catch (error) {
    logFailure("backup_failed", "bots/", error);
    return;
  }
  for (const backup of backups) {
    try {
      await pack(container, bucket, backup);
    } catch (error) {
      logFailure("backup_failed", backup.key, error);
    }
  }
}

export async function restoreComputer(container: Container, bucket: R2Bucket): Promise<string[]> {
  let backups: Backup[];
  try {
    backups = [chromeBackup, ...(await storedBinBackups(bucket))];
  } catch (error) {
    logFailure("restore_failed", "bots/", error);
    backups = [chromeBackup];
  }
  const failed: string[] = [];
  for (const backup of backups) {
    try {
      await unpack(container, bucket, backup);
    } catch (error) {
      logFailure("restore_failed", backup.key, error);
      failed.push(backup.key);
    }
  }
  return failed;
}

export async function deleteBackups(bucket: R2Bucket): Promise<void> {
  const keys = await listKeys(bucket, "");
  for (let start = 0; start < keys.length; start += listLimit) await bucket.delete(keys.slice(start, start + listLimit));
}
