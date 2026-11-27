import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
const dir=new URL("../docs/",import.meta.url);
const read=(name:string)=>readFileSync(new URL(name,dir),"utf8");
test("public Seven Mail pages have local navigation, branding and canonical URLs",()=>{
 for(const page of ["index.html","privacy.html","terms.html"]){
  const html=read(page);
  assert.match(html,/<html lang="pt-BR">/);
  assert.match(html,/<title>[^<]+Seven Mail<\/title>/);
  assert.match(html,/rel="canonical" href="https:\/\/gabriell211\.github\.io\/Seven-Mail\//);
  assert.match(html,/href="privacy\.html"/);
  assert.match(html,/href="terms\.html"/);
  assert.match(html,/href="mailto:suporte\.santaprint@gmail\.com"/);
  assert.doesNotMatch(html,/<script\b|<iframe\b|<form\b/i);
  for(const match of html.matchAll(/(?:href|src)="([^"]+)"/g)){
    const target=match[1];
    if(/^(?:https?:|mailto:|#)/.test(target)||target==="./")continue;
    assert.ok(existsSync(new URL(target,dir)),target);
  }
 }
 assert.match(read("index.html"),/Seven-Mail\/releases\/latest/);
 const policy=read("privacy.html");
 for(const phrase of ["Uso Limitado","Limited Use","drive.appdata","generative-language.retriever","texto e HTML integrais","myaccount.google.com/connections","exclusão","Nuvem Seven"])assert.ok(policy.includes(phrase),phrase);
 const logo=readFileSync(new URL("seven-mail-logo.png",dir));
 assert.equal(logo.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
});