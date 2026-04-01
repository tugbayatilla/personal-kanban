#!/usr/bin/env node
// Fires when a new card is created.
//
// Hook event: card.created
// Payload: { event, timestamp, card_id, card_title, column }
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
    process.stderr.write('card-created: invalid JSON payload\n');
    process.exit(1);
  }

  const { card_id, card_title, column } = payload;
  process.stdout.write(`card created: "${card_title}" (${card_id}) in ${column}\n`);
});
