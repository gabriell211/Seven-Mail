use aes_gcm::{aead::{Aead, KeyInit, OsRng, rand_core::RngCore}, Aes256Gcm, Nonce};
use seven_mail_sqlite_store::{legacy::{migrate_snapshot, create_snapshot, migrate_completed_snapshot}, Store};
use std::{fs, path::{Path,PathBuf}, sync::atomic::{AtomicU64,Ordering}};
static NEXT: AtomicU64=AtomicU64::new(0);
const MAGIC:&[u8]=b"SEVENMAIL-ENC-1\0";
const LEGACY_KEY:[u8;32]=[33;32];
struct Temp(PathBuf);
impl Temp {
    fn new()->Self {
        let dir=std::env::temp_dir().join(format!("seven-mail-migration-{}-{}",std::process::id(),NEXT.fetch_add(1,Ordering::Relaxed)));
        fs::create_dir(&dir).unwrap();
        fs::create_dir(dir.join("messages")).unwrap();
        Self(dir)
    }
    fn source(&self)->PathBuf {self.0.join("messages")}
    fn store(&self)->Store {Store::open(&self.0.join("staging.db"),&[44;32]).unwrap()}
}
impl Drop for Temp {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
fn payload(account:&str,id:&str)->Vec<u8>{
    serde_json::to_vec(&serde_json::json!({
        "id":id,"accountId":account,"folder":"INBOX","subject":"Relatório",
        "preview":"Resumo","from":{"email":"a@example.org"},"to":[{"email":"b@example.org"}],
        "receivedAt":"2026-11-24T08:00:00-03:00","isRead":false,"isFlagged":true,
        "isPinned":false,"hasAttachments":true,"bodyText":"conteúdo confidencial",
        "bodyHtml":"<p>conteúdo</p>","categories":["financeiro"],
        "remoteId":"42","remoteFolder":"INBOX","attachmentNames":["report.pdf"],
        "futureField":{"uidValidity":123}
    })).unwrap()
}
fn envelope(plain:&[u8])->Vec<u8>{
    let cipher=Aes256Gcm::new_from_slice(&LEGACY_KEY).unwrap();
    let mut nonce=[0;12];OsRng.fill_bytes(&mut nonce);
    let mut bytes=MAGIC.to_vec();bytes.extend_from_slice(&nonce);
    bytes.extend(cipher.encrypt(Nonce::from_slice(&nonce),plain).unwrap());bytes
}
fn decrypt(bytes:&[u8])->Result<Vec<u8>,String>{
    let cipher=Aes256Gcm::new_from_slice(&LEGACY_KEY).unwrap();
    let start=MAGIC.len();
    cipher.decrypt(Nonce::from_slice(&bytes[start..start+12]),&bytes[start+12..])
        .map_err(|_|"Falha de autenticação".into())
}
fn write_fixture(root:&Path,account:&str,id:&str,plain:&[u8])->PathBuf{
    let directory=root.join(account);fs::create_dir_all(&directory).unwrap();
    let path=directory.join(format!("{id}.json"));fs::write(&path,envelope(plain)).unwrap();path
}
#[test]
fn preserves_original_metadata_and_source_with_idempotent_import(){
    let t=Temp::new();let mut db=t.store();
    let plain=payload("account-a","message-1");
    let path=write_fixture(&t.source(),"account-a","message-1",&plain);
    write_fixture(&t.source(),"account-b","message-1",&payload("account-b","message-1"));
    fs::create_dir(t.source().join("account-a/_raw")).unwrap();
    let before=fs::read(&path).unwrap();
    let report=migrate_snapshot(&mut db,&t.source(),decrypt).unwrap();
    assert_eq!((report.messages,report.accounts),(2,2));
    assert_eq!(report.source_fingerprint.len(),64);
    assert_eq!(db.get("account-a","message-1").unwrap().unwrap().payload.as_bytes(),plain);
    assert_eq!(db.search("account-a","relatorio",20).unwrap(),vec!["message-1"]);
    assert_eq!(migrate_snapshot(&mut db,&t.source(),decrypt).unwrap(),report);
    assert_eq!(fs::read(path).unwrap(),before);
    db.verify().unwrap();
}
#[test]
fn rejects_mismatched_identity_and_rolls_back_all_records(){
    let t=Temp::new();let mut db=t.store();
    write_fixture(&t.source(),"a","1",&payload("a","1"));
    write_fixture(&t.source(),"a","2",&payload("other","2"));
    assert!(migrate_snapshot(&mut db,&t.source(),decrypt).is_err());
    assert!(db.get("a","1").unwrap().is_none());
}
#[test]
fn rejects_plaintext_and_tampered_ciphertext(){
    let t=Temp::new();let mut db=t.store();
    let path=write_fixture(&t.source(),"a","1",&payload("a","1"));
    let mut bytes=fs::read(&path).unwrap();let last=bytes.len()-1;bytes[last]^=1;fs::write(&path,bytes).unwrap();
    assert!(migrate_snapshot(&mut db,&t.source(),decrypt).is_err());
    fs::write(&path,payload("a","1")).unwrap();
    assert!(migrate_snapshot(&mut db,&t.source(),decrypt).is_err());
    assert!(db.get("a","1").unwrap().is_none());
}
#[test]
fn source_drift_aborts_transaction(){
    let t=Temp::new();let mut db=t.store();
    let path=write_fixture(&t.source(),"a","1",&payload("a","1"));
    let result=migrate_snapshot(&mut db,&t.source(),|bytes|{
        let plain=decrypt(bytes)?;
        fs::write(&path,envelope(&plain)).unwrap();
        Ok(plain)
    });
    assert!(result.is_err());assert!(db.get("a","1").unwrap().is_none());
}
#[test]
fn rejects_destination_with_extra_records(){
    let t=Temp::new();let mut db=t.store();
    let path=write_fixture(&t.source(),"a","1",&payload("a","1"));
    migrate_snapshot(&mut db,&t.source(),decrypt).unwrap();
    fs::remove_file(path).unwrap();
    write_fixture(&t.source(),"a","2",&payload("a","2"));
    assert!(migrate_snapshot(&mut db,&t.source(),decrypt).is_err());
    assert!(db.get("a","1").unwrap().is_some());
    assert!(db.get("a","2").unwrap().is_none());
}
#[cfg(unix)]
#[test]
fn rejects_symlinks(){
    let t=Temp::new();let mut db=t.store();
    let path=write_fixture(&t.source(),"a","1",&payload("a","1"));
    std::os::unix::fs::symlink(&path,t.source().join("a/2.json")).unwrap();
    assert!(migrate_snapshot(&mut db,&t.source(),decrypt).is_err());
    assert!(db.get("a","1").unwrap().is_none());
}

#[test]
fn copies_encrypted_snapshot_without_touching_original_and_requires_completion(){
    let t=Temp::new();let mut db=t.store();
    let original=write_fixture(&t.source(),"a","1",&payload("a","1"));
    let before=fs::read(&original).unwrap();
    let destination=t.0.join("backup");
    let report=create_snapshot(&t.source(),&destination).unwrap();
    assert_eq!(report.messages,1);
    assert_eq!(fs::read(destination.join("messages/a/1.json")).unwrap(),before);
    assert_eq!(fs::read(&original).unwrap(),before);
    assert!(create_snapshot(&t.source(),&destination).is_err());
    assert_eq!(migrate_completed_snapshot(&mut db,&destination,decrypt).unwrap(),report);
}
#[test]
fn rejects_incomplete_and_modified_snapshot_without_committing(){
    let t=Temp::new();let mut db=t.store();
    write_fixture(&t.source(),"a","1",&payload("a","1"));
    let destination=t.0.join("backup");
    create_snapshot(&t.source(),&destination).unwrap();
    let marker=destination.join("snapshot.complete.json");
    let bytes=fs::read(&marker).unwrap();
    fs::remove_file(&marker).unwrap();
    assert!(migrate_completed_snapshot(&mut db,&destination,decrypt).is_err());
    fs::write(&marker,bytes).unwrap();
    fs::write(destination.join("messages/a/1.json"),envelope(&payload("a","1"))).unwrap();
    assert!(migrate_completed_snapshot(&mut db,&destination,decrypt).is_err());
    assert!(db.get("a","1").unwrap().is_none());
}
#[test]
fn snapshot_cannot_be_created_inside_source(){
    let t=Temp::new();
    assert!(create_snapshot(&t.source(),&t.source().join("backup")).is_err());
    assert!(!t.source().join("backup").exists());
}
