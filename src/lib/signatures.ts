import type { SignatureItem } from "../types";
export const MAX_SIGNATURE_IMAGE_BYTES=512*1024;
export const MAX_SIGNATURE_HTML=2*1024*1024;
const tags=new Set("a b strong i em u s strike span div p br hr table tbody thead tfoot tr td th ul ol li font img".split(" "));
const styles="color background-color font-family font-size font-weight font-style text-decoration text-align vertical-align line-height width height max-width border border-top border-bottom border-left border-right border-color border-style border-width border-collapse padding padding-top padding-right padding-bottom padding-left margin margin-top margin-right margin-bottom margin-left".split(" ");
export function safeSignatureUrl(raw:string,image=false):string|null {
  if(image&&/^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(raw)&&raw.length<=Math.ceil(MAX_SIGNATURE_IMAGE_BYTES/3)*4+40)return raw;
  try{
    const url=new URL(raw.trim());
    if(url.username||url.password)return null;
    if(url.protocol==="https:"||(!image&&["http:","mailto:","tel:"].includes(url.protocol)))return url.href;
  }catch{/* invalid URL */}
  return null;
}
export function signatureTextHtml(value:string):string{
  return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/\r\n?|\n/g,"<br>");
}
export function sanitizeSignatureHtml(raw:string):string{
  if(raw.length>MAX_SIGNATURE_HTML)throw new Error("Assinatura muito grande. Reduza o tamanho das imagens.");
  const template=document.createElement("template");template.innerHTML=raw;
  const target=document.createElement("div");
  function append(node:Node,parent:HTMLElement){
    if(node.nodeType===Node.TEXT_NODE){parent.appendChild(document.createTextNode(node.textContent??""));return;}
    if(!(node instanceof HTMLElement))return;
    const tag=node.tagName.toLowerCase();
    if(["script","style","iframe","object","embed","form","template","head","meta","link","input","button"].includes(tag))return;
    if(!tags.has(tag)){Array.from(node.childNodes).forEach(child=>append(child,parent));return;}
    const clean=document.createElement(tag);
    for(const prop of styles){
      const value=node.style.getPropertyValue(prop);
      if(value&&!/url\s*\(|expression\s*\(|@import|var\s*\(|[\\]/i.test(value))clean.style.setProperty(prop,value);
    }
    if(tag==="a"){const href=safeSignatureUrl(node.getAttribute("href")??"");if(href)clean.setAttribute("href",href);}
    if(tag==="img"){const src=safeSignatureUrl(node.getAttribute("src")??"",true);if(!src)return;clean.setAttribute("src",src);clean.setAttribute("alt",(node.getAttribute("alt")??"").slice(0,300));clean.setAttribute("referrerpolicy","no-referrer");}
    for(const attr of ["width","height","colspan","rowspan","cellpadding","cellspacing","border"]){const v=node.getAttribute(attr);if(v&&/^\d{1,4}%?$/.test(v))clean.setAttribute(attr,v);}
    if(tag==="font"){for(const attr of ["face","color","size"]){const v=node.getAttribute(attr);if(v&&/^[\w\s,#.\-]{1,100}$/.test(v))clean.setAttribute(attr,v);}}
    Array.from(node.childNodes).forEach(child=>append(child,clean));parent.appendChild(clean);
  }
  Array.from(template.content.childNodes).forEach(node=>append(node,target));return target.innerHTML;
}
export function signatureHtml(signature?:Pick<SignatureItem,"bodyText"|"bodyHtml">):string{
  if(!signature)return "";
  try{return sanitizeSignatureHtml(signature.bodyHtml||"")||signatureTextHtml(signature.bodyText||"");}catch{return signatureTextHtml(signature.bodyText||"");}
}
export function defaultSignature(items:readonly SignatureItem[],accountId:string,reply=false):SignatureItem|undefined{
  return items.find(item=>item.accountId===accountId&&(reply?(item.isReplyDefault??item.isDefault):item.isDefault));
}
