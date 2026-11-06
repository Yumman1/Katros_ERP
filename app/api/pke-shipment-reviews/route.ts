import {NextResponse} from 'next/server';
import {getServerSession} from 'next-auth';
import {authOptions} from '@/lib/auth';
import {prisma} from '@/server/db';
import {registerInsurer,reviewShipment,shipmentReviews} from '@/server/execution/pke-shipment-review';
import {z} from 'zod';
export const dynamic='force-dynamic';
async function actor(){const s=await getServerSession(authOptions);if(!s?.user?.id)throw new Error('Sign in');const u=await prisma.user.findUniqueOrThrow({where:{id:s.user.id}});if(u.disabled||!['EXECUTION','TRADER','CEO','FINANCE'].includes(u.role))throw new Error('Access denied');return u;}
export async function GET(){try{const u=await actor();return NextResponse.json({files:await shipmentReviews(u),insurers:await prisma.counterparty.findMany({where:{code:{startsWith:'INS-'}},select:{id:true,name:true}})});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Failed'},{status:400});}}
export async function POST(req:Request){try{const u=await actor(),b=await req.json();if(b.action==='register-insurer'){if(!['EXECUTION','CEO'].includes(u.role))throw new Error('Access denied');return NextResponse.json(await registerInsurer(z.string().trim().min(1).max(160).parse(b.name),u));}return NextResponse.json(await reviewShipment(z.object({id:z.string().min(1),action:z.enum(['INSURANCE','SHORTFALL','APPROVED','REJECTED','CANCELLED']),reviewId:z.string().optional(),insurerId:z.string().optional(),reason:z.string().trim().min(1).max(2000)}).parse(b),u));}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Failed'},{status:400});}}
