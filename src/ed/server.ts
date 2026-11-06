#!/usr/bin/env node
import { serve } from "../core/mcp.js";
import { createEdServer } from "./tools.js";

await serve(createEdServer(), "ed");
