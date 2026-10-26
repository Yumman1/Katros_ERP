"use client";
import {FzcoDirectEntry} from '@/components/execution/fzco-direct-entry';
import {useExecutionCommodityDesk} from '@/components/execution/commodity-desk-provider';
import {usesSesameWorkflow} from '@/lib/sesame';
export default function Page(){const {entity,active}=useExecutionCommodityDesk();return <div className="kastros-desk-page">{entity==='FZCO'&&usesSesameWorkflow(active.code)?<FzcoDirectEntry/>:<p>Open the Sesame FZCO desk to record third-party movements.</p>}</div>;}
