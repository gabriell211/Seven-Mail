import { useEffect,useRef,useState } from "react";
import { Icon } from "../icons";
import { MAX_SIGNATURE_IMAGE_BYTES,MAX_SIGNATURE_HTML,sanitizeSignatureHtml,safeSignatureUrl,signatureTextHtml } from "../lib/signatures";

export function SignatureEditor({initialHtml,initialText,onChange}:{initialHtml:string;initialText:string;onChange:(html:string,text:string)=>void}){
  const editor=useRef<HTMLDivElement>(null);
  const imageInput=useRef<HTMLInputElement>(null);
  const htmlInput=useRef<HTMLInputElement>(null);
  const selection=useRef<Range|null>(null);
  const initial=useRef({html:initialHtml,text:initialText});
  const [notice,setNotice]=useState("");
  const [preview,setPreview]=useState(false);
  const [html,setHtml]=useState("");
  useEffect(()=>{try{const value=sanitizeSignatureHtml(initial.current.html)||signatureTextHtml(initial.current.text);if(editor.current)editor.current.innerHTML=value;setHtml(value);}catch(error){setNotice(String(error));}},[]);
  function remember(){const range=window.getSelection();if(range?.rangeCount&&editor.current?.contains(range.anchorNode))selection.current=range.getRangeAt(0).cloneRange();}
  function restore(){const node=editor.current;if(!node)return;node.focus();const current=window.getSelection();if(current&&selection.current&&node.contains(selection.current.commonAncestorContainer)){current.removeAllRanges();current.addRange(selection.current);}}
  function sync(){const node=editor.current;if(!node)return;try{const clean=sanitizeSignatureHtml(node.innerHTML);setHtml(clean);onChange(clean,node.innerText.trim());setNotice("");}catch(error){setNotice(String(error));}}
  function format(command:string,value?:string){restore();document.execCommand(command,false,value);remember();sync();}
  function insert(raw:string){try{const clean=sanitizeSignatureHtml(raw);if((editor.current?.innerHTML.length??0)+clean.length>MAX_SIGNATURE_HTML)throw new Error("Assinatura muito grande.");format("insertHTML",clean);}catch(error){setNotice(String(error));}}
  async function addImage(file:File){
    try{
      if(!["image/png","image/jpeg","image/gif"].includes(file.type)||file.size>MAX_SIGNATURE_IMAGE_BYTES)throw new Error("Escolha PNG, JPEG ou GIF de até 512 KB.");
      const url=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Não foi possível ler a imagem."));reader.readAsDataURL(file);});
      const img=document.createElement("img");img.src=url;img.alt=file.name;img.style.maxWidth="100%";img.style.height="auto";img.width=180;insert(img.outerHTML);
    }catch(error){setNotice(String(error));}
  }
  async function importHtml(file:File){try{if(file.size>MAX_SIGNATURE_HTML)throw new Error("Arquivo HTML muito grande.");insert(await file.text());}catch(error){setNotice(String(error));}}
  return <div className="full signature-rich-field">
    <span className="signature-field-label">Editar assinatura</span>
    <div className="signature-toolbar" role="toolbar" aria-label="Formatação da assinatura">
      <select aria-label="Fonte" defaultValue="Arial" onChange={e=>format("fontName",e.target.value)}>{["Arial","Calibri","Segoe UI","Verdana","Tahoma","Georgia","Times New Roman"].map(font=><option key={font}>{font}</option>)}</select>
      <select aria-label="Tamanho da fonte" defaultValue="3" onChange={e=>format("fontSize",e.target.value)}>{[[1,8],[2,10],[3,12],[4,14],[5,18],[6,24],[7,36]].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select>
      {([["bold","B","Negrito"],["italic","I","Itálico"],["underline","U","Sublinhado"],["justifyLeft","≡","Alinhar à esquerda"],["justifyCenter","≡","Centralizar"],["insertUnorderedList","•","Marcadores"],["removeFormat","Tx","Limpar formatação"]] as const).map(([cmd,label,title])=><button key={cmd} type="button" title={title} aria-label={title} onMouseDown={e=>e.preventDefault()} onClick={()=>format(cmd)}>{label}</button>)}
      <input type="color" aria-label="Cor da fonte" title="Cor da fonte" defaultValue="#222222" onChange={e=>format("foreColor",e.target.value)}/>
      <button type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>{const url=window.prompt("Endereço do link (https://, mailto: ou tel:)");const safe=url&&safeSignatureUrl(url);if(safe)format("createLink",safe);}}><Icon name="paperclip" size={15}/> Link</button>
      <button type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>imageInput.current?.click()}><Icon name="upload" size={15}/> Imagem</button>
      <button type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>htmlInput.current?.click()}>Importar HTML</button>
      <button type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>insert("<table><tbody><tr><td>Nome</td><td>Empresa</td></tr></tbody></table>")}>Tabela</button>
      <input hidden type="file" ref={imageInput} accept="image/png,image/jpeg,image/gif" onChange={e=>{const file=e.target.files?.[0];if(file)void addImage(file);e.target.value="";}}/>
      <input hidden type="file" ref={htmlInput} accept=".html,.htm,text/html" onChange={e=>{const file=e.target.files?.[0];if(file)void importHtml(file);e.target.value="";}}/>
    </div>
    <div className="signature-rich-editor" ref={editor} contentEditable suppressContentEditableWarning role="textbox" aria-label="Conteúdo da assinatura" aria-multiline="true" data-placeholder="Digite ou cole sua assinatura aqui..." onInput={sync} onBlur={remember} onKeyUp={remember} onMouseUp={remember}
      onPaste={e=>{e.preventDefault();remember();const file=Array.from(e.clipboardData.files).find(item=>item.type.startsWith("image/"));const pasted=e.clipboardData.getData("text/html");if(file)void addImage(file);else if(pasted)insert(pasted);else insert(signatureTextHtml(e.clipboardData.getData("text/plain")));}}
      onDrop={e=>{e.preventDefault();const file=Array.from(e.dataTransfer.files).find(item=>item.type.startsWith("image/"));if(file)void addImage(file);}}
      onClick={e=>{if(e.target instanceof HTMLElement&&e.target.closest("a"))e.preventDefault();if(e.target instanceof HTMLImageElement){const size=window.prompt("Largura da imagem em pixels (40–600)",String(e.target.width||180));if(size&&/^\d+$/.test(size)&&Number(size)>=40&&Number(size)<=600){e.target.width=Number(size);e.target.style.height="auto";sync();}}}}/>
    <div className="signature-editor-footer"><small>PNG, JPEG ou GIF até 512 KB. Clique na imagem para ajustar a largura.</small><button type="button" className="secondary" aria-expanded={preview} onClick={()=>setPreview(value=>!value)}>Prévia</button></div>
    {notice&&<p role="alert" className="signature-notice">{notice}</p>}
    {preview&&<div className="signature-preview" aria-label="Prévia da assinatura" onClick={e=>e.preventDefault()} dangerouslySetInnerHTML={{__html:html}}/>}
  </div>;
}
