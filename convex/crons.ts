/** Registers scheduled Convex jobs. */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "flush analytics outbox",
  { minutes: 1 },
  internal.actions.analyticsFlushNode.flushOutbox,
);

export default crons;
