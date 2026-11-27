import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("Nuvem Seven hides infrastructure details and external authorization is separate",()=>{
 const panel=read("src/components/CloudPanel.tsx");
 assert.match(panel,/Nuvem Seven/);
 assert.doesNotMatch(panel,/Sincronização Neon|VITE_NEON_|conta Neon|ao Neon/);
 const external=read("src/components/ExternalStoragePanel.tsx");
 for(const provider of ["Google Drive","OneDrive","TeraBox"])assert.ok(external.includes(provider));
 assert.match(external,/Conectar TeraBox/);
 assert.match(external,/não ativa backup nem envia e-mails automaticamente/);
 const native=read("src-tauri/src/cloud_storage.rs");
 assert.match(native,/external-storage/);
 assert.match(native,/drive\.appdata/);
 assert.match(native,/Files\.ReadWrite\.AppFolder/);
 assert.match(native,/code_challenge_method/);
 assert.match(native,/credentials::store_scoped/);
 assert.doesNotMatch(native,/list_cached_messages|pushCloud|flush_outbox/);
});

test("storage connections use aligned tiles and locally bundled provider logos",()=>{
 const ui=read("src/components/ExternalStoragePanel.tsx");
 const css=read("src/styles.css");
 assert.match(ui,/seven-storage-grid/);
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 for(const logo of ["google-drive.png","onedrive.svg","terabox.ico"])assert.ok(ui.includes("/providers/"+logo));
 assert.doesNotMatch(ui,/src=["']https?:/);
});
