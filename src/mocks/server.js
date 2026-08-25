// @ts-check

/**
 * @file server.js
 * MSW server instance for Node.js (Vitest) test environment.
 *
 * @module mocks/server
 */

import { setupServer } from "msw/node";
import { handlers } from "./handlers.js";

/** MSW server for all Vitest tests. */
export const server = setupServer(...handlers);
