#!/usr/bin/env node
// Moves a card to the done column in the manifest (v2 format).
//
// Usage (standalone):
//   node card-to-done.js <card_id>
//
// Usage (via hook — reads JSON payload from stdin):
//   echo '{"card_id":"20260327-ea39"}' | node card-to-done.js

'use strict';

const fs = require('fs');
const path = require('path');

const BOARD_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(BOARD_ROOT, 'manifest.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

async function getCardId() {
  if (process.argv[2]) {
    return process.argv[2];
  }
  return new Promise((resolve) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { raw += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(raw).card_id || null);
      } catch {
        resolve(null);
      }
    });
  });
}

(async () => {
  const cardId = await getCardId();

  if (!cardId) {
    process.stderr.write('Error: card_id is required\n');
    process.exit(1);
  }

  const manifest = readJson(MANIFEST_PATH);

  manifest.columns = manifest.columns.map(col => {
    if (col.id === 'done') {
      if (!col.cards.includes(cardId)) {
        col.cards.push(cardId);
      }
    } else {
      col.cards = col.cards.filter(id => id !== cardId);
    }
    return col;
  });

  writeJsonAtomic(MANIFEST_PATH, manifest);

  const cardPath = path.join(BOARD_ROOT, 'cards', `${cardId}.json`);
  if (fs.existsSync(cardPath)) {
    const card = readJson(cardPath);
    card.metadata.updated_at = new Date().toISOString();
    writeJsonAtomic(cardPath, card);
  }

  process.stdout.write(`Card ${cardId} moved to done.\n`);
})();
