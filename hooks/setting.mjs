#!/usr/bin/env node
// The before-connect lookup setting, used by /7maps:never and /7maps:always.
//   node hooks/setting.mjs off      turn the lookup off for this user on this machine (all projects)
//   node hooks/setting.mjs on       turn it back on
//   node hooks/setting.mjs status   print the current state
// Writes one small file of this user's own ($XDG_CONFIG_HOME/7maps/settings.json or ~/.config/7maps/settings.json).
// Sends nothing. Prints one line.
import path from 'node:path';
import { configDir, lookupOn, writeSettings } from './connect-check.mjs';

const arg = String(process.argv[2] || 'status').toLowerCase();
const file = path.join(configDir(), 'settings.json');
if (arg === 'off' || arg === 'on') {
  if (!writeSettings({ before_connect: arg })) { console.log(`7Maps: could not write ${file}; the setting is unchanged.`); process.exitCode = 1; }
  else console.log(arg === 'off'
    ? `7Maps before-connect lookup: off (saved in ${file}). /7maps:always turns it back on.`
    : `7Maps before-connect lookup: on (saved in ${file}). /7maps:never turns it off.`);
} else if (arg === 'status') {
  const env = String(process.env.SEVENMAPS_HOOK || '').toLowerCase() === 'off' || String(process.env.SEVENMAPS_BEFORE_CONNECT || '').toLowerCase() === 'off';
  console.log(`7Maps before-connect lookup: ${lookupOn() ? 'on' : 'off'}${env ? ' (turned off by an environment variable)' : ''}. Setting file: ${file}`);
} else {
  console.log('Usage: node hooks/setting.mjs on|off|status');
  process.exitCode = 2;
}
