/*
  Deduplicate a JSON array by token, keeping only the entry with the highest Final P&L.

  Usage:
    node src/scripts/dedupeJsonByTokenHighestPnl.js --in path/to/input.json [--out path/to/output.json] [--tokenKey tokenKeyName] [--pnlKey pnlKeyName]

  Defaults:
    --tokenKey tries: token, symbol, coin, ticker (first found on objects)
    --pnlKey   tries: "Final P&L", Final Pnl, FinalPnL, Final_PnL, final_pnl, finalPnl, FinalPNL, finalPNL, Final_P&L, pnl, PNL (first found)
    --out      defaults to <input>.deduped.json next to input file
*/

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--in' || arg === '-i') {
      args.input = argv[++i];
    } else if (arg === '--out' || arg === '-o') {
      args.output = argv[++i];
    } else if (arg === '--tokenKey') {
      args.tokenKey = argv[++i];
    } else if (arg === '--pnlKey') {
      args.pnlKey = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }
  return args;
}

function showHelpAndExit() {
  console.log(
    'Usage: node src/scripts/dedupeJsonByTokenHighestPnl.js --in <input.json> [--out <output.json>] [--tokenKey <key>] [--pnlKey <key>]' +
      '\n\nNotes:\n' +
      ' - Input must be a JSON array of objects.\n' +
      ' - The script keeps, for each token, the object with the highest Final P&L.\n' +
      ' - If tokenKey/pnlKey not provided, common fallbacks are auto-detected.'
  );
  process.exit(0);
}

function detectKey(candidates, sampleObjects) {
  for (const key of candidates) {
    for (const obj of sampleObjects) {
      if (obj && Object.prototype.hasOwnProperty.call(obj, key)) return key;
    }
  }
  return undefined;
}

function toNumber(value) {
  if (value == null) return Number.NEGATIVE_INFINITY;
  if (typeof value === 'number') return isFinite(value) ? value : Number.NEGATIVE_INFINITY;
  if (typeof value === 'string') {
    const normalized = value.replace(/[\,\s]/g, '');
    const parsed = Number(normalized);
    return isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }
  return Number.NEGATIVE_INFINITY;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.input) {
    showHelpAndExit();
  }

  const inputPath = path.resolve(process.cwd(), args.input);
  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse JSON. Ensure the file contains a JSON array.');
    console.error(err.message);
    process.exit(1);
  }

  if (!Array.isArray(data)) {
    console.error('Input JSON must be an array of objects.');
    process.exit(1);
  }

  const sample = data.slice(0, Math.min(data.length, 25));

  const tokenKey =
    args.tokenKey ||
    detectKey(['token', 'symbol', 'coin', 'ticker', 'name'], sample);

  const pnlKey =
    args.pnlKey ||
    detectKey([
      'Final P&L',
      'Final Pnl',
      'FinalPnL',
      'Final_PnL',
      'final_pnl',
      'finalPnl',
      'FinalPNL',
      'finalPNL',
      'Final_P&L',
      'pnl',
      'PNL',
    ], sample);

  if (!tokenKey) {
    console.error('Could not detect token key. Provide it via --tokenKey.');
    process.exit(1);
  }
  if (!pnlKey) {
    console.error('Could not detect Final P&L key. Provide it via --pnlKey.');
    process.exit(1);
  }

  console.log(`Using tokenKey="${tokenKey}", pnlKey="${pnlKey}"`);

  const bestByToken = new Map();
  for (let index = 0; index < data.length; index++) {
    const item = data[index];
    if (item == null || typeof item !== 'object') continue;

    const tokenValue = item[tokenKey];
    if (tokenValue == null) continue;

    const pnlValue = toNumber(item[pnlKey]);
    const tokenStr = String(tokenValue);

    const existing = bestByToken.get(tokenStr);
    if (!existing) {
      bestByToken.set(tokenStr, { item, pnl: pnlValue, firstIndex: index });
    } else if (pnlValue > existing.pnl) {
      bestByToken.set(tokenStr, { item, pnl: pnlValue, firstIndex: existing.firstIndex });
    }
  }

  const dedupedWithIndex = Array.from(bestByToken.values());
  dedupedWithIndex.sort((a, b) => a.firstIndex - b.firstIndex);
  const deduped = dedupedWithIndex.map((e) => e.item);

  const outputPath = path.resolve(
    process.cwd(),
    args.output || `${inputPath.replace(/\.json$/i, '')}.deduped.json`
  );

  fs.writeFileSync(outputPath, JSON.stringify(deduped, null, 2), 'utf8');

  console.log(
    `Deduped ${data.length} -> ${deduped.length} records. Saved to: ${outputPath}`
  );
}

main();
