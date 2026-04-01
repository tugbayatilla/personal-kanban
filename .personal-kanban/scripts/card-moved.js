#!/usr/bin/env node
// Fires whenever a card moves between columns.
//
// Hook event: card.moved
// Payload: { event, timestamp, card_id, card_title, from_column, to_column }
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
    process.stderr.write('card-moved: invalid JSON payload\n');
    process.exit(1);
  }

  const { card_id, card_title, from_column, to_column } = payload;
  process.stdout.write(`card moved: "${card_title}" (${card_id}) ${from_column} → ${to_column}\n`);
});
