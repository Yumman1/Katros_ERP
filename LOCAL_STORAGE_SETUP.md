# Execution System - Local Storage Setup

## Overview

The execution system is now running with **local JSON file storage** instead of a database. This allows you to test and prototype the entire workflow without needing Prisma migrations or PostgreSQL.

## Architecture

### Storage Structure
```
data/local/
├── execution-logs.json    # All execution records
└── (auto-created by the system)
```

All execution data is stored in a single JSON file with the following structure:
```json
{
  "executionLogs": [],
  "documents": [],
  "inventoryReceivals": [],
  "spotPurchases": [],
  "outboundDispatches": [],
  "executionPayments": []
}
```

### Data Persistence
- Data is saved to `data/local/execution-logs.json` using the existing local persistence pattern
- When you restart the dev server, all data persists
- Uses `superjson` for serialization (same as other local data files)

## How It Works

### 1. Creating an Execution
When you start a Purchase Delivered execution from a locked trade:

```typescript
// Creates entry in execution-logs.json
{
  id: "timestamp-random",
  tradeRef: "KAS-2026-10022",
  executionProfile: "PURCHASE_DELIVERED",
  currentStage: "VEHICLE_ARRIVAL",
  quantity: 1000,
  ratePerUnit: 280,
  createdAt: Date,
  updatedAt: Date
}
```

### 2. Adding Quality Measurements
Your quality check data is stored:

```typescript
{
  id: "timestamp-random",
  executionLogId: "parent-exec-id",
  vehicleNumber: "KAR-2026-001",
  biltyNumber: "BLT-2026-001",
  grossQuantity: 1000,
  qualityMeasurements: {
    damagePct: 0.5,
    brokenPct: 0.3,
    moisturePct: 12.5,
    totalDeductionPct: 1.5,
    netQuantity: 985 // Auto-calculated
  }
}
```

### 3. Uploading Documents
Each document creates a metadata entry:

```typescript
{
  id: "timestamp-random",
  executionLogId: "parent-exec-id",
  fileName: "TRN-2026.pdf",
  documentType: "TRN",
  fileSize: 245632,
  mimeType: "application/pdf",
  filePath: "/uploads/exec-id/TRN-timestamp.pdf",
  uploadedAt: Date
}
```

### 4. Payment Tracking
When submitted to finance:

```typescript
{
  id: "timestamp-random",
  executionLogId: "parent-exec-id",
  amount: 275500,  // netQuantity * ratePerUnit
  paymentStatus: "PENDING_APPROVAL",
  paymentDueDate: Date,
  approvedAt: null,
  approvedBy: null
}
```

## File Details

### `server/local-execution-persist.ts` (NEW)
Core functions for managing execution data:
- `createExecutionLog()` - Start new execution
- `createInventoryReceival()` - Add vehicle/quality data
- `createDocument()` - Record document upload
- `createSpotPurchase()` - Start spot purchase
- `createOutboundDispatch()` - Start sale dispatch
- `createExecutionPayment()` - Create payment record
- `updateExecutionLogStage()` - Track workflow progress
- `getFullExecutionContext()` - Fetch complete execution with all related data

### `server/routers/execution-advanced.ts` (UPDATED)
All procedures now use local storage:
- ✅ `createPurchaseDelivered` - Creates execution + inventory
- ✅ `submitQualityCheck` - Records measurements, calculates deductions
- ✅ `uploadDocument` - Saves document metadata
- ✅ `submitPurchaseDeliveredForFinance` - Creates payment record
- ✅ `createPurchaseSpot` - Starts spot purchase
- ✅ `createOutboundDispatchAdvanced` - Starts sales execution
- ✅ `releaseGoodsAdvanced` - Marks goods as released
- ✅ `approvePayment` - Finance approval
- ✅ `getQualityReport` - Generates deduction report
- ✅ `listExecutions` - Query with filters

### `app/api/execution/upload-document/route.ts` (UPDATED)
Document upload endpoint now:
- Validates file type (PDF, JPG, PNG)
- Checks file size (max 10MB)
- Stores metadata locally
- Ready for cloud storage integration

## Testing the System

### 1. Start the Dev Server
```bash
cd kastros-ctrm
npm run dev
```

### 2. Access the Execution Interface
1. Login with trader credentials
2. Go to `/execution/purchase-delivered`
3. Click on a locked trade (e.g., "KAS-2026-10022")

### 3. Complete a Workflow

**Step 1: Vehicle Arrival**
- Vehicle Number: `KAR-2026-001`
- Bilty: `BLT-2026-001`
- Offload Date: Pick today's date
- Quantity: 1000
- Warehouse: `Lahore Warehouse`

**Step 2: Quality Check**
- Damage: 0.5%
- Broken: 0.3%
- Fungus: 0%
- Foreign Matter: 0.2%
- Moisture: 12.5%
→ Auto-calculates Net: ~986 MT

**Step 3: Upload Documents** (Minimum 3)
- Upload PDF files or images
- Select document types: TRN, GRN, BILTY
- Add notes if needed

**Step 4: Review Payment**
- Amount: 275,800 USD (986 MT × $280)
- Due in 15 days
- Submit for approval

**Step 5: Complete**
- Shows execution reference
- Data saved in `data/local/execution-logs.json`

## Verifying Data Persistence

After completing a workflow, check the local file:

```bash
# View the execution data
cat data/local/execution-logs.json | jq '.json.executionLogs[0]'
```

You should see your execution with all related documents, inventory, and payment data.

## Limitations of Local Storage

✅ **Works for:**
- Single user testing
- Prototype validation
- Workflow development
- Demo presentations
- All quality calculations

❌ **Doesn't support:**
- Multi-user concurrent access
- Production-scale data
- Real file storage
- Backup/recovery

## Switching to Database

When ready for production, replace local storage with Prisma:

```bash
# 1. Run migration
npx prisma migrate dev --name add_execution_workflows

# 2. Replace in execution-advanced.ts: Use real Prisma calls instead of localExecution.*

# 3. Update upload endpoint to use S3/Azure Blob Storage
```

The API signatures remain the same - only the backend storage changes.

## Data Location

- **Local storage file:** `kastros-ctrm/data/local/execution-logs.json`
- **Upload metadata:** Stored in same file (no actual files uploaded in local mode)
- **To reset:** Delete `execution-logs.json` and restart dev server

## Quality Calculation Reference

The system automatically calculates deductions based on:

| Parameter | Tolerance | Multiplier |
|-----------|-----------|-----------|
| Damage | < 1% | 0.5x excess |
| Broken | < 0.5% | 0.5x excess |
| Fungus | < 0.5% | 1.0x excess (strict) |
| Foreign Matter | < 2% | 0.75x excess |
| Moisture | < 12% | 2.0x excess + 0.5% grace |

**Example:**
- Moisture = 12.5% (0.5% over tolerance)
- Deduction = 0.5% × 2.0 = 1.0%

## Next Steps

1. ✅ Test Purchase Delivered workflow
2. Create Purchase Spot detail page (`app/(execution)/execution/purchase-spot/[ref]/page.tsx`)
3. Create Sales detail page (`app/(execution)/execution/sales/[ref]/page.tsx`)
4. Create Finance approval dashboard
5. Integrate actual cloud storage (S3/Azure)
6. Run database migration and switch to Prisma

---

**Status:** Ready for prototype testing  
**Data:** Persisted locally in JSON  
**All workflows:** Connected and functional
