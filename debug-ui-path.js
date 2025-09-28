#!/usr/bin/env node

import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Replicate the WebServerManager path logic exactly
const currentFileUrl = import.meta.url;
const currentFilePath = fileURLToPath(currentFileUrl);

console.log('Debug UI Path Resolution:');
console.log('=========================');
console.log('currentFileUrl:', currentFileUrl);
console.log('currentFilePath:', currentFilePath);

// Simulate running from dist/src/app/index.cjs
const simulatedPath = path.resolve(process.cwd(), 'dist/src/app/index.cjs');
console.log('simulatedPath:', simulatedPath);

const isCompiledVersion = simulatedPath.includes('/dist/') || simulatedPath.includes('\\dist\\');
console.log('isCompiledVersion:', isCompiledVersion);

let uiPath;
if (isCompiledVersion) {
    uiPath = path.resolve(path.dirname(simulatedPath), 'ui');
} else {
    uiPath = path.resolve(path.dirname(simulatedPath), '../ui');
}

console.log('calculated uiPath:', uiPath);
console.log('UI directory exists:', existsSync(uiPath));

if (existsSync(uiPath)) {
    const packageJsonPath = path.join(uiPath, 'package.json');
    console.log('packageJsonPath:', packageJsonPath);
    console.log('package.json exists:', existsSync(packageJsonPath));

    const standalonePath = path.join(uiPath, '.next', 'standalone');
    const standaloneServerPath = path.join(standalonePath, 'server.js');
    console.log('standalonePath:', standalonePath);
    console.log('standaloneServerPath:', standaloneServerPath);
    console.log('standalone server exists:', existsSync(standaloneServerPath));
}