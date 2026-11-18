// JSON key/value storage: a Cloud Storage bucket when BUCKET is set, else a local folder.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const localDir = path.resolve(process.env.DATA_DIR || 'data');
let bucket = null;
if (process.env.BUCKET) {
  const { Storage } = await import('@google-cloud/storage');
  bucket = new Storage().bucket(process.env.BUCKET);
}

export async function getJSON(key) {
  try {
    if (bucket) {
      const [buf] = await bucket.file(key).download();
      return JSON.parse(buf.toString('utf8'));
    }
    return JSON.parse(await readFile(path.join(localDir, key), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 404) return null;
    throw err;
  }
}

export async function putJSON(key, value) {
  const body = JSON.stringify(value);
  if (bucket) {
    await bucket.file(key).save(body, { contentType: 'application/json', gzip: true, resumable: false });
    return;
  }
  const file = path.join(localDir, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
}
