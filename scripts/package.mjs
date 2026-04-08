import { execSync } from "child_process";
import { readFileSync } from "fs";

const manifest = JSON.parse(readFileSync("manifest.json", "utf-8"));
const version = manifest.version;
const filename = `aftermark-v${version}.zip`;

// Zip everything the extension needs (exclude dev files)
execSync(
  `zip -r ${filename} manifest.json dist/ src/popup/ src/options/ src/tab/ src/privacy/ src/assets/ -x "*.ts"`,
  { stdio: "inherit" }
);

console.log(`\nPackaged: ${filename}`);
