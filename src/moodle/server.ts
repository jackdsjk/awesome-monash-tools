#!/usr/bin/env node
import { serve } from "../core/mcp.js";
import { createMoodleServer } from "./tools.js";

await serve(createMoodleServer(), "moodle");
