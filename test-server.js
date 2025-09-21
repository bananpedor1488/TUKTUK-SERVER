#!/usr/bin/env node

/**
 * Simple server test script
 * Tests if the server can start without errors
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 Testing server startup...');

// Test server startup
const serverProcess = spawn('node', ['server.js'], {
  cwd: __dirname,
  stdio: 'pipe',
  env: {
    ...process.env,
    NODE_ENV: 'test'
  }
});

let output = '';
let errorOutput = '';

serverProcess.stdout.on('data', (data) => {
  output += data.toString();
  console.log('📤 STDOUT:', data.toString().trim());
});

serverProcess.stderr.on('data', (data) => {
  errorOutput += data.toString();
  console.log('📤 STDERR:', data.toString().trim());
});

// Test timeout
const testTimeout = setTimeout(() => {
  console.log('⏰ Test timeout reached');
  serverProcess.kill();
  process.exit(1);
}, 10000); // 10 seconds

serverProcess.on('close', (code) => {
  clearTimeout(testTimeout);
  
  if (code === 0) {
    console.log('✅ Server test passed');
    process.exit(0);
  } else {
    console.log('❌ Server test failed with code:', code);
    console.log('Error output:', errorOutput);
    process.exit(1);
  }
});

serverProcess.on('error', (error) => {
  clearTimeout(testTimeout);
  console.log('❌ Server process error:', error);
  process.exit(1);
});

// If server starts successfully, kill it after 3 seconds
setTimeout(() => {
  if (output.includes('Server running on port')) {
    console.log('✅ Server started successfully, killing test process');
    serverProcess.kill();
  }
}, 3000);
