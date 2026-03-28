#!/usr/bin/env node
// Outputs the next card to work on without exposing the full manifest.
//
// Priority: in-progress[0] → refined[0] → backlog[0]
//
// Usage:
//   node next-card.js

'use strict';

const fs = require('fs');
const path = require('path');

const BOARD_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(BOARD_ROOT, 'manifest.json');

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

const PRIORITY = ['in-progress', 'refined', 'backlog'];

let nextId = null;
for (const colId of PRIORITY) {
  const col = manifest.columns.find(c => c.id === colId);
  if (col && col.cards.length > 0) {
    nextId = col.cards[0];
    break;
  }
}

if (!nextId) {
  process.stderr.write('No cards available.\n');
  process.exit(1);
}

const cardPath = path.join(BOARD_ROOT, 'cards', `${nextId}.json`);
process.stdout.write(fs.readFileSync(cardPath, 'utf8'));
