import type {Prisma} from '@prisma/client';
export async function processingReservedKg(db:Prisma.TransactionClient, code:string, warehouse?:string, grade?:string) {
 const result=await db.sesameProcessingPlan.aggregate({where:{commodityCode:code,status:'ACTIVE',...(warehouse?{warehouseName:{equals:warehouse,mode:'insensitive' as const}}:{}),...(grade?{fromType:grade}:{})},_sum:{remainingKg:true}});
 return Number(result._sum.remainingKg??0);
}
