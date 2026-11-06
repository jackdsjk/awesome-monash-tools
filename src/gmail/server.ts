#!/usr/bin/env node
import { serve } from "../core/mcp.js";
import { createGmailServer } from "./tools.js";

await serve(createGmailServer(), "gmail");
