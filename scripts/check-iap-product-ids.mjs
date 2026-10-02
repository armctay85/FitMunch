#!/usr/bin/env node
/**
 * Fail if sellable iOS IAP product IDs are not exactly
 * fitmunch_monthly and fitmunch_annual.
 * fitmunch_weekly was removed in PR 19 and must not come back.
 *
 * Scope: FitMunch app Swift sources and StoreKit configuration files.
 * Test files may name the dropped id in negative assertions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED = ['fitmunch_monthly', 'fitmunch_annual'];
const ID_RE = /fitmunch_[a-z0-9_]+/g;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function exactError(ids, label) {
  const got = [...ids].sort();
  const want = [...EXPECTED].sort();
  const same =
    got.length === want.length && got.every((id, index) => id === want[index]);
  if (same) return null;
  return `${label} product IDs are [${got.join(', ')}], expected exactly ${EXPECTED.join(' and ')}`;
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function collectProductIds(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectProductIds(item, out);
    return;
  }
  if (typeof node.productID === 'string') out.push(node.productID);
  for (const value of Object.values(node)) collectProductIds(value, out);
}

function productIdsInConstants(source) {
  const match = source.match(/enum ProductIDs \{([\s\S]*?)\n    \}/);
  if (!match) return { error: 'Constants.ProductIDs enum not found' };
  const ids = [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  return { ids };
}

export function checkIapProductIds(files) {
  const errors = [];

  const constants = productIdsInConstants(files.constants);
  if (constants.error) errors.push(constants.error);
  else {
    const constantsError = exactError(constants.ids, 'Constants.ProductIDs');
    if (constantsError) errors.push(constantsError);
    if (constants.ids.join(',') !== EXPECTED.join(',')) {
      errors.push(
        `Constants.ProductIDs declaration order is [${constants.ids.join(', ')}], expected ${EXPECTED.join(' then ')}`
      );
    }
  }

  let store;
  try {
    store = JSON.parse(files.storekit);
  } catch (error) {
    errors.push(`StoreKit config is not valid JSON: ${error.message}`);
    store = null;
  }
  if (store) {
    const storeIds = [];
    collectProductIds(store, storeIds);
    const storeError = exactError(storeIds, 'StoreKit');
    if (storeError) errors.push(storeError);
  }

  const unexpected = [];
  const weekly = [];
  for (const file of files.swiftAndStorekit) {
    const text = file.text;
    if (text.includes('fitmunch_weekly')) weekly.push(file.label);
    for (const match of text.matchAll(ID_RE)) {
      if (!EXPECTED.includes(match[0])) {
        unexpected.push(`${match[0]} in ${file.label}`);
      }
    }
  }
  if (weekly.length) {
    errors.push(`fitmunch_weekly reappeared in ${weekly.join(', ')}`);
  }
  if (unexpected.length) {
    errors.push(`unexpected product ids: ${unexpected.join('; ')}`);
  }

  return errors;
}

function selfTest() {
  const errors = [];
  const ok = exactError(['fitmunch_annual', 'fitmunch_monthly'], 'fixture');
  if (ok) errors.push(`accepted pair was rejected: ${ok}`);
  const weekly = exactError(['fitmunch_monthly', 'fitmunch_weekly'], 'fixture');
  if (!weekly) errors.push('weekly id was accepted');
  const missing = exactError(['fitmunch_monthly'], 'fixture');
  if (!missing) errors.push('a single id was accepted');
  const extra = exactError(
    ['fitmunch_monthly', 'fitmunch_annual', 'fitmunch_lifetime'],
    'fixture'
  );
  if (!extra) errors.push('a third id was accepted');
  const duplicate = exactError(
    ['fitmunch_monthly', 'fitmunch_monthly', 'fitmunch_annual'],
    'fixture'
  );
  if (!duplicate) errors.push('a duplicate id was accepted');
  return errors;
}

function loadRepo() {
  const constantsPath = path.join(root, 'FitMunch/Utilities/Constants.swift');
  const storekitPath = path.join(root, 'FitMunchUITests/FitMunchProducts.storekit');
  const swiftFiles = walk(path.join(root, 'FitMunch')).filter((file) => file.endsWith('.swift'));
  const storekitFiles = walk(root).filter((file) => file.endsWith('.storekit'));
  const swiftAndStorekit = [...swiftFiles, ...storekitFiles].map((file) => ({
    label: path.relative(root, file),
    text: fs.readFileSync(file, 'utf8'),
  }));
  return {
    constants: fs.readFileSync(constantsPath, 'utf8'),
    storekit: fs.readFileSync(storekitPath, 'utf8'),
    swiftAndStorekit,
  };
}

function main() {
  const selfErrors = selfTest();
  if (selfErrors.length) {
    console.error('IAP product ID gate FAILED (self-test):');
    for (const error of selfErrors) console.error(`  ${error}`);
    process.exit(1);
  }

  const errors = checkIapProductIds(loadRepo());
  if (errors.length) {
    console.error('IAP product ID gate FAILED:');
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }

  console.log(`IAP product ID gate passed: ${EXPECTED.join(', ')}`);
}

const isDirect =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main();
