#!/usr/bin/env node
import { serve } from "../core/mcp.js";
import { createAttendanceServer } from "./tools.js";

await serve(createAttendanceServer(), "attendance");
