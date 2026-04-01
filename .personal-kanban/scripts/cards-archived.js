#!/usr/bin/env node
// Fires after all Done cards are archived.
//
// Hook event: cards.archived
// Payload: { event, timestamp, column }
//
// Archived card files live at: archive/<card_id>.md  (YAML frontmatter + markdown body)

'use strict';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write('cards-archived: invalid JSON payload\n');
    process.exit(1);
  }

  const { column } = payload;
  process.stdout.write(`cards archived from: ${column}\n`);
});
