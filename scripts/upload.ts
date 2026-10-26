// nahraje dist/ na FTP do /www/subdom/app/mafia-game/ = https://app.makuderovi.cz/mafia-game/
// prevzato z repa todo (makuderovi scripts/upload.ts), spousti se z korene repa: npm run upload
// pristup na FTP je v conf/env.json (neni v gitu): { "ftp": { "host", "user", "password", "secure" } }
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'basic-ftp';

const FTP_PATH = '/www/subdom/app/mafia-game/';
const DIST_PATH = path.resolve('dist');
const ENV_FILE = path.resolve('conf/env.json');
// relativni cesta souboru v dist -> md5 obsahu, odpovida stavu na serveru po poslednim uploadu
const MANIFEST_FILE = path.resolve('build-data/upload.json');

type UploadManifest = Record<string, string>;

function readFtpAccess() {
  const env = JSON.parse(fs.readFileSync(ENV_FILE, 'utf-8'));

  if (!env.ftp?.host) {
    throw new Error(`V ${ENV_FILE} chybí přístup na FTP (klíč ftp)`);
  }

  return env.ftp;
}

function getLocalFiles(dir: string, base = dir): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    return entry.isDirectory()
      ? getLocalFiles(fullPath, base)
      : [path.relative(base, fullPath).split(path.sep).join('/')];
  });
}

function getFileHash(file: string) {
  return createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

function readManifest(): UploadManifest {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Nahraje jen soubory, ktere se od posledniho uploadu zmenily, a smaze ze serveru soubory z minuleho uploadu,
 * ktere v buildu uz nejsou (stare js/css s hashem). Mazani az po nahrani novych, aby web behem uploadu fungoval.
 * Manifest se zapise i pri chybe uprostred - obsahuje, co uz na serveru je.
 */
async function main() {
  // --full - nahrat vse znovu (manifest se ignoruje, nic se nemaze)
  const full = process.argv.includes('--full');
  const prevManifest = full ? {} : readManifest();
  const manifest: UploadManifest = { ...prevManifest };
  const localFiles = new Set(getLocalFiles(DIST_PATH));
  const client = new Client();
  let uploaded = 0;
  let skipped = 0;
  let removed = 0;

  try {
    await client.access(readFtpAccess());
    console.log(`Upload dist -> ${FTP_PATH}${full ? ' (full)' : ''}`);

    let currentDir = '';

    for (const file of [...localFiles].sort()) {
      const hash = getFileHash(path.join(DIST_PATH, file));

      if (prevManifest[file] === hash) {
        skipped++;
        continue;
      }

      const dir = path.posix.join(FTP_PATH, path.posix.dirname(file));

      // ensureDir vytvori slozku a prepne se do ni
      if (dir !== currentDir) {
        await client.ensureDir(dir);
        currentDir = dir;
      }

      console.log(`Upload ${file}`);
      await client.uploadFrom(path.join(DIST_PATH, file), path.posix.basename(file));
      manifest[file] = hash;
      uploaded++;
    }

    for (const file of Object.keys(prevManifest)) {
      if (!localFiles.has(file)) {
        console.log(`Remove ${file}`);
        // true - soubor uz na serveru byt nemusi
        await client.remove(path.posix.join(FTP_PATH, file), true);
        delete manifest[file];
        removed++;
      }
    }

    console.log(`Uploaded ${uploaded}, unchanged ${skipped}, removed ${removed}`);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }

  client.close();
  fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf-8');
}

main();
