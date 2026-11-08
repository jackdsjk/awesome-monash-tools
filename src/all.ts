#!/usr/bin/env node
import { createServer, serve } from "./core/mcp.js";
import { registerAttendanceTools } from "./attendance/tools.js";
import { registerEdTools } from "./ed/tools.js";
import { registerGmailTools } from "./gmail/tools.js";
import { registerMoodleTools } from "./moodle/tools.js";
import { registerOnTrackTools } from "./ontrack/tools.js";

const server = createServer(
  "awesome-monash-all",
  "One MCP server for Ed, Moodle, Gmail, OnTrack and attendance. Tool prefixes name the source (ed_, moodle_, gmail_, ontrack_, attendance_); use `awesome-monash login <source>` for any that report a missing session.",
);

registerEdTools(server);
registerMoodleTools(server);
registerAttendanceTools(server);
registerGmailTools(server);
registerOnTrackTools(server);

await serve(server, "all");
