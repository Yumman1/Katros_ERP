const fs = require('fs');
const path = 'kastros-ctrm/server/routers/execution.ts';
let content = fs.readFileSync(path, 'utf8');

const newProcedures = `

  // ─── Pending Truck procedures ─────────────────────────────────────────────

  pendingTrucks: roleProcedure([...execRoles])
    .input(
      z.object({
        counterpartyName: z.string().optional(),
        warehouseName: z.string().optional(),
        movementType: z.enum(["INBOUND", "OUTBOUND"]).optional(),
        status: z.enum(["PENDING", "ASSIGNED", "PARTIAL"]).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      }).optional(),
    )
    .query(({ input }) => {
      if (isMockMode()) seedExecutionDemoIfEmpty();
      return getPendingTrucks(input ?? undefined);
    }),

  createPendingTruck: roleProcedure([...execRoles])
    .input(
      z.object({
        counterpartyName: z.string().min(1),
        brokerName: z.string().optional(),
        movementType: z.enum(["INBOUND", "OUTBOUND"]),
        warehouseName: z.string().min(1),
        truckNo: z.string().min(1),
        driverName: z.string().optional(),
        driverCnic: z.string().optional(),
        driverPhone: z.string().optional(),
        weightKg: z.number().positive(),
        bags: z.number().optional(),
        remarks: z.string().optional(),
        gatepassNo: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      try {
        return createPendingTruck(input);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  assignTruckToTrade: roleProcedure([...execRoles])
    .input(
      z.object({
        truckId: z.string(),
        tradeRef: z.string(),
        overrideWeightKg: z.number().positive().optional(),
      }),
    )
    .mutation(({ input }) => {
      try {
        return assignTruckToTrade(input.truckId, input.tradeRef, input.overrideWeightKg);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : "Failed" });
      }
    }),

  exportMovementsCsv: roleProcedure([...execRoles])
    .input(
      z.object({
        warehouseName: z.string().optional(),
        commodityCode: z.string().optional(),
        movementType: z.enum(["INBOUND", "OUTBOUND", "ALL"]).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      }).optional(),
    )
    .mutation(({ input }) => {
      const csv = exportMovementsCsv(input ?? undefined);
      const today = new Date().toISOString().slice(0, 10);
      return { csv, filename: \`movements-\${today}.csv\` };
    }),
});
`;

// Replace the last "})" in the file
const lastBrace = content.lastIndexOf('});');
if (lastBrace === -1) { console.error('closing not found'); process.exit(1); }
content = content.slice(0, lastBrace) + newProcedures;
fs.writeFileSync(path, content, 'utf8');
console.log('done, file size:', content.length);
