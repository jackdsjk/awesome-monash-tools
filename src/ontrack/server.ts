#!/usr/bin/env node
import { serve } from "../core/mcp.js";
import { createOnTrackServer } from "./tools.js";

await serve(createOnTrackServer(), "ontrack");
