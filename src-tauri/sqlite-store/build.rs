use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows")
        || env::var("CARGO_CFG_TARGET_ENV").as_deref() != Ok("msvc")
    {
        return;
    }

    // OpenSSL's MSVC static objects refer to ossl_static.pdb. openssl-src
    // installs it with the libraries, while rustc bundles only the objects
    // in its rlib. Supply the exact matching symbols in this crate's OUT_DIR,
    // where link.exe searches for the PDB when linking those objects.
    let root = PathBuf::from(env::var_os("DEP_OPENSSL_ROOT")
        .expect("vendored OpenSSL build did not publish its installation root"));
    let pdb = root.join("lib").join("ossl_static.pdb");
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo OUT_DIR is missing"));
    println!("cargo:rerun-if-changed={}", pdb.display());
    let metadata = fs::metadata(&pdb).expect("vendored OpenSSL PDB is missing");
    assert!(metadata.is_file() && metadata.len() > 0, "invalid OpenSSL PDB");
    fs::copy(&pdb, out.join("ossl_static.pdb"))
        .expect("could not stage matching OpenSSL debug symbols for MSVC");
}
