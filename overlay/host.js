/**
 * host.js — Native Messaging Host Proxy
 * Chrome runs this script via host.bat.
 * This script launches Electron and translates Native Messaging protocol 
 * so Chrome doesn't kill the process due to protocol errors.
 */
const { spawn } = require('child_process');
const path = require('path');

// Launch Electron
const electronPath = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');
const electronProcess = spawn(electronPath, ['.'], {
  cwd: __dirname,
  stdio: 'ignore' // We don't want Electron polluting stdout!
});

// If Chrome disconnects, stdin will end, so we should kill Electron and exit
process.stdin.on('end', () => {
  electronProcess.kill();
  process.exit(0);
});

// Handle incoming Native Messaging messages from Chrome
process.stdin.on('data', (chunk) => {
  // We don't actually need to process the messages since we use WebSocket,
  // but we keep the pipe open so Chrome knows we're alive.
});

// Send a dummy "started" message back to Chrome to satisfy the protocol
const msg = Buffer.from(JSON.stringify({ status: 'started' }));
const header = Buffer.alloc(4);
header.writeUInt32LE(msg.length, 0);
process.stdout.write(header);
process.stdout.write(msg);

// If Electron dies, kill this host
electronProcess.on('exit', () => {
  process.exit(0);
});
