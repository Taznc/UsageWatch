fn main() {
    tauri_build::build();

    #[cfg(target_os = "macos")]
    compile_native_tray();
}

#[cfg(target_os = "macos")]
fn compile_native_tray() {
    use std::path::PathBuf;
    use std::process::Command;

    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR not set");
    let out = PathBuf::from(&out_dir);
    let obj = out.join("native_tray.o");
    let lib = out.join("libnative_tray.a");

    // Compile Objective-C source to object file
    let status = Command::new("clang")
        .args(["-fobjc-arc", "-c", "src/native_tray.m", "-o"])
        .arg(&obj)
        .status()
        .expect("failed to invoke clang");
    assert!(status.success(), "clang compilation of native_tray.m failed");

    // Create static library with libtool (avoids BSD ar's missing -D flag)
    let status = Command::new("libtool")
        .args(["-static", "-o"])
        .arg(&lib)
        .arg(&obj)
        .status()
        .expect("failed to invoke libtool");
    assert!(status.success(), "libtool failed to create libnative_tray.a");

    println!("cargo:rustc-link-search={out_dir}");
    println!("cargo:rustc-link-lib=static=native_tray");
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rerun-if-changed=src/native_tray.m");
}
