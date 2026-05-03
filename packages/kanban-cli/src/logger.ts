import type { Logger } from '@personal-kanban/core';

export const consoleLogger: Logger = {
  info: (msg) => console.log(msg),
  error: (msg) => console.error(msg)
};
