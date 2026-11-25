use seven_mail_sqlite_store::{MessageRecord, Store};
use std::{fs, path::PathBuf, sync::atomic::{AtomicU64, Ordering}};
static NEXT: AtomicU64 = AtomicU64::new(0);

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("seven-mail-sqlcipher-{}-{}",std::process::id(), NEXT.fetch_add(1,Ordering::Relaxed)));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn db(&self) -> PathBuf { self.0.join("messages.db") }
}
impl Drop for Temp {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

fn record(account:&str,id:&str,date:i64,subject:&str)->MessageRecord {
    MessageRecord {
        account_id:account.into(),message_id:id.into(),received_ms:date,folder:"INBOX".into(),
        subject:subject.into(),sender:"a@example.org".into(),recipients:"b@example.org".into(),
        body:"mensagem confidencial".into(),categories:"".into(),payload:"{}".into(),
    }
}

#[test]
fn encrypted_reopen_and_wrong_key_are_safe() {
    let temp=Temp::new();
    let path=temp.db();
    let key=[42u8;32];
    let value=record("a","1",100,"segredo-teste-7462");
    {
        let mut store=Store::open(&path,&key).unwrap();
        store.upsert(&value).unwrap();
        store.verify().unwrap();
    }
    let before=fs::read(&path).unwrap();
    assert!(!before.starts_with(b"SQLite format 3\0"));
    assert!(!before.windows(b"segredo-teste-7462".len()).any(|w| w==b"segredo-teste-7462"));
    assert!(Store::open(&path,&[13u8;32]).is_err());
    assert_eq!(fs::read(&path).unwrap(),before);
    let store=Store::open(&path,&key).unwrap();
    assert_eq!(store.get("a","1").unwrap(),Some(value));
}

#[test]
fn account_boundaries_and_keyset_pagination() {
    let temp=Temp::new();
    let mut store=Store::open(&temp.db(),&[42u8;32]).unwrap();
    for id in ["a","b","c"] { store.upsert(&record("first",id,100,"Relatório")).unwrap(); }
    store.upsert(&record("other","a",100,"Relatório")).unwrap();
    let first=store.page("first",Some("INBOX"),None,2).unwrap();
    assert_eq!(first.records.iter().map(|r|r.message_id.as_str()).collect::<Vec<_>>(),vec!["c","b"]);
    let next=store.page("first",Some("INBOX"),first.next.as_ref(),2).unwrap();
    assert_eq!(next.records.len(),1);
    assert_eq!(next.records[0].message_id,"a");
    assert!(next.next.is_none());
    assert_eq!(store.search("other","relatorio",20).unwrap(),vec!["a"]);
    assert_eq!(store.search("first","relatorio",20).unwrap().len(),3);
    assert!(store.search("missing","relatorio",20).unwrap().is_empty());
}

#[test]
fn fts_tracks_updates_deletions_and_literal_input() {
    let temp=Temp::new();
    let mut store=Store::open(&temp.db(),&[42u8;32]).unwrap();
    let mut value=record("first","1",100,"fatura janeiro");
    store.upsert(&value).unwrap();
    assert_eq!(store.search("first","fatura",10).unwrap(),vec!["1"]);
    value.subject="contrato fevereiro".into();
    store.upsert(&value).unwrap();
    assert!(store.search("first","fatura",10).unwrap().is_empty());
    assert_eq!(store.search("first","contrato",10).unwrap(),vec!["1"]);
    assert!(store.search("first","contrato OR fatura",10).unwrap().is_empty());
    assert!(store.remove("first","1").unwrap());
    assert!(store.search("first","contrato",10).unwrap().is_empty());
    store.verify().unwrap();
}

#[test]
fn import_is_idempotent_and_rolls_back_on_conflict_or_source_error() {
    let temp=Temp::new();
    let mut store=Store::open(&temp.db(),&[42u8;32]).unwrap();
    let a=record("a","1",100,"Original");
    assert_eq!(store.import_verified([Ok(a.clone())]).unwrap(),1);
    assert_eq!(store.import_verified([Ok(a.clone())]).unwrap(),1);
    let b=record("a","2",101,"Segundo");
    let changed=record("a","1",100,"Alterado");
    assert!(store.import_verified([Ok(b.clone()),Ok(changed)]).is_err());
    assert!(store.get("a","2").unwrap().is_none());
    assert_eq!(store.get("a","1").unwrap(),Some(a));
    assert!(store.import_verified([Ok(b),Err("Fonte inválida".into())]).is_err());
    assert!(store.get("a","2").unwrap().is_none());
    store.verify().unwrap();
}

#[test]
fn read_only_inspection_preserves_existing_database_and_never_creates_one() {
    let temp=Temp::new();
    let path=temp.db();
    let key=[42u8;32];
    assert!(Store::open_read_only(&path,&key).is_err());
    assert!(!path.exists());
    let value=record("a","1",100,"Original");
    {
        let mut store=Store::open(&path,&key).unwrap();
        store.upsert(&value).unwrap();
    }
    let before=fs::read(&path).unwrap();
    assert!(Store::open_read_only(&path,&[13u8;32]).is_err());
    {
        let mut store=Store::open_read_only(&path,&key).unwrap();
        store.verify().unwrap();
        assert_eq!(store.get("a","1").unwrap(),Some(value.clone()));
        assert!(store.upsert(&record("a","2",101,"New")).is_err());
        assert!(store.remove("a","1").is_err());
        assert_eq!(store.get("a","1").unwrap(),Some(value));
    }
    assert_eq!(fs::read(&path).unwrap(),before);
}
