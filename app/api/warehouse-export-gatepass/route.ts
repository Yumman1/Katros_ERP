import {NextResponse} from 'next/server';
import {logExportGate,intakeInput} from '@/server/execution/export-gate-intake';
export async function POST(request:Request){
 try{const input=intakeInput.parse(await request.json());const intake=await logExportGate(input);return NextResponse.json({ok:true,intake});}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Could not log containers'},{status:400});}
}
