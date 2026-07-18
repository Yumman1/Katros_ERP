import { resetAllLocalData } from "../server/reset-local-data";

const { cleared } = resetAllLocalData();
console.log("Cleared local data files:");
for (const file of cleared) {
  console.log(`  - ${file}`);
}
