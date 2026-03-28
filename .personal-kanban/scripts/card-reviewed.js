#!/usr/bin/env node
// Fires a system notification when a card moves to Review.
//
// Hook event: card.reviewed
// Payload: { card_id, card_title, from_column, branch }

'use strict';

const { execSync } = require('child_process');

function notify(title, message) {
  try {
    if (process.platform === 'darwin') {
      execSync(`osascript -e 'display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}'`);
    } else if (process.platform === 'win32') {
      const ps = `[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; [System.Windows.Forms.MessageBox]::Show(${JSON.stringify(message)}, ${JSON.stringify(title)})`;
      execSync(`powershell -Command "${ps}"`, { stdio: 'ignore' });
    } else {
      execSync(`notify-send ${JSON.stringify(title)} ${JSON.stringify(message)}`);
    }
  } catch {
    // Notification failure is non-fatal
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write('Error: invalid JSON payload\n');
    process.exit(1);
  }

  const { card_title, branch } = payload;
  const message = branch
    ? `"${card_title}" is ready for review — branch: ${branch}`
    : `"${card_title}" is ready for review`;

  notify('Kanban: Ready for Review', message);
  process.stdout.write(message + '\n');
});
