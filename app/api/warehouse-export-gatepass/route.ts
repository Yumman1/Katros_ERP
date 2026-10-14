import {NextResponse} from 'next/server';
import {addExportContainers,exportGateInput} from '@/server/execution/sesame-export';
export async function POST(request:Request){
 try{const input=exportGateInput.parse(await request.json());const shipment=await addExportContainers(input);return NextResponse.json({ok:true,shipment});}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Could not save shipment'},{status:400});}
}
