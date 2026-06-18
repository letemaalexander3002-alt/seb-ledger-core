'use strict';

/**
 * ============================================================
 *  SEB-LEDGER CORE — Re-Packager
 *
 *  Produces a clean, timestamped ZIP of this project for transfer
 *  (e.g. to a Termux device), excluding node_modules, .env, .git,
 *  and other local-only artifacts. Pure Node.js — no npm
 *  dependencies required, so it works even before `npm install`.
 *
 *  Usage:
 *    node package-zip.js
 * ============================================================
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PROJECT_ROOT = __dirname;
const PROJECT_NAME = 'seb-ledger-core';

// Anything matching these (by exact name or, for directories, by name
// anywhere in the path) is left out of the archive.
const EXCLUDE_NAMES = new Set([
  'node_modules',
  '.git',
  '.env',
  '.DS_Store',
  'dist',
  'coverage',
]);

function shouldExclude(entryName) {
  const segments = entryName.split(path.sep);
  return segments.some((seg) => EXCLUDE_NAMES.has(seg));
}

function walk(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(PROJECT_ROOT, fullPath);
    if (shouldExclude(relPath)) continue;

    if (entry.isDirectory()) {
      walk(fullPath, fileList);
    } else if (entry.isFile()) {
      fileList.push(relPath);
    }
  }
  return fileList;
}

/**
 * Minimal ZIP (store + deflate) writer — enough to produce a valid,
 * widely-compatible archive without external dependencies.
 */
function crc32(buf) {
  let crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function buildZip(files) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const relPath of files) {
    const absPath = path.join(PROJECT_ROOT, relPath);
    const data = fs.readFileSync(absPath);
    const compressed = zlib.deflateRawSync(data);
    const useCompression = compressed.length < data.length;
    const payload = useCompression ? compressed : data;
    const method = useCompression ? 8 : 0; // 8 = deflate, 0 = store

    const crc = crc32(data);
    const nameBuf = Buffer.from(relPath.split(path.sep).join('/'), 'utf8');

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDirStart = offset;
  const centralDir = Buffer.concat(centralChunks);
  const centralDirSize = centralDir.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDir, eocd]);
}

function main() {
  const files = walk(PROJECT_ROOT);
  if (files.length === 0) {
    console.error('[package-zip] No files found to package. Aborting.');
    process.exit(1);
  }

  const zipBuffer = buildZip(files);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outputName = `${PROJECT_NAME}_${timestamp}.zip`;
  const outputPath = path.join(PROJECT_ROOT, outputName);

  fs.writeFileSync(outputPath, zipBuffer);
  console.log(`[package-zip] Wrote ${files.length} files to ${outputName} (${zipBuffer.length} bytes).`);
}

main();
