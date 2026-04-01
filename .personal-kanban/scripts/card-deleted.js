#!/usr/bin/env node
// Fires when a card is deleted.
//
// Hook event: card.deleted
// Payload: { event, timestamp, card_id, card_title, last_column }
//
// Note: by the time this fires the card file has already been removed.

'use strict';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write('card-deleted: invalid JSON payload\n');
    process.exit(1);
  }

  const { card_id, card_title, last_column } = payload;
  process.stdout.write(`card deleted: "${card_title}" (${card_id}) from ${last_column}\n`);
});
