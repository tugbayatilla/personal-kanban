#!/usr/bin/env node
// Fires after a card's branch is merged into main via the board.
//
// Hook event: git.merged
// Payload: { event, timestamp, card_id, card_title, branch }
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
    process.stderr.write('git-merged: invalid JSON payload\n');
    process.exit(1);
  }

  const { card_id, card_title, branch } = payload;
  process.stdout.write(`branch merged: "${card_title}" (${card_id}) — branch: ${branch}\n`);
});
