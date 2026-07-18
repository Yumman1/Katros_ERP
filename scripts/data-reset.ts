import { resetAllLocalData } from "../server/reset-local-data";
import { prisma } from "../server/db";

async function main() {
  const { cleared } = await resetAllLocalData();
  console.log("Cleared operational tables:");
  for (const table of cleared) {
    console.log(`  - ${table}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
