import test from "node:test";
import assert from "node:assert/strict";
import { defaultSignature,safeSignatureUrl,signatureTextHtml } from "../src/lib/signatures.ts";
const sig={id:"1",accountId:"a",name:"Work",bodyText:"Name",bodyHtml:"<b>Name</b>",isDefault:true,isReplyDefault:false};
test("signature defaults are independent and scoped to account",()=>{
 assert.equal(defaultSignature([sig],"a"),sig);
 assert.equal(defaultSignature([sig],"a",true),undefined);
 assert.equal(defaultSignature([sig],"b"),undefined);
 assert.equal(defaultSignature([{...sig,isReplyDefault:undefined}],"a",true)?.id,"1");
});
test("signature links and raster images reject executable schemes",()=>{
 assert.equal(safeSignatureUrl("javascript:alert(1)"),null);
 assert.equal(safeSignatureUrl("data:image/svg+xml;base64,AAAA",true),null);
 assert.equal(safeSignatureUrl("file:///private/logo.png",true),null);
 assert.equal(safeSignatureUrl("data:image/png;base64,AAAA",true),"data:image/png;base64,AAAA");
 assert.equal(signatureTextHtml("<name>\n&"),"&lt;name&gt;<br>&amp;");
});
