#!/usr/bin/env node
import { Command } from 'commander';
import { registerInit } from './commands/init';
import { registerStatus } from './commands/status';
import { registerAdd } from './commands/add';
import { registerMove } from './commands/move';
import { registerDone } from './commands/done';
import { registerArchive } from './commands/archive';

const program = new Command();
program
  .name('kanban')
  .description('Personal kanban board CLI')
  .version('1.0.0');

registerInit(program);
registerStatus(program);
registerAdd(program);
registerMove(program);
registerDone(program);
registerArchive(program);

program.parse(process.argv);
