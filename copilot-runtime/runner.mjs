// Official Copilot SDK v2, optional runtime installed by the user.
import { readFileSync } from "node:fs";
import { CopilotClient, RuntimeConnection } from "@microsoft/copilot-sdk";
process.env.COPILOT_TELEMETRY_DISABLED="true";
const request=JSON.parse(readFileSync(0,"utf8"));
const client=new CopilotClient({
  mode:"empty",
  runtime:RuntimeConnection.forInProcess(),
  github:{useLoggedInUser:true},
  observability:{logLevel:"none"},
});
let session;
let result;
try{
  await client.start();
  session=await client.createSession({
    tools:{availableTools:[]},
    permissions:{mode:"manual",onRequest:async()=>({kind:"reject"})},
    skills:{enabled:false},
    state:{infiniteSessions:{enabled:false},enableCrossSessionStore:false,memory:{enabled:false}},
    github:{telemetryEnabled:false},
  });
  const reply=await session.sendAndWait({prompt:request.prompt},90000);
  const answer=reply?.data?.content;
  if(typeof answer!=="string"||!answer.trim())throw new Error("empty");
  result={answer:answer.slice(0,24000)};
}catch{
  result={error:"Não foi possível obter resposta do Copilot. Verifique a autenticação e a assinatura GitHub."};
}finally{
  if(session){
    const id=session.sessionId;
    await session.disconnect().catch(()=>{});
    await client.deleteSession(id).catch(()=>{});
  }
  await client.stop().catch(()=>{});
}
process.stdout.write(JSON.stringify(result));
