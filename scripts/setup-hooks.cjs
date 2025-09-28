#!/usr/bin/env node

/**
 * Cipher Git Hooks Setup
 * Připraví pre-commit hooks pro všechny vývojáře
 */

const { execSync } = require('child_process');
const fs = require('fs');

function log(message) {
  console.log(`🔧 ${message}`);
}

function error(message) {
  console.error(`❌ ${message}`);
}

function success(message) {
  console.log(`✅ ${message}`);
}

function checkHuskyInstalled() {
  try {
    execSync('npx husky --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function installHusky() {
  log('Instaluje Husky...');
  try {
    execSync('npm install --save-dev husky', { stdio: 'inherit' });
    success('Husky nainstalován');
    return true;
  } catch (err) {
    error('Chyba při instalaci Husky:', err.message);
    return false;
  }
}

function initializeHusky() {
  log('Inicializuje Husky...');
  try {
    execSync('npx husky init', { stdio: 'inherit' });
    success('Husky inicializován');
    return true;
  } catch (err) {
    error('Chyba při inicializaci Husky:', err.message);
    return false;
  }
}

function setupPreCommitHook() {
  const hookPath = '.husky/pre-commit';
  const hookContent = `# Cipher Pre-commit Hook
# 1. Detekce secrets a API klíčů
node scripts/detect-secrets.cjs

# 2. Spuštění testů (pokud existují)
# npm test`;

  try {
    fs.writeFileSync(hookPath, hookContent);
    success('Pre-commit hook nastaven');
    return true;
  } catch (err) {
    error('Chyba při nastavení pre-commit hook:', err.message);
    return false;
  }
}

function ensureScriptExists() {
  const scriptPath = 'scripts/detect-secrets.cjs';

  if (!fs.existsSync(scriptPath)) {
    error(`Secret detection script nenalezen: ${scriptPath}`);
    log('Ujisti se, že soubor scripts/detect-secrets.cjs existuje');
    return false;
  }

  success('Secret detection script nalezen');
  return true;
}

function testPreCommitHook() {
  log('Testuje pre-commit hook...');
  try {
    execSync('node scripts/detect-secrets.cjs', { stdio: 'inherit' });
    success('Pre-commit hook funguje správně');
    return true;
  } catch (err) {
    error('Pre-commit hook test selhal:', err.message);
    return false;
  }
}

function main() {
  console.log('🚀 Cipher Git Hooks Setup');
  console.log('=========================\n');

  // Krok 1: Zkontroluj, zda existuje detection script
  if (!ensureScriptExists()) {
    process.exit(1);
  }

  // Krok 2: Zkontroluj/instaluj Husky
  if (!checkHuskyInstalled()) {
    log('Husky není nainstalován, instaluje...');
    if (!installHusky()) {
      process.exit(1);
    }
  } else {
    success('Husky už je nainstalován');
  }

  // Krok 3: Inicializuj Husky
  if (!fs.existsSync('.husky')) {
    if (!initializeHusky()) {
      process.exit(1);
    }
  } else {
    success('Husky už je inicializován');
  }

  // Krok 4: Nastav pre-commit hook
  if (!setupPreCommitHook()) {
    process.exit(1);
  }

  // Krok 5: Test hook
  if (!testPreCommitHook()) {
    process.exit(1);
  }

  console.log('\n🎉 Pre-commit hooks byly úspěšně nastaveny!');
  console.log('\n📋 Co bylo provedeno:');
  console.log('• ✅ Husky nainstalován a inicializován');
  console.log('• ✅ Pre-commit hook nastaven pro detekci secrets');
  console.log('• ✅ Secret detection script připraven');

  console.log('\n🔒 Bezpečnost:');
  console.log('• Každý commit nyní projde automatickou kontrolou API klíčů');
  console.log('• Commit bude zablokován při detekci skutečných secrets');
  console.log('• Pro urgentní bypas použij: git commit --no-verify (NEDOPORUČUJE SE)');

  console.log('\n👥 Pro ostatní vývojáře:');
  console.log('• Po git pull spusť: npm run setup-hooks');
  console.log('• Hooks se automaticky aktivují pro všechny nové commits');
}

if (require.main === module) {
  main();
}