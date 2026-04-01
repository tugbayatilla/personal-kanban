#!/usr/bin/env node
// Fires when a card's content changes.
//
// Hook event: card.edited
// Payload: { event, timestamp, card_id, card_title }
//
// Card files live at: cards/<card_id>.md  (YAML frontmatter + markdown body)

'use strict';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write('card-edited: invalid JSON payload\n');
    process.exit(1);
  }

  const { card_id, card_title } = payload;
  process.stdout.write(`card edited: "${card_title}" (${card_id})\n`);
});
