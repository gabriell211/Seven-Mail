import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/gemini.rs",import.meta.url),"utf8");
const panel=readFileSync(new URL("../src/components/GeminiPanel.tsx",import.meta.url),"utf8");
test("Gemini uses native HTTPS, scoped vault and no external runtime or mutation tools",()=>{
 assert.match(rust,/generativelanguage\.googleapis\.com/);
 assert.match(rust,/header\("x-goog-api-key",self.api_key.as_str\(\)\)/);
 assert.match(rust,/credentials::store_scoped/);
 assert.match(rust,/Policy::none/);
 assert.doesNotMatch(rust,/Command::new|node_modules|queue_operation|message_action|delete_workspace|flush_outbox/);
 assert.equal(existsSync(new URL("../copilot-runtime",import.meta.url)),false);
});
test("read-only session is automatic and one-time draft approval remains mandatory",()=>{
 assert.match(rust,/require_scope\(&token,&account_id\)\?/);
 assert.match(rust,/messages.retain\(\|m\|m.account_id==account_id\)/);
 assert.match(rust,/access.proposal.take\(\)/);
 assert.match(panel,/gemini_open_read_session/);
 assert.doesNotMatch(panel,/Autorizar leitura|setConsent|30 minutos/);
 assert.doesNotMatch(rust,/CONSENT_TTL/);
 assert.match(panel,/window.confirm/);
 assert.match(panel,/gemini_approve_draft/);
 assert.doesNotMatch(panel,/GitHub|Copilot|Node\.js/i);
});

test("native Gemini streaming is scoped and never creates partial drafts",()=>{
 assert.match(rust,/streamGenerateContent\?alt=sse/);
 assert.match(rust,/tauri::ipc::Channel<String>/);
 assert.match(rust,/!stopped/);
 assert.match(panel,/new Channel<string>/);
 assert.match(panel,/onDelta\.onmessage/);
 assert.match(panel,/Parar geração/);
 assert.ok(rust.indexOf("let answer=invoke_gemini")<rust.indexOf("access.proposal=Some"));
});

test("model is persisted in the native vault and can be changed without reentering the key",()=>{
 assert.match(rust,/struct GeminiConfig/);
 assert.match(rust,/fn decode_config/);
 assert.match(rust,/fn save_config/);
 assert.match(rust,/pub async fn gemini_set_model\(model:String\)/);
 assert.match(rust,/validate_config_model\(&config,model\)/);
 assert.match(rust,/let config=active_config\(\)\?/);
 assert.match(rust,/config.apply\(client.post/);
 assert.match(panel,/gemini_set_model/);
 assert.match(panel,/gemini_list_models/);
 assert.match(panel,/selectedModel/);
 assert.doesNotMatch(panel,/draftReply:replyMode,model:/);
});

test("explicit multimodal attachment input is bounded and does not automatically send mail",()=>{
 assert.match(rust,/struct MediaInput/);
 assert.match(rust,/fn valid_media_signature/);
 assert.match(rust,/STANDARD.decode/);
 assert.match(rust,/MAX_MEDIA_BYTES/);
 assert.match(rust,/inlineData/);
 assert.match(rust,/if include_mail\{storage::list_cached_messages/);
 assert.match(panel,/type="file"/);
 assert.match(panel,/onPaste=/);
 assert.match(panel,/if\(!files.length\)changeContext\(false\)/);
 assert.match(panel,/files:payloadFiles/);
 assert.match(panel,/URL.revokeObjectURL/);
});

test("live API smoke tests are opt-in and share the production transport",()=>{
 assert.match(rust,/generate_stream\(config,prompt,files,on_delta,check_active\)/);
 assert.match(rust,/SEVEN_MAIL_GEMINI_TEST_API_KEY/);
 for(const name of ["live_text_and_stream","live_image_and_stream","live_pdf_and_stream"])assert.match(rust,new RegExp(`fn ${name}\\(`));
});

test("Google OAuth is separate from email authorization and uses a native loopback flow",()=>{
 const oauth=readFileSync(new URL("../src-tauri/src/gemini_google.rs",import.meta.url),"utf8");
 assert.match(oauth,/code_challenge_method/);
 assert.match(oauth,/127\.0\.0\.1/);
 assert.match(oauth,/login_hint/);
 assert.match(oauth,/x-goog-user-project/);
 assert.match(oauth,/email_verified/);
 assert.match(rust,/gemini_google_connect/);
 assert.match(panel,/Entrar com Google/);
 assert.doesNotMatch(oauth,/oauth::access_token|mail.google.com\/.*scope/);
});


test("Gemini settings are closed by default and accessed beside new conversation",()=>{
 assert.match(panel,/\[settingsOpen,setSettingsOpen\]=useState\(false\)/);
 assert.match(panel,/aria-label="Nova conversa"[^]*?aria-label="Configurações do Gemini"[^]*?aria-label="Fechar Gemini"/);
 assert.match(panel,/aria-expanded=\{settingsOpen\}/);
 assert.match(panel,/settingsOpen\|\|!configured\?<section className="gemini-setup"/);
 assert.match(panel,/Chave da API<input type="password"/);
 assert.match(panel,/\{configured&&!loadingConfig&&!settingsOpen&&<footer>/);
 assert.doesNotMatch(panel,/<details className="gemini-setup"/);
 assert.match(panel,/if\(busy\)return;\s*setApiKey\(""\);setGoogleClientSecret\(""\)/);
 assert.match(panel,/settingsTitle\.current\?\.focus\(\)/);
 assert.match(panel,/e\.key==="Escape"&&settingsOpen&&!busy/);
});


test("conversation hides configuration and context filters while retaining explicit read-only and approval controls",()=>{
 const settings=panel.slice(panel.indexOf('settingsOpen||!configured?<section'),panel.indexOf('</section>:<>'));
 const conversation=panel.slice(panel.indexOf('</section>:<>'));
 for(const label of ["Conta de e-mail","Buscar e-mail no cache","Chave da API","Preparar resposta para aprovação"]) {
  assert.ok(settings.includes(label),label);
  assert.ok(!conversation.includes(label),label);
 }
 assert.match(conversation,/somente leitura/);
 assert.match(conversation,/Autorização necessária/);
 assert.match(conversation,/gemini-empty-conversation/);
 assert.match(conversation,/Anexar arquivo/);
});


test("compact Gemini composer provides separate image and document pickers",()=>{
 const composer=panel.slice(panel.indexOf('{configured&&!loadingConfig&&!settingsOpen&&<footer>'));
 assert.match(composer,/className="gemini-composer"/);
 assert.match(composer,/ref=\{fileInput\} accept=\{fileAccept\}/);
 assert.match(composer,/ref=\{imageInput\} accept=\{imageAccept\}/);
 assert.match(panel,/const imageAccept="\.png,\.jpg,\.jpeg,\.webp"/);
 assert.match(composer,/images\.some\(file=>!fileMime\(file\)\?\.startsWith\("image\/"\)\)/);
 assert.match(composer,/aria-label="Anexar arquivo"[^]*?aria-label="Anexar imagem"[^]*?aria-label="Enviar pergunta"/);
 assert.match(composer,/name="paperclip"/);
 assert.match(composer,/name="image"/);
 assert.match(composer,/name="arrow-up"/);
 assert.match(composer,/onClick=\{stop\}/);
 assert.match(composer,/!e\.nativeEvent\.isComposing/);
 assert.match(composer,/addFiles\(images\)/);
 assert.match(composer,/files\.length>=MAX_FILES/);
 const css=readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
 assert.match(css,/\.gemini-composer-toolbar \.gemini-composer-send\{[^}]*border-radius:50%/);
});


test("Gemini authentication gates conversation and token ring uses bounded provider usage",()=>{
 assert.match(panel,/setSettingsOpen\(!value.configured\)/);
 assert.match(panel,/configured&&!loadingConfig&&!settingsOpen&&<footer>/);
 assert.match(panel,/src="\/providers\/gemini.svg"/);
 assert.match(panel,/gemini-token-ring/);
 assert.match(panel,/Estimativa pelo texto visível/);
 assert.match(panel,/answer\?\.outputTokens/);
 assert.match(rust,/const MAX_OUTPUT_TOKENS: u32 = 8192/);
 assert.match(rust,/metadata.get\("candidatesTokenCount"\)/);
 assert.match(rust,/metadata.get\("thoughtsTokenCount"\)/);
 assert.match(rust,/output_tokens,output_token_limit:MAX_OUTPUT_TOKENS/);
 assert.ok(existsSync(new URL("../public/providers/gemini.svg",import.meta.url)));
});


test("creative modes use explicit selection and scoped native transport",()=>{
 const creative=readFileSync(new URL("../src/components/GeminiCreative.tsx",import.meta.url),"utf8");
 assert.ok(rust.includes("pub async fn gemini_create"));
 assert.ok(rust.includes("gemini-3.1-flash-image"));
 assert.ok(rust.includes("responseModalities"));
 assert.ok(panel.includes('invoke<CreativeResult>("gemini_create"'));
 assert.ok(creative.includes("sanitizeSignatureHtml(html)"));
 assert.ok(creative.includes("window.confirm"));
 assert.ok(creative.includes("isDefault:false,isReplyDefault:false"));
 assert.ok(creative.includes("GeminiMarkdown"));
});


test("creative exports require an explicit file picker and validate native raster writes",()=>{
 const creative=readFileSync(new URL("../src/components/GeminiCreative.tsx",import.meta.url),"utf8");
 assert.ok(creative.includes("await saveDialog("));
 assert.ok(creative.includes('invoke("gemini_save_image"'));
 assert.ok(rust.includes("create_new(true)"));
 assert.ok(rust.includes("destination.is_absolute()"));
 assert.ok(creative.includes("Salvar documento (.md)"));
});
