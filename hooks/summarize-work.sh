#!/bin/bash
AGENT_ROLE="${AGENT_ROLE:-forge}"
WORK_DESC="${1:-$(git -C /workspace log --oneline -5 2>/dev/null || echo "Recent work in the Forge")}"

SUMMARY=$(claude -p --model claude-haiku-4-5-20251001 "Summarize this completed work in exactly 2 sentences. Be specific about what files or features changed: $WORK_DESC" 2>/dev/null)

if [ -n "$SUMMARY" ]; then
  node -e "
const {connect,JSONCodec}=require(\"nats\");const jc=JSONCodec();
function parseNatsUrl(raw){try{const u=new URL(raw);return{server:\"nats://\"+u.hostname+\":\"+(u.port||4222),user:u.username||undefined,pass:u.password||undefined};}catch{return{server:raw};}}
const {server,user:URL_USER,pass:URL_PASS}=parseNatsUrl(process.env.NATS_URL||\"nats://localhost:4222\");
const user=process.env.NATS_USER||URL_USER||\"kingdom\";
const pass=process.env.NATS_PASSWORD||URL_PASS||\"\";
(async()=>{
  const nc=await connect({servers:server,user,pass});
  nc.publish(\"raven.ledger.forge\",jc.encode({agent:\"forge\",summary:process.env.SUMMARY,timestamp:new Date().toISOString()}));
  await nc.drain();
})().catch(e=>console.error(e.message));
  " 2>/dev/null && echo "Published to ledger" || echo "NATS publish failed"
fi
